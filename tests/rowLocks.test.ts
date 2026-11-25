import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { Prisma } from '@prisma/client';
import { lockBusyException } from '../apps/api/src/common/lock-busy.filter';
import { LOCK_BUSY_MESSAGE, LockBusyException, VARIABLE_BUSY_MESSAGE, isLockWaitAbort } from '../apps/api/src/common/row-locks';

/**
 * 행 잠금 규칙(T-131) — 쓰기 경로는 `common/row-locks` 의 도우미로만 잠근다(같은 순서·FOR NO KEY UPDATE·기다림 한도).
 * 도우미 밖에서 `FOR UPDATE` 를 쓰면 FK 확인까지 막고 기다림 한도도 없다 — 새로 생기면 여기서 걸린다.
 */

const SRC = join(__dirname, '..', 'apps', 'api', 'src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

/** 주석을 지운 코드 — 설명에 적힌 "FOR UPDATE" 는 세지 않는다 */
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** 잠금 구문 — 대소문자를 가리지 않고 네 가지 세기 모두 */
const LOCK_CLAUSE = /\bFOR\s+(NO\s+KEY\s+UPDATE|UPDATE|KEY\s+SHARE|SHARE)\b/gi;
const clausesOf = (code: string) => [...stripComments(code).matchAll(LOCK_CLAUSE)].map((m) => m[1].toUpperCase().replace(/\s+/g, ' '));

/**
 * 도우미 밖에서 허락한 잠금 — 값 읽기의 공유 잠금(승인 때 변수 값을 다시 볼 때, 값 고치기와 줄 선다)과 계정 쪽 회사 행 잠금.
 * 새로 생기면 도우미로 옮기거나 여기에 까닭과 함께 적는다
 */
const ALLOWED: Record<string, string[]> = {
  [join('users', 'users.service.ts')]: ['NO KEY UPDATE'],
  [join('variables', 'variables.service.ts')]: ['SHARE', 'SHARE'],
  [join('amendments', 'amendments.service.ts')]: ['SHARE'],
};

describe('행 잠금은 공용 도우미로만', () => {
  it('row-locks.ts 밖의 SQL 잠금 구문은 허락한 것뿐이다(FOR UPDATE 는 하나도 없다)', () => {
    const found: Record<string, string[]> = {};
    for (const f of tsFiles(SRC)) {
      const rel = relative(SRC, f);
      if (rel === join('common', 'row-locks.ts')) continue;
      const clauses = clausesOf(readFileSync(f, 'utf8'));
      if (clauses.length) found[rel] = clauses;
    }
    expect(found).toEqual(ALLOWED);
  });

  it('도우미는 FOR NO KEY UPDATE 로 잡고, FOR UPDATE 는 지우기 전 잠금 둘(규정·조문)에만 있다', () => {
    const code = stripComments(readFileSync(join(SRC, 'common', 'row-locks.ts'), 'utf8'));
    expect(clausesOf(code).filter((c) => c === 'NO KEY UPDATE').length).toBeGreaterThanOrEqual(7);
    const bodyOf = (name: string) => {
      const start = code.indexOf(`export async function ${name}`);
      expect(start, name).toBeGreaterThanOrEqual(0);
      const next = code.indexOf('\nexport ', start + 1);
      return code.slice(start, next < 0 ? undefined : next);
    };
    const forUpdate = code.split('\n').filter((l) => /FOR\s+UPDATE/i.test(l));
    const allowed = bodyOf('lockPolicyForDelete') + bodyOf('lockArticlesForDelete');
    expect(forUpdate.length).toBe(4);
    expect(forUpdate.every((l) => allowed.includes(l))).toBe(true);
  });
});

describe('잠금 다툼 → 다시 시도할 수 있는 응답', () => {
  const known = (code: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '5.22.0', meta });

  it('잠금 기다림 한도(55P03)·교착(40P01·P2034) → 409', () => {
    for (const e of [known('P2010', { code: '55P03' }), known('P2010', { code: '40P01' }), known('P2034')]) {
      const mapped = lockBusyException(e);
      expect(mapped?.getStatus()).toBe(409);
      expect(mapped?.message).toBe(LOCK_BUSY_MESSAGE);
    }
    // 모델 쿼리에서 난 같은 오류는 코드 없이 문구로 온다
    const unknown = new Prisma.PrismaClientUnknownRequestError('ERROR: canceling statement due to lock timeout', { clientVersion: '5.22.0' });
    expect(lockBusyException(unknown)?.getStatus()).toBe(409);
    expect(lockBusyException(new Prisma.PrismaClientUnknownRequestError('ERROR: deadlock detected', { clientVersion: '5.22.0' }))?.getStatus()).toBe(409);
  });

  it('트랜잭션을 시작하지 못함(P2028 "Unable to start") → 503, 이미 일부를 했을 수 있는 오류는 그대로(기본 처리)', () => {
    const p2028 = (msg: string) => new Prisma.PrismaClientKnownRequestError(msg, { code: 'P2028', clientVersion: '5.22.0' });
    expect(lockBusyException(p2028('Transaction API error: Unable to start a transaction in the given time.'))?.getStatus()).toBe(503);
    expect(lockBusyException(p2028('Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction.'))).toBeNull();
    expect(lockBusyException(known('P2024'))).toBeNull();
    expect(lockBusyException(known('P2002'))).toBeNull();
    expect(lockBusyException(known('P2010', { code: '23505' }))).toBeNull();
    expect(lockBusyException(new Error('boom'))).toBeNull();
  });

  it('도우미가 직접 바꾸는 오류는 잠금 문장의 기다림 한도 둘 — lock_timeout(55P03)·statement_timeout(57014)', () => {
    expect(isLockWaitAbort(known('P2010', { code: '55P03' }))).toBe(true);
    // 두 시계를 같은 값으로 걸어 대개 문장 시계가 먼저 끝난다 — 이쪽이 실제로 가장 많이 난다
    expect(isLockWaitAbort(known('P2010', { code: '57014' }))).toBe(true);
    expect(isLockWaitAbort(known('P2010', { code: '40P01' }))).toBe(false);
    expect(isLockWaitAbort(known('P2034'))).toBe(false);
  });

  it('잠금 기다림 409 는 어느 잠금을 얼마나 기다렸는지 들고 있고, 변수는 변수 문구로', () => {
    const e = new LockBusyException('policy', 3000);
    expect(e.getStatus()).toBe(409);
    expect(e.message).toBe(LOCK_BUSY_MESSAGE);
    expect([e.lock, e.waitMs]).toEqual(['policy', 3000]);
    expect(new LockBusyException('variable', 3000, VARIABLE_BUSY_MESSAGE).message).toContain('이 변수를');
  });
});

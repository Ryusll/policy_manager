import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readSnapshot, SNAPSHOT_MAX_WAIT_MS, SNAPSHOT_TIMEOUT_MESSAGE, SNAPSHOT_TIMEOUT_MS } from '../apps/api/src/common/read-snapshot';
import { TX_BUSY_MESSAGE } from '../apps/api/src/common/row-locks';

/**
 * T-180 (PAT-22 — 특허 도 13 문단 466~467) 시점 조회 스냅숏. 규정 전문을 만드는 다섯 경로(시점 조회·"현재" 상세·신구조문대비표·규정 간
 * 비교·3단비교)는 요청마다 읽기 전용 REPEATABLE READ 트랜잭션 하나로만 읽는다 — 그 안의 하위 도우미까지 같은 tx 로.
 */

const API = join(__dirname, '..', 'apps', 'api', 'src', 'policies');
/** 들여쓰기 두 칸의 메서드 선언 줄(Prettier 형식) — 화살표 함수 클래스 속성(`private x = async (…) =>`)도 메서드로 센다 */
const methodStart = (lines: string[], name: string) =>
  lines.findIndex((l) =>
    new RegExp(`^  (?:(?:private|protected|public|static|readonly) )*(?:(?:async )?${name}(?:<[^>]*>)?\\(|${name}\\s*=\\s*(?:async\\s*)?\\()`).test(l),
  );
/** 메서드 하나의 본문 — 선언 줄부터 들여쓰기 두 칸의 닫는 괄호 줄까지 */
const methodBody = (code: string, name: string) => {
  const lines = code.split('\n');
  const start = methodStart(lines, name);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && (l === '  }' || l === '  };'));
  return lines.slice(start, end + 1).join('\n');
};
const isMethod = (code: string, name: string) => methodStart(code.split('\n'), name) >= 0;
/** 주석을 지운 코드 */
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
/** 들어오는 메서드에서 this.x 로 부르거나 넘겨 닿는 이 클래스의 메서드 전부 */
const reachable = (code: string, roots: string[]) => {
  const seen = new Set(roots);
  const queue = [...roots];
  while (queue.length) {
    for (const m of methodBody(code, queue.shift()!).matchAll(/this\.(\w+)/g)) {
      if (!seen.has(m[1]) && isMethod(code, m[1])) {
        seen.add(m[1]);
        queue.push(m[1]);
      }
    }
  }
  return seen;
};

const ENTRY = ['findOne', 'findOneAsOf', 'compareAsOf', 'compareWithPolicy', 'threeWay'];
/** 스냅숏 안에서 부르는 읽기 — db 를 첫 인자로 받는다 */
const INNER = ['readOneIn', 'readAsOfIn', 'currentVersionsOf', 'currentArticles', 'publishedArticles', 'articlesCurrent', 'articlesAsOf', 'hasAnyEffectiveDate'];

describe('시점 조회 스냅숏 도우미 (T-180)', () => {
  it('읽기 전용 REPEATABLE READ 로 열고, 첫 조회 전에 READ ONLY·문장 제한을 건다 — 시작 대기·제한도 함께', async () => {
    const calls: string[] = [];
    const tx = {
      $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push(strings.join('?') + (values.length ? ` [${values.join(',')}]` : ''));
        return Promise.resolve(0);
      }),
      policy: { findFirst: vi.fn(() => (calls.push('policy.findFirst'), Promise.resolve({ id: 'p-1' }))) },
    };
    const $transaction = vi.fn((fn: (t: typeof tx) => Promise<unknown>, opts: unknown) => {
      calls.push(`options:${JSON.stringify(opts)}`);
      return fn(tx);
    });
    const out = await readSnapshot({ $transaction } as any, (db: any) => db.policy.findFirst());
    expect(out).toEqual({ id: 'p-1' });
    expect(calls).toEqual([
      `options:${JSON.stringify({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: SNAPSHOT_MAX_WAIT_MS, timeout: SNAPSHOT_TIMEOUT_MS })}`,
      'SET TRANSACTION READ ONLY',
      // DB 쪽 문장도 같은 제한으로 끊는다 — Prisma 는 돌던 문장이 끝나야 만료를 알리므로(실측), 없으면 503 과 연결 반납이 그 문장이 끝날 때까지 늦어진다
      `SELECT set_config('statement_timeout', ?, true) [${SNAPSHOT_TIMEOUT_MS}]`,
      'policy.findFirst',
    ]);
    expect([SNAPSHOT_MAX_WAIT_MS, SNAPSHOT_TIMEOUT_MS]).toEqual([10_000, 10_000]);
  });

  it('읽는 쪽이 던진 오류는 그대로 올라간다(없는 규정 404 등)', async () => {
    const $transaction = (fn: (t: any) => Promise<unknown>) => fn({ $executeRaw: () => Promise.resolve(0) });
    await expect(readSnapshot({ $transaction } as any, () => Promise.reject(new Error('Policy not found')))).rejects.toThrow('Policy not found');
  });

  it('제한을 넘긴 스냅숏(P2028 expired)은 다시 시도하라는 503 으로 — 시작하지 못함은 그대로 올려 lock-busy 필터가 503 으로 (T-180)', async () => {
    const failing = (err: Error) => ({ $transaction: () => Promise.reject(err) }) as any;
    const expired = new Prisma.PrismaClientKnownRequestError(
      'Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction. The timeout for this transaction was 10000 ms, however 10012 ms passed since the start of the transaction.',
      { code: 'P2028', clientVersion: '5.22.0' },
    );
    const e = await readSnapshot(failing(expired), () => Promise.resolve(1)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    expect((e as ServiceUnavailableException).message).toBe(SNAPSHOT_TIMEOUT_MESSAGE);
    const busy = new Prisma.PrismaClientKnownRequestError('Transaction API error: Unable to start a transaction in the given time.', {
      code: 'P2028',
      clientVersion: '5.22.0',
    });
    await expect(readSnapshot(failing(busy), () => Promise.resolve(1))).rejects.toBe(busy);
  });

  it('DB 쪽 문장 제한(57014)도 다시 시도하라는 503, 풀 대기 초과(P2024)는 시작하지 못함과 같은 503 — 그 밖의 Prisma 오류는 그대로 (T-180)', async () => {
    const failing = (err: Error) => ({ $transaction: () => Promise.reject(err) }) as any;
    const caught = (err: Error) => readSnapshot(failing(err), () => Promise.resolve(1)).catch((x: unknown) => x);
    // 날 SQL(P2010)과 모델 조회(알 수 없는 오류)는 57014 를 다르게 싣는다 — Prisma 5.22 실측
    const rawTimeout = new Prisma.PrismaClientKnownRequestError('Raw query failed. Code: `57014`. Message: `ERROR: canceling statement due to statement timeout`', {
      code: 'P2010',
      clientVersion: '5.22.0',
      meta: { code: '57014', message: 'ERROR: canceling statement due to statement timeout' },
    });
    const modelTimeout = new Prisma.PrismaClientUnknownRequestError(
      'ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "57014", message: "canceling statement due to statement timeout" }) })',
      { clientVersion: '5.22.0' },
    );
    for (const err of [rawTimeout, modelTimeout]) {
      const e = await caught(err);
      expect(e, err.message.slice(0, 40)).toBeInstanceOf(ServiceUnavailableException);
      expect((e as ServiceUnavailableException).message).toBe(SNAPSHOT_TIMEOUT_MESSAGE);
    }
    const pool = await caught(new Prisma.PrismaClientKnownRequestError('Timed out fetching a new connection from the connection pool.', { code: 'P2024', clientVersion: '5.22.0' }));
    expect(pool).toBeInstanceOf(ServiceUnavailableException);
    expect((pool as ServiceUnavailableException).message).toBe(TX_BUSY_MESSAGE);
    // 실측하지 않은 P2028(종료 중 끊김 등)·그 밖의 Prisma 오류는 그대로 — 기본 처리(500, 오류 로그)로 원인을 남긴다
    const notFound = new Prisma.PrismaClientKnownRequestError('Transaction API error: Transaction not found.', { code: 'P2028', clientVersion: '5.22.0' });
    const other = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' });
    expect(await caught(notFound)).toBe(notFound);
    expect(await caught(other)).toBe(other);
  });
});

describe('다섯 경로는 스냅숏으로만 읽는다 — 정적 가드 (T-180)', () => {
  const code = stripComments(readFileSync(join(API, 'policies.service.ts'), 'utf8'));

  it('들어오는 메서드는 readSnapshot(this.prisma, …) 하나로 열고, 그 밖에서 this.prisma 를 쓰지 않는다', () => {
    for (const name of ENTRY) {
      const body = methodBody(code, name);
      expect(body.match(/readSnapshot\(/g)?.length, name).toBe(1);
      // 메서드 맨 바깥 줄에서 await 로 한 번 — `ids.map((id) => readSnapshot(…))`·반복문처럼 한 번 적고 여러 번 여는 꼴을 막는다
      expect(body, `${name} 가 스냅숏을 메서드 맨 바깥에서 한 번 열지 않는다`).toMatch(/^ {4}(?:const [^=\n]+= |return )?await readSnapshot\(this\.prisma,/m);
      expect(body.replace('readSnapshot(this.prisma,', '').includes('this.prisma'), `${name} 가 스냅숏 밖에서 this.prisma 를 쓴다`).toBe(false);
    }
  });

  it('스냅숏 안에서 부르는 읽기는 db(SnapshotDb)를 첫 인자로 받고, 부를 때 db 를 넘긴다', () => {
    for (const name of INNER) expect(methodBody(code, name).split('\n')[0], name).toMatch(/\(db: SnapshotDb,/);
    const calls = [...code.matchAll(new RegExp(`this\\.(${INNER.join('|')})\\(([^,)]*)`, 'g'))];
    expect(calls.length).toBeGreaterThanOrEqual(10);
    for (const m of calls) expect(m[2].trim(), m[0]).toBe('db');
  });

  it('들어오는 메서드에서 닿는 메서드는 이 클래스의 메서드만 부른다 — this.prisma·다른 서비스·this 별칭·단언·대괄호 접근이 없다 (T-180)', () => {
    const all = reachable(code, ENTRY);
    expect([...all]).toEqual(expect.arrayContaining([...INNER, 'shapeOne', 'shapeAsOf']));
    for (const name of all) {
      const body = ENTRY.includes(name) ? methodBody(code, name).replace('readSnapshot(this.prisma,', 'readSnapshot(') : methodBody(code, name);
      const fields = [...body.matchAll(/this\.(\w+)/g)].map((m) => m[1]).filter((f) => !isMethod(code, f));
      expect(fields, `${name} 가 메서드가 아닌 this.${fields[0]} 를 쓴다(prisma·다른 서비스)`).toEqual([]);
      // this 는 `this.<메서드>` 꼴로만 — `(this as any).prisma`·`this?.x`·`this!.x`·`this[...]`·`const { prisma } = this`·`f(this)` 를 한꺼번에 막는다
      const methodRefs = [...body.matchAll(/\bthis\.(\w+)/g)].filter((m) => isMethod(code, m[1])).length;
      expect(body.match(/\bthis\b/g)?.length ?? 0, `${name} 가 this 를 메서드 호출 밖에서 쓴다`).toBe(methodRefs);
    }
  });

  it('클래스 안 어디서도 들어오는 메서드를 부르지 않는다 — 스냅숏이 겹치거나, 쓰기 트랜잭션이 연결을 쥔 채 스냅숏을 열지 않게 (T-180)', () => {
    // 쓰기 tx 안에서 findOne 을 부르면 둘째 연결을 기다리고(풀 고갈), RR 스냅숏은 바깥 tx 의 미커밋 쓰기를 못 본다 — 소속 확인은 assertPolicyInTenant
    const nested = [...code.matchAll(new RegExp(`\\bthis\\.(${ENTRY.join('|')})\\b`, 'g'))].map((m) => m[1]);
    expect(nested).toEqual([]);
  });

  it('"오늘"은 요청마다 한 번 — 들어오는 메서드만 todayDateOnly() 를 한 번 부르고, 닿는 메서드는 넘겨받는다 (T-180)', () => {
    for (const name of reachable(code, ENTRY)) {
      const n = methodBody(code, name).match(/todayDateOnly\(/g)?.length ?? 0;
      expect(n, name).toBeLessThanOrEqual(ENTRY.includes(name) ? 1 : 0);
    }
  });

  it('날짜 검증은 스냅숏을 열기 전에 — 잘못된 요청이 연결을 잡지 않게 (T-180)', () => {
    for (const name of ['findOneAsOf', 'compareAsOf']) {
      const body = methodBody(code, name);
      expect(body.indexOf('parseDateOnly('), name).toBeGreaterThanOrEqual(0);
      expect(body.indexOf('parseDateOnly('), name).toBeLessThan(body.indexOf('readSnapshot('));
    }
  });

  it('소속 확인은 findOne(스냅숏) 대신 가벼운 assertPolicyInTenant — findOne 은 상세 화면에서만 (T-180)', () => {
    const controller = stripComments(readFileSync(join(API, 'policies.controller.ts'), 'utf8'));
    expect(code.includes('this.findOne('), 'service 안에서 findOne 으로 소속 확인').toBe(false);
    expect(controller.match(/policiesService\.findOne\(/g)?.length).toBe(1);
    expect(methodBody(code, 'assertPolicyInTenant')).not.toMatch(/readSnapshot|\$transaction/);
  });
});

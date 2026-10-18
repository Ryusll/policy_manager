import { describe, it, expect, vi, afterEach } from 'vitest';
import { BadGatewayException, ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LawsService } from '../apps/api/src/laws/laws.service';
import { mapLawDetail } from '../apps/api/src/lawgokr/lawgokr.mapper';
import { LAW_BUSY_MESSAGE, LockBusyException, lockLawRowsForRegister } from '../apps/api/src/common/row-locks';

/**
 * 법령 등록의 법령 행 고르기 (T-151 검토 H1) — DB 없이 가짜 저장소로 `LawsService.register` 를 돌린다.
 * 실제 DB 의 차례(동기화와 겹친 등록)는 통합 시험(law-sync-versions-race.int.test.ts)이 본다.
 *
 * 막고 싶은 사고:
 * 1. 동기화가 법령 행을 뒤 판으로 옮겨 둔 뒤 현행 판(검색 결과)을 등록해 같은 법령의 둘째 행이 생긴다
 * 2. 그 행을 옛 판으로 되돌려 쓴다(본문·조항이 판보다 뒤로 간다)
 * 3. 같은 법령의 서로 다른 판을 동시에 처음 등록해 두 행이 생긴다(판이 달라 MST 유일에 걸리지 않는다)
 * 4. 본문에 법령ID 가 빠진 응답으로 새 행을 만들어, 같은 법령의 둘째 행(동기화가 판을 찾지 못하는 행)이 생긴다
 * 5. 기다림이 트랜잭션 제한을 넘겨 409(잠시 뒤 다시)가 아니라 500 이 된다
 */
const LID = '990143';
const body = (mst: string, lawId: string | null = LID) =>
  mapLawDetail(
    {
      기본정보: { ...(lawId ? { 법령ID: lawId } : {}), 법령명_한글: '시험법', 공포일자: '20260101', 시행일자: '20260101', 공포번호: '100' },
      조문: { 조문단위: [{ 조문번호: '1', 조문여부: '조문', 조문내용: `제1조(목적) ${mst} 본문` }] },
    },
    mst,
  );

/** 잠금 도우미가 돌려주는 법령 행(법령원 안에서 같은 MST 이거나 같은 법령ID 인 행) */
type Row = { id: string; external_id: string; effective_notes_version: number | null };
const row = (id: string, external_id: string): Row => ({ id, external_id, effective_notes_version: 1 });

function setup(o: { rows?: Row[]; lawId?: string | null; lockError?: Error; createError?: Error } = {}) {
  const calls = { locks: [] as unknown[][], advisory: [] as unknown[][], writes: [] as string[], updates: [] as Record<string, unknown>[] };
  const ok = <T>(v: T) => Promise.resolve(v);
  const write = (name: string, v: unknown = {}) => (calls.writes.push(name), ok(v));
  const tx: any = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('set_config')) return ok([{ prev: '0' }]);
      calls.locks.push([strings.join('?'), ...values]);
      return o.lockError ? Promise.reject(o.lockError) : ok(o.rows ?? []);
    },
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('pg_advisory_xact_lock')) calls.advisory.push(values);
      return ok(0);
    },
    law: {
      findUniqueOrThrow: (a: any) => ok({ id: a.where.id, externalId: '900300', lawName: '시험법' }),
      update: (a: any) => (calls.updates.push(a.data), write('law.update', { id: a.where.id, ...a.data })),
      create: (a: any) => (o.createError ? Promise.reject(o.createError) : write('law.create', { id: 'law-new', ...a.data })),
    },
    lawArticle: {
      count: () => ok(7),
      findMany: () => ok([]),
      upsert: (a: any) => write('lawArticle.upsert', { id: `a-${a.where.lawId_nodeKey.nodeKey}` }),
      updateMany: () => write('lawArticle.updateMany', { count: 0 }),
    },
    lawChangeEvent: { createMany: () => write('lawChangeEvent.createMany', { count: 0 }) },
    lawVersion: { upsert: () => write('lawVersion.upsert', { id: 'v' }) },
  };
  const prisma: any = { ...tx, lawSource: { upsert: () => ok({ id: 'src-1', isActive: true }) }, $transaction: (fn: any) => fn(tx) };
  const lawGoKr: any = { getLaw: (mst: string) => ok(body(mst, o.lawId === undefined ? LID : o.lawId)) };
  return { service: new LawsService(prisma, lawGoKr), calls };
}

describe('LawsService.register — 법령 행 고르기 (T-151)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('같은 법령ID 를 다른 판으로 이미 추적 중이면 그 행을 그대로 돌려준다 — 본문·조항·판 기록을 쓰지 않는다', async () => {
    const { service, calls } = setup({ rows: [row('law-1', '900300')] });
    const r = await service.register('900200');
    expect(r).toMatchObject({ id: 'law-1', externalId: '900300', alreadyTracked: true, articleCount: 7, skipped: 0 });
    expect(calls.writes).toEqual([]);
  });

  it('같은 판의 행이 있으면 그 행을 고친다 — 새 행을 만들지 않는다', async () => {
    const { service, calls } = setup({ rows: [row('law-same', '900200')] });
    const r = await service.register('900200');
    expect(r).toMatchObject({ id: 'law-same', alreadyTracked: false });
    expect(calls.writes).toContain('law.update');
    expect(calls.writes).not.toContain('law.create');
  });

  it('MST·법령ID 로 찾은 행이 둘 이상이면(같은 법령의 옛 중복) 어느 행인지 짐작하지 않고 409 — 쓰지 않고, 정리할 중복을 로그에 남긴다', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const shapes: Row[][] = [
      [row('law-same', '900200'), row('law-old', '900100')], // 같은 판 + 같은 법령ID 의 다른 판
      [row('law-behind', '900100'), row('law-ahead', '900300')], // 같은 법령ID 두 행(다른 판으로 등록)
      [row('law-legacy', '900200'), row('law-ok', '900300')], // 법령ID 없는 같은 판 옛 행(MST 로) + 정상 행(법령ID 로)
    ];
    for (const rows of shapes) {
      const { service, calls } = setup({ rows });
      const err = await service.register('900200').catch((e: unknown) => e);
      expect(err, rows.map((r) => r.id).join(',')).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toContain('같은 법령이 여러 행으로 등록돼 있어(옛 중복)');
      expect(calls.writes).toEqual([]);
    }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('법령 행이 2개입니다'));
  });

  it('처음이면 새 행을 만든다 — 잠금은 법령원·MST·법령ID 로 찾고(FOR NO KEY UPDATE), 첫 등록끼리는 법령ID 열쇠로 줄 선다', async () => {
    const { service, calls } = setup();
    const r = await service.register('900200');
    expect(r).toMatchObject({ id: 'law-new', alreadyTracked: false });
    expect(calls.writes.slice(0, 2)).toEqual(['law.create', 'lawVersion.upsert']);
    const [sql, ...values] = calls.locks[0] as [string, ...unknown[]];
    expect(sql).toMatch(/FOR NO KEY UPDATE/);
    expect(values).toEqual(expect.arrayContaining(['src-1', '900200', LID]));
    expect(calls.advisory).toEqual([[`law-register:src-1:${LID}`]]);
  });

  it('법령ID 없는 옛 행을 같은 판으로 다시 등록하면(같은 법령의 다른 행이 없을 때) 본문의 법령ID 를 채운다', async () => {
    const alone = setup({ rows: [row('law-legacy', '900200')] });
    await alone.service.register('900200');
    expect(alone.calls.updates[0].externalLawId).toBe(LID);
  });

  it('본문에 법령ID 가 없으면 열쇠 없이 MST 로만 찾는다 — 같은 판 행이 있으면 그 행을 고친다', async () => {
    const { service, calls } = setup({ lawId: null, rows: [row('law-same', '900200')] });
    const r = await service.register('900200');
    expect(r).toMatchObject({ id: 'law-same', alreadyTracked: false });
    expect(calls.advisory).toEqual([]);
    expect(calls.locks[0]).toContain(null);
    // 저장된 법령ID 를 null 로 덮지 않는다 — 동기화의 열쇠다
    expect(calls.updates[0]).not.toHaveProperty('externalLawId', null);
    expect(calls.updates[0].externalLawId).toBeUndefined();
  });

  it('본문에 법령ID 가 없고 같은 판 행도 없으면 새로 만들지 않는다(502) — 같은 법령을 다른 판으로 추적 중인지 알 수 없다', async () => {
    const { service, calls } = setup({ lawId: null });
    const err = await service.register('900200').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect((err as Error).message).toContain('법제처 응답에 법령ID가 없어 새로 등록하지 않았습니다');
    expect(calls.writes).toEqual([]);
  });

  it('만들기가 MST 유일에 걸리면(잠근 뒤 다른 경로가 같은 판 행을 만듦) 500 이 아니라 409', async () => {
    const dup = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
    const { service } = setup({ createError: dup });
    await expect(service.register('900200')).rejects.toThrow(ConflictException);
    await expect(service.register('900200')).rejects.toThrow('같은 법령이 방금 다른 경로로 등록됐습니다');
  });

  it('판 반영이 법령 행을 오래 잡고 있으면 기다림 한도에서 409(잠시 뒤 다시)로 끝낸다', async () => {
    const busy = new Prisma.PrismaClientKnownRequestError('lock', { code: 'P2010', clientVersion: 'test', meta: { code: '55P03' } });
    const { service, calls } = setup({ lockError: busy });
    const err = await service.register('900200').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockBusyException);
    expect((err as LockBusyException).message).toBe(LAW_BUSY_MESSAGE);
    expect(calls.writes).toEqual([]);
  });
});

describe('lockLawRowsForRegister — 기다림 한도 (T-151)', () => {
  /** 법령ID 열쇠를 잡는 데 걸리는 시간만 흉내 낸 가짜 트랜잭션 */
  function fakeTx(advisoryMs: number) {
    const budgets: unknown[][] = [];
    const tx: any = {
      $queryRaw: (strings: TemplateStringsArray) => Promise.resolve(strings.join('?').includes('set_config') ? [{ prev: '0' }] : []),
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const q = strings.join('?');
        if (q.includes('pg_advisory_xact_lock')) await new Promise((r) => setTimeout(r, advisoryMs));
        else if (q.includes("set_config('lock_timeout'")) budgets.push(values);
        return 0;
      },
    };
    return { tx, budgets };
  }

  it('열쇠를 기다린 만큼 행 잠금의 한도를 줄이고(두 시계 모두), 잠근 뒤에는 한도 전체로 되돌린다 — 두 문장이 한도 하나를 나눠 쓴다', async () => {
    const { tx, budgets } = fakeTx(30);
    await lockLawRowsForRegister(tx, 'src-1', '900200', LID, 1_000);
    expect(budgets).toHaveLength(2);
    const [lockLeft, statementLeft] = budgets[0] as string[];
    expect(statementLeft).toBe(lockLeft); // lock_timeout·statement_timeout 둘 다 남은 시간 — 따로 세면 트랜잭션 제한을 넘겨 500
    const left = Number(lockLeft.replace('ms', ''));
    expect(left).toBeLessThanOrEqual(1_000 - 20); // 열쇠를 기다린 30ms 만큼(타이머 오차를 빼고) 줄었다 — 열쇠 잡기 전에 재면 999·1000
    expect(left).toBeGreaterThan(0);
    expect(budgets[1]).toEqual(['1000ms']); // 잠근 뒤의 암묵적 기다림은 한도 전체(줄인 값이 남으면 뜻하지 않은 409)
  });

  it('열쇠를 기다리다 한도를 다 쓰면 행을 잠그지 않고 409(잠시 뒤 다시)', async () => {
    const { tx } = fakeTx(60);
    const err = await lockLawRowsForRegister(tx, 'src-1', '900200', LID, 40).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockBusyException);
    expect((err as LockBusyException).message).toBe(LAW_BUSY_MESSAGE);
  });
});

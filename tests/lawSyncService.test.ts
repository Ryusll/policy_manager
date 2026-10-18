import { describe, it, expect, afterEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LawSyncService } from '../apps/api/src/laws/law-sync.service';
import { maxVersionsPerRun, runBudgetMs } from '../apps/api/src/laws/law-version-sync';
import { mapLawDetail } from '../apps/api/src/lawgokr/lawgokr.mapper';
import { EFFECTIVE_NOTES_VERSION } from '../apps/api/src/common/effective-notes';

/**
 * 동기화 서비스가 판 걷기 결과를 법령 행에 남기는 방법 (T-151, PAT-07). DB·법제처 없이 가짜로 `run()` 을 돌린다.
 *
 * 지킬 것:
 * 1. 판이 남으면(한 번에 반영하는 판 수 상한) 오류만 지우고 확인 시각은 그대로 — 다음 실행 앞에 서고, "확인 성공"처럼 보이지 않는다
 * 2. 경합(다른 경로가 먼저 판을 바꿈)이면 확인 시각도 오류도 쓰지 않는다
 * 3. 실패면 확인 시각과 오류를 남긴다
 * 4. lawIds 를 주면 그 법령만 돈다 — 없는 법령이면 실행을 시작하지 않는다(404)
 * 5. 확인 기록을 남기다 실패해도 이미 반영한 판은 결과에 남는다
 * 6. 법령ID 없이 등록된 옛 행을 짐작으로 채우지 않는다 — 옛 중복이면 멈춘 행을 만든다. 법제처를 부르지 않고 실패로 알린다
 */
const LID = '990143';
const item = (mst: string, day: string) => ({
  mst, lawId: LID, title: '시험법', shortTitle: null, lawType: '법률', revisionType: '일부개정', ministry: null,
  promulgationDate: day, promulgationNo: mst.slice(-3), effectiveDate: day, status: '연혁',
});
const body = (mst: string, day: string, lawId: string | null = LID) =>
  mapLawDetail(
    {
      기본정보: { ...(lawId ? { 법령ID: lawId } : {}), 법령명_한글: '시험법', 공포일자: day.replace(/-/g, ''), 시행일자: day.replace(/-/g, '') },
      조문: { 조문단위: [{ 조문번호: '1', 조문여부: '조문', 조문내용: `제1조(목적) ${mst} 본문` }] },
    },
    mst,
  );

function setup(o: { cas?: number; failBody?: string; markFails?: boolean | 'notfound'; stored?: string; noLawId?: boolean } = {}) {
  const calls = { lawUpdates: [] as any[], findMany: [] as any[], lawGoKr: 0, runsStarted: 0 };
  const ok = <T>(v: T) => Promise.resolve(v);
  const prisma: any = {
    $executeRaw: () => ok(0),
    lawSyncRun: {
      updateMany: () => ok({ count: 0 }),
      findFirst: () => ok(null),
      create: () => ((calls.runsStarted += 1), ok({ id: 'run-1' })),
      update: (a: any) => ok({ id: 'run-1', ...a.data }),
    },
    law: {
      findMany: (a: any) => {
        calls.findMany.push(a);
        const rows = [{ id: 'law-1', lawName: '시험법', externalId: o.stored ?? '900100', externalLawId: o.noLawId ? null : LID, effectiveNotesVersion: EFFECTIVE_NOTES_VERSION, promulgatedDate: new Date('2026-01-01T00:00:00Z') }];
        const only: string[] | undefined = a?.where?.id?.in;
        return ok(only ? rows.filter((r) => only.includes(r.id)) : rows);
      },
      findUnique: () => ok({ effectiveNotesVersion: EFFECTIVE_NOTES_VERSION }),
      update: (a: any) => {
        if (o.markFails && ('lastCheckedAt' in a.data || 'lastCheckError' in a.data)) {
          return Promise.reject(
            o.markFails === 'notfound' ? new Prisma.PrismaClientKnownRequestError('gone', { code: 'P2025', clientVersion: 'test' }) : new Error('DB 연결 끊김'),
          );
        }
        calls.lawUpdates.push(a.data);
        return ok({});
      },
      updateMany: () => ok({ count: o.cas ?? 1 }),
    },
    lawVersion: {
      upsert: () => ok({ id: 'v', orderKey: 'k', stageEffectiveDates: [new Date()], revisionType: 'x' }),
      create: () => ok({ id: 'ver' }),
      update: () => ok({}),
    },
    lawArticle: { findMany: () => ok([]), upsert: () => ok({ id: 'a1' }), updateMany: () => ok({ count: 0 }) },
    lawChangeEvent: { createMany: (a: any) => ok({ count: a.data.length }) },
  };
  prisma.$transaction = (fn: (tx: unknown) => Promise<unknown>) => fn(prisma);
  // 판 목록은 법령ID 로만 받는다 — 법령명 검색(search)은 없다
  const lawGoKr: any = {
    searchVersions: () => ((calls.lawGoKr += 1), ok({ total: 3, page: 1, display: 100, items: [item('900300', '2026-03-01'), item('900200', '2026-02-01'), item('900100', '2026-01-01')] })),
    getLaw: (mst: string) => ((calls.lawGoKr += 1), mst === o.failBody ? Promise.reject(new Error('법제처 응답 오류')) : ok(body(mst, mst === '900200' ? '2026-02-01' : '2026-03-01'))),
  };
  const amendments: any = { processPendingEvents: () => ok({ created: 0 }) };
  return { service: new LawSyncService(prisma, lawGoKr, amendments), calls };
}

describe('LawSyncService — 판 걷기 결과 남기기 (T-151)', () => {
  const env = process.env.LAW_SYNC_MAX_VERSIONS;
  afterEach(() => {
    if (env === undefined) delete process.env.LAW_SYNC_MAX_VERSIONS;
    else process.env.LAW_SYNC_MAX_VERSIONS = env;
  });

  it('모두 반영하면 확인 시각을 찍고 오류를 지운다', async () => {
    const { service, calls } = setup();
    const run = await service.run({ trigger: 'manual' });
    expect(run.results[0]).toMatchObject({ outcome: 'updated', toMst: '900300' });
    expect(calls.lawUpdates.filter((d) => 'lastCheckedAt' in d)).toEqual([{ lastCheckedAt: expect.any(Date), lastCheckError: null }]);
  });

  it('상한에 걸려 판이 남으면 오류만 지우고 확인 시각은 그대로 — 다음 실행 앞에 선다', async () => {
    process.env.LAW_SYNC_MAX_VERSIONS = '1';
    const { service, calls } = setup();
    const run = await service.run({ trigger: 'manual' });
    expect(run.results[0]).toMatchObject({ outcome: 'updated', toMst: '900200', remaining: 1 });
    expect(calls.lawUpdates.filter((d) => 'lastCheckedAt' in d)).toEqual([]);
    expect(calls.lawUpdates).toContainEqual({ lastCheckError: null });
  });

  it('경합이면 확인 시각도 오류도 쓰지 않는다', async () => {
    const { service, calls } = setup({ cas: 0 });
    const run = await service.run({ trigger: 'manual' });
    expect(run.results[0]).toMatchObject({ outcome: 'unchanged' });
    expect(run.results[0].note).toContain('다른 경로가 먼저');
    expect(calls.lawUpdates.filter((d) => 'lastCheckedAt' in d || 'lastCheckError' in d)).toEqual([]);
  });

  it('실패면 확인 시각과 오류를 남긴다 — 앞서 반영한 판은 결과에 함께', async () => {
    const { service, calls } = setup({ failBody: '900300' });
    const run = await service.run({ trigger: 'manual' });
    expect(run.results[0]).toMatchObject({ outcome: 'failed', toMst: '900200' });
    expect(calls.lawUpdates.filter((d) => 'lastCheckedAt' in d)).toEqual([{ lastCheckedAt: expect.any(Date), lastCheckError: expect.stringContaining('MST 900300 반영 실패') }]);
    expect(run.changedCount).toBe(1);
    expect(run.failedCount).toBe(1);
  });

  it('lawIds 를 주면 그 법령만 고른다', async () => {
    const { service, calls } = setup();
    await service.run({ trigger: 'manual', lawIds: ['law-1'] });
    const targets = () => calls.findMany.filter((a) => a.orderBy); // 대상 고르기(있는지 확인은 orderBy 가 없다)
    expect(targets()[0].where).toEqual({ id: { in: ['law-1'] } });
    await service.run({ trigger: 'manual' });
    expect(targets()[1].where).toBeUndefined();
  });

  it('없는 법령을 주면 실행을 시작하지 않고 404 — 빈 실행 기록이 "성공"으로 남지 않는다', async () => {
    const { service, calls } = setup();
    await expect(service.run({ trigger: 'manual', lawIds: ['law-1', 'law-x'] })).rejects.toThrow(NotFoundException);
    await expect(service.run({ trigger: 'manual', lawIds: ['law-x'] })).rejects.toThrow('법령을 찾을 수 없습니다: law-x');
    expect(calls.runsStarted).toBe(0);
    await expect(service.plan({ lawIds: ['law-x'] })).rejects.toThrow(NotFoundException);
  });

  it('확인 기록을 남기다 실패해도 이미 반영한 판은 결과에 남고, 실패는 안내에 적는다', async () => {
    const { service } = setup({ markFails: true });
    const run = await service.run({ trigger: 'manual' });
    expect(run.results[0]).toMatchObject({ outcome: 'updated', toMst: '900300' });
    expect(run.results[0].versions.map((v: any) => v.mst)).toEqual(['900200', '900300']);
    expect(run.results[0].note).toContain('확인 기록을 남기지 못했습니다: DB 연결 끊김');
  });

  it('새 판이 없을 때도 같다 — 확인 기록 실패로 "개정 없음"이 실패로 바뀌지 않고 안내에 적는다', async () => {
    const { service } = setup({ markFails: true, stored: '900300' });
    const run = await service.run({ trigger: 'manual' });
    expect(run.results[0]).toMatchObject({ outcome: 'unchanged', fromMst: '900300' });
    expect(run.results[0].note).toContain('확인 기록을 남기지 못했습니다: DB 연결 끊김');
    expect(run.failedCount).toBe(0);
  });

  it('그새 법령이 지워졌으면(P2025) 남길 곳이 없으니 조용히 넘어간다 — 결과는 그대로', async () => {
    for (const stored of ['900100', '900300']) {
      const { service } = setup({ markFails: 'notfound', stored });
      const run = await service.run({ trigger: 'manual' });
      expect(run.results[0].outcome, stored).toBe(stored === '900100' ? 'updated' : 'unchanged');
      expect(run.results[0].note, stored).toBeUndefined();
    }
  });
});

describe('법령ID 없이 등록된 옛 행 (T-151 검토)', () => {
  it('동기화는 법제처를 부르지 않고 실패로 남긴다 — 저장 판 본문에서 짐작으로 채우지 않는다(옛 중복이면 멈춘 행을 만든다)', async () => {
    const { service, calls } = setup({ noLawId: true });
    const run = await service.run({ trigger: 'manual' });
    expect(run.results[0]).toMatchObject({ outcome: 'failed' });
    // 확인 오류는 고객 화면에도 보인다 — 내부 문서·작업 번호 없이(운영자 안내는 서버 로그·--plan 에)
    expect(run.results[0].error).toBe('법령ID 가 없는 옛 법령이라 자동으로 확인할 수 없습니다 — 아스트룸에 문의하세요.');
    expect(run.results[0].note).toContain('런북 7-5 의 점검(t151-law-id-check.sql)'); // 운영자 안내는 통합 관리자 화면(실행 결과)에
    expect(calls.lawGoKr).toBe(0);
    expect(calls.lawUpdates).toContainEqual({ lastCheckedAt: expect.any(Date), lastCheckError: expect.stringContaining('법령ID 가 없는 옛 법령') });
  });

  it('계획(--plan)도 같은 까닭으로 확인 실패로 찍는다', async () => {
    const { service, calls } = setup({ noLawId: true });
    const [p] = (await service.plan({})) as any[];
    expect(p).toMatchObject({ storedMst: '900100', error: expect.stringContaining('런북 7-5 의 점검(t151-law-id-check.sql)') });
    expect(calls.lawGoKr).toBe(0);
  });
});

describe('동기화 한도 (T-151)', () => {
  const keep = { versions: process.env.LAW_SYNC_MAX_VERSIONS, budget: process.env.LAW_SYNC_BUDGET_MS };
  afterEach(() => {
    for (const [k, v] of [['LAW_SYNC_MAX_VERSIONS', keep.versions], ['LAW_SYNC_BUDGET_MS', keep.budget]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('한 번에 반영하는 판 수 — 기본 5, 1~50, 숫자가 아니면 기본', () => {
    for (const [value, want] of [[undefined, 5], ['3', 3], ['200', 50], ['0', 5], ['-2', 5], ['abc', 5]] as const) {
      if (value === undefined) delete process.env.LAW_SYNC_MAX_VERSIONS;
      else process.env.LAW_SYNC_MAX_VERSIONS = value;
      expect(maxVersionsPerRun(), String(value)).toBe(want);
    }
  });

  it('실행 시간 상한 — 기본 20분, 1분~25분으로 자른다(30분 "중단됨" 판정보다 짧게)', () => {
    const min = 60_000;
    for (const [value, want] of [[undefined, 20 * min], [String(5 * min), 5 * min], ['1000', min], [String(60 * min), 25 * min], ['0', 20 * min], ['abc', 20 * min]] as const) {
      if (value === undefined) delete process.env.LAW_SYNC_BUDGET_MS;
      else process.env.LAW_SYNC_BUDGET_MS = value;
      expect(runBudgetMs(), String(value)).toBe(want);
    }
  });
});

import { describe, it, expect, afterEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CHECK_FAILED_FOR_CUSTOMER } from '../apps/api/src/laws/law-check-error';
import { maxVersionsPerRun, runBudgetMs } from '../apps/api/src/laws/law-version-sync';
import { setup } from './lawSyncFake';

/**
 * 동기화 서비스가 판 걷기 결과를 법령 행에 남기는 방법 (T-151, PAT-07). DB·법제처 없이 가짜로 `run()` 을 돌린다.
 *
 * 지킬 것:
 * 1. 판이 남으면(한 번에 반영하는 판 수 상한) 오류만 지우고 확인·시도 시각은 그대로 — 다음 실행 앞에 서고, "확인 성공"처럼 보이지
 *    않는다. 단 실행 시간을 절반 넘게 남기고 시작했는데도 한 판도 반영하지 못하면 실패로 센다(시도 시각이 찍혀 뒤로 — 나머지를 굶기지
 *    않게, T-153 ⑤). 늦게 시작해 한 판도 반영하지 못했으면 아무것도 쓰지 않는다(앞선 오류를 지우지 않는다)
 * 2. 경합(다른 경로가 먼저 판을 바꿈)이면 확인 시각도 오류도 쓰지 않는다
 * 3. 실패면 시도 시각과 오류만 남긴다 — 확인 시각은 그대로(실패를 성공처럼 보이지 않게, T-153 ⑤). 예외로 끝난 실패도 같다
 * 4. lawIds 를 주면 그 법령만 돈다 — 없는 법령이면 실행을 시작하지 않는다(404)
 * 5. 확인 기록을 남기다 실패해도 이미 반영한 판은 결과에 남는다
 * 6. 법령ID 없이 등록된 옛 행을 짐작으로 채우지 않는다 — 옛 중복이면 멈춘 행을 만든다. 법제처를 부르지 않고 실패로 알린다
 */
// 가짜 동기화(DB·법제처 없이) — tests/lawSyncFake.ts(T-222 시험도 쓴다)

describe('LawSyncService — 판 걷기 결과 남기기 (T-151)', () => {
  const env = process.env.LAW_SYNC_MAX_VERSIONS;
  afterEach(() => {
    if (env === undefined) delete process.env.LAW_SYNC_MAX_VERSIONS;
    else process.env.LAW_SYNC_MAX_VERSIONS = env;
  });

  it('모두 반영하면 확인·시도 시각을 찍고 오류를 지운다', async () => {
    const { service, calls } = setup();
    const run = await service.run({ trigger: 'manual' });
    expect(run.results[0]).toMatchObject({ outcome: 'updated', toMst: '900300' });
    expect(calls.lawUpdates.filter((d) => 'lastCheckedAt' in d)).toEqual([{ lastCheckedAt: expect.any(Date), lastAttemptedAt: expect.any(Date), lastCheckError: null }]);
  });

  it('동기화 대상은 확인 시도가 오래된 순 — 실패한 법령도 시도 시각이 찍혀 다음 실행에서 맨 앞에 서지 않는다, 실행과 계획이 같은 차례 (T-153 ⑤)', async () => {
    const { service, calls } = setup();
    await service.run({ trigger: 'manual' });
    await service.plan({});
    const order = [{ lastAttemptedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }];
    expect(calls.findMany.filter((a) => a?.orderBy).map((a) => a.orderBy)).toEqual([order, order]);
  });

  it('상한에 걸려 판이 남으면 오류만 지우고 확인 시각은 그대로 — 다음 실행 앞에 선다', async () => {
    process.env.LAW_SYNC_MAX_VERSIONS = '1';
    const { service, calls } = setup();
    const run = await service.run({ trigger: 'manual' });
    expect(run.results[0]).toMatchObject({ outcome: 'updated', toMst: '900200', remaining: 1 });
    expect(calls.lawUpdates.filter((d) => 'lastCheckedAt' in d || 'lastAttemptedAt' in d)).toEqual([]);
    expect(calls.lawUpdates).toContainEqual({ lastCheckError: null });
  });

  it('경합이면 확인 시각도 오류도 쓰지 않는다', async () => {
    const { service, calls } = setup({ cas: 0 });
    const run = await service.run({ trigger: 'manual' });
    expect(run.results[0]).toMatchObject({ outcome: 'unchanged' });
    expect(run.results[0].note).toContain('다른 경로가 먼저');
    expect(calls.lawUpdates.filter((d) => 'lastCheckedAt' in d || 'lastAttemptedAt' in d || 'lastCheckError' in d)).toEqual([]);
  });

  it('실패면 시도 시각과 오류만 남긴다 — 확인 시각은 그대로(실패를 성공처럼 보이지 않게, T-153 ⑤), 앞서 반영한 판은 결과에 함께', async () => {
    const { service, calls } = setup({ failBody: '900300' });
    const run = await service.run({ trigger: 'manual' });
    expect(run.results[0]).toMatchObject({ outcome: 'failed', toMst: '900200' });
    expect(calls.lawUpdates.filter((d) => 'lastCheckedAt' in d)).toEqual([]);
    // 확인 기록(고객 화면)에는 고객 문구, 원문(MST·내부 오류 글)은 실행 결과(통합 관리자 이력)에만 — T-222 로 바뀐 완료 정의
    expect(calls.lawUpdates).toContainEqual({ lastAttemptedAt: expect.any(Date), lastCheckError: CHECK_FAILED_FOR_CUSTOMER });
    expect(run.results[0].error).toContain('MST 900300 반영 실패');
    expect(run.changedCount).toBe(1);
    expect(run.failedCount).toBe(1);
  });

  it('예외로 끝난 실패(판 목록을 받지 못함)도 시도 시각과 오류만 — 확인 시각은 찍지 않는다 (T-153 ⑤)', async () => {
    const { service, calls } = setup({ listFails: true });
    const run = await service.run({ trigger: 'manual' });
    expect(run.results[0]).toMatchObject({ outcome: 'failed', error: expect.stringContaining('법제처 연결 실패') });
    expect(calls.lawUpdates.filter((d) => 'lastCheckedAt' in d)).toEqual([]);
    expect(calls.lawUpdates).toContainEqual({ lastAttemptedAt: expect.any(Date), lastCheckError: CHECK_FAILED_FOR_CUSTOMER }); // 일반 Error 원문은 고객 화면에 싣지 않는다(T-222)
  });

  it('실행 시간을 절반 넘게 남기고 시작했는데도 한 판도 반영하지 못하면 실패(시도 시각·오류, 실행도 실패) — 늦게 시작했으면 아무것도 쓰지 않는다 (T-153 ⑤)', async () => {
    const marks = (writes: { id: string; data: any }[], id: string) =>
      writes.filter((w) => w.id === id && ('lastCheckedAt' in w.data || 'lastAttemptedAt' in w.data || 'lastCheckError' in w.data)).map((w) => w.data);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // 판 목록을 받는 사이에 실행 시간이 다 간다(또는 일부가 간다)
      const pass = (share: number) => vi.setSystemTime(Date.now() + runBudgetMs() * share + 1);
      const jump = () => pass(1);
      const first = setup({ onList: jump });
      const run = await first.service.run({ trigger: 'manual' });
      expect(run.results[0]).toMatchObject({ outcome: 'failed', remaining: 2, error: expect.stringContaining('확인 시간 안에 새 판을 하나도 반영하지 못했습니다') });
      expect(run.results[0].note).toContain('차례를 뒤로 돌렸습니다');
      expect(run).toMatchObject({ status: 'failed', failedCount: 1 }); // 그 법령만 돈 실행은 실패 실행이 된다 — 멈춤 경고·종료 코드로 드러난다
      expect(marks(first.calls.lawWrites, 'law-1')).toEqual([{ lastAttemptedAt: expect.any(Date), lastCheckError: expect.stringContaining('확인 시간 안에') }]);

      // 둘째 법령은 앞 법령이 실행 시간의 절반 넘게 쓴 뒤 시작했다 — 실패가 아니고 아무것도 쓰지 않는다(앞선 오류를 지우지 않고 앞에 남는다)
      const late = setup({ twoLaws: true, onList: (n) => (n === 1 ? pass(0.6) : jump()) });
      const run2 = await late.service.run({ trigger: 'manual' });
      expect(run2.results.map((r: any) => r.outcome)).toEqual(['updated', 'unchanged']);
      expect(run2.status).toBe('succeeded');
      expect(run2.results[1].note).toContain('다음 동기화가 이어서 반영합니다(실행 시간 상한)');
      expect(marks(late.calls.lawWrites, 'law-2')).toEqual([]);

      // 첫 법령이 법제처를 부르지 않고 바로 실패한 옛 행이면 둘째 법령은 실행 시간을 거의 다 받았다 — 순서가 아니라 시간으로 가른다
      const afterNoLawId = setup({ twoLaws: true, firstNoLawId: true, onList: jump });
      const run3 = await afterNoLawId.service.run({ trigger: 'manual' });
      expect(run3.results.map((r: any) => r.outcome)).toEqual(['failed', 'failed']);
      expect(run3.status).toBe('failed'); // 확인에 성공한 법령이 없는 실행을 일부 실패(성공 실행)로 세지 않는다
      expect(marks(afterNoLawId.calls.lawWrites, 'law-2')).toEqual([{ lastAttemptedAt: expect.any(Date), lastCheckError: expect.stringContaining('확인 시간 안에') }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('넉넉함의 경계는 남은 시간이 전체 실행 시간의 절반 — 꼭 절반이면 늦게 시작한 것, 1ms 라도 많으면 넉넉히 시작한 것 (T-153 ⑤)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const budget = runBudgetMs();
      // 첫 법령이 판 목록을 받는 사이에 spent 만큼 지나고, 둘째 법령은 판 목록을 받는 사이에 실행 시간이 다 간다
      const outcomes = async (spent: number) => {
        const t0 = Date.now();
        const { service } = setup({ twoLaws: true, onList: (n) => vi.setSystemTime(n === 1 ? t0 + spent : t0 + budget + 1) });
        return (await service.run({ trigger: 'manual' })).results.map((r: any) => r.outcome);
      };
      expect(await outcomes(budget / 2)).toEqual(['updated', 'unchanged']);
      expect(await outcomes(budget / 2 - 1)).toEqual(['updated', 'failed']);
    } finally {
      vi.useRealTimers();
    }
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
    expect(calls.lawUpdates).toContainEqual({ lastAttemptedAt: expect.any(Date), lastCheckError: expect.stringContaining('법령ID 가 없는 옛 법령') });
    expect(calls.lawUpdates.filter((d) => 'lastCheckedAt' in d)).toEqual([]); // 실패는 확인 시각을 찍지 않는다(T-153 ⑤)
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

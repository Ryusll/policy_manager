import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverResult, reportAfterRefresh, type ResultSinks } from '../apps/web/src/lib/policyResult';
import { subscribeClearStale } from '../apps/web/src/lib/toolStatus';

/**
 * T-224 ④ — 결과 알림의 낡음 길: 받기 실패를 알리는 결과(kind stale)는 시작한 화면·같은 규정을 다시 그린 화면의 도구 줄에 낡음 표시로
 * 남고(그 조회를 그 뒤에 받으면 걷힌다), 옮겼으면 이름 붙은 실패 알림. 끝난 쓰기의 결과는 reportAfterRefresh 하나로 고른다.
 */
const t = (k: string, v?: Record<string, string | number>) => (k === 'policyDetail.result.forPolicy' ? `${v?.label} — ${v?.message}` : k);
const KEYS = [['policy', 'A']];
function sinks(over: Partial<ResultSinks> = {}) {
  return { flash: vi.fn(), fail: vi.fn(), failStale: vi.fn(), settle: vi.fn(), isSticky: () => false, holds: () => false, toast: vi.fn(), ...over };
}
/** 화면이 떠 있는 동안처럼 받기 성공을 적는다(구독) — 그 때(ms)에 그 조회를 실제로 받는다 */
async function receivedAt(qc: QueryClient, key: readonly unknown[], at: number) {
  const now = vi.spyOn(Date, 'now').mockReturnValue(at);
  await qc.fetchQuery({ queryKey: key, queryFn: () => Promise.resolve({ at }) });
  now.mockRestore();
}
const here = { id: 'A', mounted: true };
const away = { id: 'B', mounted: true };

describe('결과 알림의 낡음 길 (T-224 ④ — deliverResult)', () => {
  it('시작한 규정을 보고 있으면 도구 줄에 낡음 표시(받지 못한 조회와 함께) — 보통 실패·잠깐 알림이 아니다', () => {
    const s = sinks();
    deliverResult(here, s, t, { startedId: 'A', label: 'A-01', message: '받아 오지 못했습니다.', kind: 'stale', staleKeys: KEYS, source: 'info' });
    expect(s.failStale).toHaveBeenCalledWith('받아 오지 못했습니다.', KEYS, 'info');
    expect(s.fail).not.toHaveBeenCalled();
    expect(s.flash).not.toHaveBeenCalled();
    expect(s.toast).not.toHaveBeenCalled();
  });

  it('옮겼어도 같은 규정을 다시 그린 화면이 있으면 그 화면의 도구 줄에 낡음 표시', () => {
    const screen = sinks();
    const s = sinks({ screenFor: (id) => (id === 'A' ? screen : undefined) });
    deliverResult(away, s, t, { startedId: 'A', label: 'A-01', message: '받아 오지 못했습니다.', kind: 'stale', staleKeys: KEYS });
    expect(screen.failStale).toHaveBeenCalledWith('받아 오지 못했습니다.', KEYS, undefined);
    expect(s.failStale).not.toHaveBeenCalled();
  });

  it('그 규정을 그리는 화면이 없으면 이름 붙은 실패 알림(머무는 시간은 기본)', () => {
    const s = sinks();
    deliverResult(away, s, t, { startedId: 'A', label: 'A-01', message: '받아 오지 못했습니다.', kind: 'stale', staleKeys: KEYS });
    expect(s.toast).toHaveBeenCalledWith('A-01 — 받아 오지 못했습니다.', 'error');
  });

  it('작업 이름(source)을 단 실패는 그 이름과 함께 남기고, 같은 작업의 성공은 그 줄을 먼저 걷는다 — 남은 실패가 있으면 알림으로', () => {
    const s = sinks();
    deliverResult(here, s, t, { startedId: 'A', label: 'A-01', message: '저장하지 못했습니다.', kind: 'error', source: 'info' });
    expect(s.fail).toHaveBeenCalledWith('저장하지 못했습니다.', 'info');
    const order: string[] = [];
    const sticky = sinks({ settle: vi.fn(() => order.push('settle')), holds: () => (order.push('holds?'), true) });
    deliverResult(here, sticky, t, { startedId: 'A', label: 'A-01', message: '저장했습니다.', kind: 'success', source: 'info' });
    expect(sticky.settle).toHaveBeenCalledWith('info');
    expect(order).toEqual(['settle', 'holds?']); // 걷은 뒤에 칸이 비었는지 본다 — 비었으면 잠깐 알림, 남은 실패·진행 문구가 있으면 알림
    expect(sticky.toast).toHaveBeenCalledWith('A-01 — 저장했습니다.', 'success');
    const plain = sinks();
    deliverResult(here, plain, t, { startedId: 'A', label: 'A-01', message: '저장했습니다.', kind: 'success' });
    expect(plain.settle).not.toHaveBeenCalled();
    expect(plain.flash).toHaveBeenCalledWith('저장했습니다.', 3000);
  });

  it('긴 안내만 알림에도 그만큼 오래 — 기본값보다 짧게 줄이지는 않는다', () => {
    const s = sinks();
    deliverResult(away, s, t, { startedId: 'A', label: 'A-01', message: '폐지했습니다 — …', kind: 'success', flashMs: 9000 });
    expect(s.toast).toHaveBeenLastCalledWith('A-01 — 폐지했습니다 — …', 'success', 9000);
    deliverResult(away, s, t, { startedId: 'A', label: 'A-01', message: '저장했습니다.', kind: 'success', flashMs: 3000 });
    expect(s.toast).toHaveBeenLastCalledWith('A-01 — 저장했습니다.', 'success');
  });
});

afterEach(() => vi.restoreAllMocks());

describe('끝난 쓰기의 결과 (T-224 ④ — reportAfterRefresh)', () => {
  it('다시 받았으면 완료 문구를 성공으로(잠깐 시간과 함께)', () => {
    const report = vi.fn();
    reportAfterRefresh(new QueryClient(), report, t, { startedId: 'A', label: 'A-01', done: '저장했습니다.', received: true, since: 0, flashMs: 4000, source: 'publish' });
    expect(report).toHaveBeenCalledWith('A', 'A-01', '저장했습니다.', 'success', { flashMs: 4000, source: 'publish' });
  });

  it('받지 못했으면 완료 문구에 받지 못했다는 덧붙임을 달아 낡음 표시로 — 규정 본문 key 와 함께', () => {
    const qc = new QueryClient();
    qc.setQueryData(['policy', 'A'], { id: 'A' }, { updatedAt: 1000 });
    const report = vi.fn();
    reportAfterRefresh(qc, report, t, { startedId: 'A', label: 'A-01', done: '저장했습니다.', received: false, since: 2000, source: 'info' });
    expect(report).toHaveBeenCalledWith('A', 'A-01', '저장했습니다. policyDetail.result.refreshFailed', 'stale', { staleKeys: [['policy', 'A']], source: 'info' });
  });

  it('내 받기는 실패했어도 받기를 시작한 뒤 다른 받기가 이미 받았으면 성공으로 — 낡음 표시를 달지 않는다', async () => {
    const qc = new QueryClient();
    const off = subscribeClearStale(qc, { received: vi.fn() });
    await receivedAt(qc, ['policy', 'A'], 3000);
    const report = vi.fn();
    reportAfterRefresh(qc, report, t, { startedId: 'A', label: 'A-01', done: '저장했습니다.', received: false, since: 2000 });
    expect(report).toHaveBeenCalledWith('A', 'A-01', '저장했습니다.', 'success', { flashMs: undefined, source: undefined });
    off();
  });

  it('손으로 넣은 값(setQueryData)은 받은 것으로 치지 않는다 — 받기 성공 알림과 같은 판정(재검토 #7)', () => {
    const qc = new QueryClient();
    const off = subscribeClearStale(qc, { received: vi.fn() });
    qc.setQueryData(['policy', 'A'], { id: 'A' }, { updatedAt: 3000 });
    const report = vi.fn();
    reportAfterRefresh(qc, report, t, { startedId: 'A', label: 'A-01', done: '저장했습니다.', received: false, since: 2000 });
    expect(report).toHaveBeenCalledWith('A', 'A-01', '저장했습니다. policyDetail.result.refreshFailed', 'stale', { staleKeys: [['policy', 'A']], source: undefined });
    off();
  });

  it('기다릴 조회를 따로 줄 수 있다(목록 등) — 받지 못한 것만 싣는다', async () => {
    const qc = new QueryClient();
    const off = subscribeClearStale(qc, { received: vi.fn() });
    await receivedAt(qc, ['policy', 'A'], 3000);
    off();
    const report = vi.fn();
    const keys = [['policy', 'A'], ['versions', 'a1']];
    reportAfterRefresh(qc, report, t, { startedId: 'A', label: 'A-01', done: '승인했습니다.', received: false, since: 2000, keys });
    expect(report).toHaveBeenCalledWith('A', 'A-01', '승인했습니다. policyDetail.result.refreshFailed', 'stale', { staleKeys: [['versions', 'a1']], source: undefined });
  });
});

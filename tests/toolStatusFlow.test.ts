import { QueryClient } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T-224 ④ 검토 #2·#7 — 규정 정보 저장의 결과 흐름을 실제 조회 캐시·도구 줄 상태·결과 알림으로 잇는다(화면의 onSuccess·onError 와 같은
 * 차례): 저장 실패(작업 이름 'info') → 다시 저장해 성공했지만 다시 받기 실패(같은 작업의 줄을 낡음 표시로 바꾼다) → 화면이 그 규정을
 * 받으면 걷힌다. 저장 실패 → 다시 저장해 받기까지 성공이면 그 줄이 걷히고, PDF 줄이 남아 있으면 성공은 이름 붙은 알림으로. 받기를
 * 시작한 때(since)는 받는 중이던 첫 받기가 끝난 뒤다(저장 전에 보냈을 수 있는 받기의 값을 받은 것으로 치지 않게).
 */
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../apps/web/src/api/policies', () => ({ policiesApi: { get: api.get } }));
const { useToolStatus, subscribeClearStale } = await import('../apps/web/src/lib/toolStatus');
const { useReportResult, reportAfterRefresh } = await import('../apps/web/src/lib/policyResult');
const { fetchPolicyNowSince } = await import('../apps/web/src/lib/policyRefresh');
const { useToastStore } = await import('../apps/web/src/stores/toastStore');

const t = (k: string, v?: Record<string, string | number>) => (k === 'policyDetail.result.forPolicy' ? `${v?.label} — ${v?.message}` : k);
const POLICY = ['policy', 'A'];
const SAVED = '규정 정보를 저장했습니다.';
const FAILED = '날짜·알림을 저장하지 못했습니다.';
const PDF = 'PDF 를 만들지 못했습니다.';

function screen() {
  const setMsg = vi.fn();
  const flash = vi.fn();
  let status!: ReturnType<typeof useToolStatus>;
  let report!: ReturnType<typeof useReportResult>;
  const C = () => {
    status = useToolStatus(setMsg, flash);
    report = useReportResult({ id: 'A', mounted: true }, status, t);
    return null;
  };
  renderToStaticMarkup(createElement(C));
  return { status, report, flash, last: () => setMsg.mock.calls.at(-1)?.[0] };
}
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** 화면의 규정 정보 저장 결과(PolicyDetailPage infoMutation 의 onSuccess·onError)와 같은 차례 */
async function saveInfo(s: ReturnType<typeof screen>, qc: QueryClient, saved: boolean) {
  if (!saved) return s.report('A', 'A-01', FAILED, 'error', { source: 'info' });
  const { fresh, since } = await fetchPolicyNowSince(qc, 'A', () => true);
  reportAfterRefresh(qc, s.report, t, { startedId: 'A', label: 'A-01', done: SAVED, received: fresh !== null, since, source: 'info' });
}

// 알림 저장소는 window.setTimeout 을 쓴다(시험은 node) — 잘못된 길로 알림을 띄워도 멈추지 않고 단언으로 걸리게 모든 시험에 둔다
beforeEach(() => vi.stubGlobal('window', globalThis));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  api.get.mockReset();
  useToastStore.getState().clear();
});

describe('규정 정보 저장의 결과 흐름 (T-224 ④ 검토 #7)', () => {
  it('저장 실패 → 다시 저장(받기 실패)은 같은 줄을 낡음 표시로 바꾸고, 화면이 그 규정을 받으면 걷힌다 — PDF 줄은 남는다', async () => {
    const qc = client();
    const s = screen();
    const off = subscribeClearStale(qc, s.status);
    s.status.fail(PDF);
    await saveInfo(s, qc, false);
    expect(s.last()).toBe(`${PDF} / ${FAILED}`);
    api.get.mockRejectedValueOnce(new Error('down'));
    await saveInfo(s, qc, true);
    expect(s.last()).toBe(`${PDF} / ${SAVED} policyDetail.result.refreshFailed`);
    api.get.mockResolvedValueOnce({ id: 'A' });
    await qc.fetchQuery({ queryKey: POLICY, queryFn: () => api.get('A') }); // 화면이 다시 받는다(탭 돌아오기 등)
    expect(s.last()).toBe(PDF);
    off();
  });

  it('저장 실패 → 다시 저장해 받기까지 성공하면 실패 줄이 걷힌다 — 남은 실패가 없으면 잠깐 알림, PDF 줄이 있으면 이름 붙은 알림', async () => {
    const a = screen();
    await saveInfo(a, client(), false);
    api.get.mockResolvedValueOnce({ id: 'A' });
    await saveInfo(a, client(), true);
    expect(a.last()).toBe('');
    expect(a.flash).toHaveBeenCalledWith(SAVED, 3000);
    const b = screen();
    b.status.fail(PDF);
    await saveInfo(b, client(), false);
    api.get.mockResolvedValueOnce({ id: 'A' });
    await saveInfo(b, client(), true);
    expect(b.last()).toBe(PDF);
    expect(b.flash).not.toHaveBeenCalled();
    expect(useToastStore.getState().items.map((i) => i.message)).toEqual([`A-01 — ${SAVED}`]);
  });
});

describe('진행 문구의 주인 (T-224 ④ 재검토 #3 — show·holds)', () => {
  it('내보내기 중에 끝난 저장의 성공은 진행 문구를 덮지 않고 이름 붙은 알림으로 — 주인(pdf)의 성공은 도구 줄의 잠깐 알림', () => {
    const s = screen();
    s.status.show('PDF 를 만드는 중…', 'pdf');
    s.report('A', 'A-01', SAVED, 'success', { source: 'info' });
    expect(s.last()).toBe('PDF 를 만드는 중…');
    expect(s.flash).not.toHaveBeenCalled();
    expect(useToastStore.getState().items.map((i) => i.message)).toEqual([`A-01 — ${SAVED}`]);
    s.report('A', 'A-01', 'PDF를 내려받았습니다.', 'success', { flashMs: 3000, source: 'pdf' });
    expect(s.flash).toHaveBeenCalledWith('PDF를 내려받았습니다.', 3000);
    expect(s.status.holds()).toBe(false);
  });

  it('진행 중에 다른 작업이 실패하면 실패를 보이고, 그 줄이 걷히면 진행 문구로 돌아간다 — 주인의 실패는 칸을 차지한다', () => {
    const s = screen();
    s.status.show('PDF 를 만드는 중…', 'pdf');
    s.report('A', 'A-01', `${SAVED} policyDetail.result.refreshFailed`, 'stale', { staleKeys: [POLICY], source: 'info' });
    expect(s.last()).toBe(`${SAVED} policyDetail.result.refreshFailed`);
    s.status.received(POLICY);
    expect(s.last()).toBe('PDF 를 만드는 중…');
    s.report('A', 'A-01', FAILED, 'error', { source: 'info' });
    s.report('A', 'A-01', SAVED, 'success', { source: 'info' }); // 그 작업의 성공 — 실패 줄을 걷고, 진행 문구가 남아 있어 알림으로
    expect(s.last()).toBe('PDF 를 만드는 중…');
    s.report('A', 'A-01', PDF, 'error', { source: 'pdf' });
    expect(s.last()).toBe(PDF);
    expect(s.status.holds()).toBe(true); // 남긴 실패
    s.status.flash('주소를 복사했습니다.', 2500); // 사용자의 다음 동작은 남긴 줄을 바꾼다
    expect(s.status.holds()).toBe(false);
  });

  it('주인의 결과는 실패여도 진행을 끝낸다 — 그 줄이 걷혀도 끝난 진행 문구가 되살아나지 않는다(재검토 3차 #1)', () => {
    const s = screen();
    s.status.show('PDF 를 만드는 중…', 'pdf');
    s.status.failStale('PDF 를 만들었지만 받아 오지 못했습니다.', [POLICY], 'pdf');
    s.status.received(POLICY);
    expect(s.last()).toBe('');
    expect(s.status.holds()).toBe(false); // 다음 성공은 잠깐 알림으로
  });
});

describe('받기를 시작한 때 (T-224 ④ 검토 #2 — fetchPolicyNowSince)', () => {
  it('받는 중이던 첫 받기를 기다린 뒤에 잰다 — 저장 전에 보냈을 수 있는 그 받기의 값은 받은 것으로 치지 않는다', async () => {
    const qc = client();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    let release!: (v: unknown) => void;
    const first = qc.fetchQuery({ queryKey: POLICY, queryFn: () => new Promise((r) => (release = r)) });
    api.get.mockRejectedValueOnce(new Error('down'));
    const mine = fetchPolicyNowSince(qc, 'A', () => true);
    now.mockReturnValue(2000); // 저장 전에 보낸 첫 받기가 쓰기 뒤에 끝난다
    release({ id: 'A', before: true });
    await first;
    const { fresh, since } = await mine;
    expect(fresh).toBeNull();
    expect(since).toBe(2000);
    expect(api.get).toHaveBeenCalledTimes(1); // 첫 받기에 합류하지 않고 내 받기를 따로 보냈다
    const report = vi.fn();
    reportAfterRefresh(qc, report, t, { startedId: 'A', label: 'A-01', done: SAVED, received: fresh !== null, since });
    expect(report).toHaveBeenCalledWith('A', 'A-01', `${SAVED} policyDetail.result.refreshFailed`, 'stale', { staleKeys: [POLICY], source: undefined });
  });
});

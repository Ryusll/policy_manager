import { QueryClient } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * T-224 ④ — 도구 줄의 낡음 표시: 받기 실패를 알리는 줄은 그 조회들을 그 뒤에 받으면 그 줄만 걷힌다(다시 받기에 실패한 뒤 다시 저장해
 * 성공하면 '새로 고침해 확인'이 남지 않게 — C-116 ⑥). 받기 성공은 조회 캐시 알림(setQueryData 는 빼고)으로 알린다.
 */
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../apps/web/src/api/policies', () => ({ policiesApi: { get: api.get } }));
const { useToolStatus, subscribeClearStale, stillStale } = await import('../apps/web/src/lib/toolStatus');
const { useToastStore, toast, TOAST_MS } = await import('../apps/web/src/stores/toastStore');
const { fetchPolicyNow } = await import('../apps/web/src/lib/policyRefresh');

function toolStatus() {
  const setMsg = vi.fn();
  const flash = vi.fn();
  const setKind = vi.fn();
  let status: ReturnType<typeof useToolStatus> | undefined;
  const C = () => {
    status = useToolStatus(setMsg, flash, setKind);
    return null;
  };
  renderToStaticMarkup(createElement(C));
  return { status: status!, setMsg, setKind, last: () => setMsg.mock.calls.at(-1)?.[0], kind: () => setKind.mock.calls.at(-1)?.[0] };
}
const POLICY = ['policy', 'A'];
const VERSIONS = ['versions', 'a1'];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  api.get.mockReset();
  useToastStore.getState().clear();
});

describe('도구 줄의 낡음 표시 (T-224 ④ — failStale·received)', () => {
  it('받지 못한 조회를 그 뒤에 받으면 그 줄이 걷히고 칸이 빈다(실패 색도 풀린다)', () => {
    const s = toolStatus();
    s.status.failStale('저장했습니다. 다만 받아 오지 못했습니다.', [POLICY]);
    expect(s.last()).toBe('저장했습니다. 다만 받아 오지 못했습니다.');
    expect(s.kind()).toBe('error');
    expect(s.status.isSticky()).toBe(true);
    s.status.received(POLICY);
    expect(s.last()).toBe('');
    expect(s.kind()).toBe('info');
    expect(s.status.isSticky()).toBe(false);
  });

  it('남긴 다른 실패(PDF 등)는 둔다 — 낡음 표시 줄만 걷는다', () => {
    const s = toolStatus();
    s.status.fail('PDF 를 만들지 못했습니다.');
    s.status.failStale('저장했습니다. 다만 받아 오지 못했습니다.', [POLICY]);
    expect(s.last()).toBe('PDF 를 만들지 못했습니다. / 저장했습니다. 다만 받아 오지 못했습니다.');
    s.status.received(POLICY);
    expect(s.last()).toBe('PDF 를 만들지 못했습니다.');
    expect(s.status.isSticky()).toBe(true);
    expect(s.kind()).toBe('error');
  });

  it('받지 못한 조회가 여럿이면 모두 받아야 걷힌다 — 다른 조회의 성공으로는 걷히지 않는다', () => {
    const s = toolStatus();
    s.status.failStale('승인했습니다. 다만 받아 오지 못했습니다.', [POLICY, VERSIONS]);
    const calls = s.setMsg.mock.calls.length;
    s.status.received(['policy', 'A', 'effective-dates']); // 곁 조회는 다른 key
    s.status.received(['policy', 'B']);
    expect(s.setMsg.mock.calls.length).toBe(calls);
    s.status.received(POLICY);
    expect(s.status.isSticky()).toBe(true); // 판 목록이 아직
    s.status.received(VERSIONS);
    expect(s.last()).toBe('');
  });

  it('같은 낡음 문구가 다시 오면 글은 한 번만 보이고, 두 줄 모두 받아야 걷힌다', () => {
    const s = toolStatus();
    s.status.failStale('다만 받아 오지 못했습니다.', [POLICY]);
    s.status.failStale('다만 받아 오지 못했습니다.', [VERSIONS]);
    expect(s.last()).toBe('다만 받아 오지 못했습니다.');
    s.status.received(POLICY);
    expect(s.status.isSticky()).toBe(true);
    s.status.received(VERSIONS);
    expect(s.status.isSticky()).toBe(false);
  });

  it('기다릴 조회가 없으면 보통 실패와 같다(받기로 걷히지 않는다), 사용자의 다음 동작은 낡음 표시도 바꾼다', () => {
    const s = toolStatus();
    s.status.failStale('받아 오지 못했습니다.', []);
    s.status.received(POLICY);
    expect(s.status.isSticky()).toBe(true);
    s.status.failStale('받아 오지 못했습니다(2).', [POLICY]);
    s.status.show('PDF 를 만드는 중…');
    expect(s.last()).toBe('PDF 를 만드는 중…');
    expect(s.status.isSticky()).toBe(false);
  });
});

describe('작업 이름으로 걷기·같은 글 (T-224 ④ 검토 #1·#9 — source·settle)', () => {
  it('같은 작업의 실패는 앞 줄을 바꾸고(줄이 늘지 않는다), 그 작업이 성공하면 그 줄만 걷힌다 — PDF 줄은 남는다', () => {
    const s = toolStatus();
    s.status.fail('PDF 를 만들지 못했습니다.');
    s.status.fail('저장하지 못했습니다(1).', 'info');
    s.status.fail('저장하지 못했습니다(2).', 'info');
    expect(s.last()).toBe('PDF 를 만들지 못했습니다. / 저장하지 못했습니다(2).');
    s.status.failStale('저장했습니다. 다만 받아 오지 못했습니다.', [POLICY], 'info');
    expect(s.last()).toBe('PDF 를 만들지 못했습니다. / 저장했습니다. 다만 받아 오지 못했습니다.');
    s.status.settle('info');
    expect(s.last()).toBe('PDF 를 만들지 못했습니다.');
    expect(s.kind()).toBe('error');
  });

  it('같은 작업의 보통 실패는 그 작업의 받기 실패 줄을 남긴다 — 받으면 그 줄만, 그 작업이 성공하면 모두 걷힌다(재검토 #1)', () => {
    const s = toolStatus();
    s.status.failStale('저장했습니다. 다만 받아 오지 못했습니다.', [POLICY], 'info');
    s.status.fail('저장하지 못했습니다(1).', 'info');
    expect(s.last()).toBe('저장했습니다. 다만 받아 오지 못했습니다. / 저장하지 못했습니다(1).');
    s.status.fail('저장하지 못했습니다(2).', 'info'); // 보통 실패끼리는 바꾼다
    expect(s.last()).toBe('저장했습니다. 다만 받아 오지 못했습니다. / 저장하지 못했습니다(2).');
    s.status.received(POLICY);
    expect(s.last()).toBe('저장하지 못했습니다(2).');
    s.status.failStale('저장했습니다. 다만 받아 오지 못했습니다.', [POLICY], 'info'); // 낡음 표시는 그 작업의 줄을 모두 바꾼다
    expect(s.last()).toBe('저장했습니다. 다만 받아 오지 못했습니다.');
    s.status.failStale('다시 저장했습니다. 다만 받아 오지 못했습니다.', [VERSIONS], 'info'); // 낡음 표시끼리도 바꾼다
    expect(s.last()).toBe('다시 저장했습니다. 다만 받아 오지 못했습니다.');
    s.status.received(POLICY); // 바뀐 앞 줄의 조회를 받아도 그대로
    expect(s.status.isSticky()).toBe(true);
    s.status.fail('저장하지 못했습니다(3).', 'info');
    s.status.settle('info');
    expect(s.last()).toBe('');
    expect(s.status.isSticky()).toBe(false);
  });

  it('남은 줄이 그 작업 것뿐이면 칸이 비고 실패 색이 풀린다 — 다른 작업 이름의 성공은 다시 그리지 않는다', () => {
    const s = toolStatus();
    s.status.fail('상태를 바꾸지 못했습니다.', 'toggle');
    const calls = s.setMsg.mock.calls.length;
    s.status.settle('info');
    expect(s.setMsg.mock.calls.length).toBe(calls);
    s.status.settle('toggle');
    expect(s.last()).toBe('');
    expect(s.kind()).toBe('info');
    expect(s.status.isSticky()).toBe(false);
  });

  it('같은 글이 보통 실패와 낡음 표시로 오면 받아도 그 글은 남는다(어느 차례든) — 같은 실패를 거듭 받아도 한 번만', () => {
    const a = toolStatus();
    a.status.failStale('받아 오지 못했습니다.', [POLICY]);
    a.status.fail('받아 오지 못했습니다.');
    a.status.received(POLICY);
    expect(a.status.isSticky()).toBe(true);
    expect(a.last()).toBe('받아 오지 못했습니다.');
    const b = toolStatus();
    b.status.fail('받아 오지 못했습니다.');
    b.status.failStale('받아 오지 못했습니다.', [POLICY]);
    b.status.fail('받아 오지 못했습니다.');
    expect(b.last()).toBe('받아 오지 못했습니다.');
    b.status.received(POLICY);
    expect(b.status.isSticky()).toBe(true);
  });

  it('같은 글을 두 작업이 남겼으면 한 작업이 성공해도 그 글은 남는다 — 둘 다 성공해야 걷힌다', () => {
    const s = toolStatus();
    s.status.fail('권한이 없습니다.', 'info');
    s.status.fail('권한이 없습니다.', 'toggle');
    expect(s.last()).toBe('권한이 없습니다.');
    s.status.settle('info');
    expect(s.status.isSticky()).toBe(true);
    expect(s.last()).toBe('권한이 없습니다.');
    s.status.settle('toggle');
    expect(s.last()).toBe('');
  });
});

describe('받기 성공 알림 (T-224 ④ — subscribeClearStale·stillStale)', () => {
  it('조회를 받으면 그 key 로 알리고, 실패·setQueryData 는 알리지 않는다', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const status = { received: vi.fn() };
    const off = subscribeClearStale(qc, status);
    await qc.fetchQuery({ queryKey: POLICY, queryFn: () => Promise.resolve({ id: 'A' }) });
    expect(status.received).toHaveBeenCalledWith(POLICY);
    status.received.mockClear();
    await qc.fetchQuery({ queryKey: VERSIONS, queryFn: () => Promise.reject(new Error('down')) }).catch(() => undefined);
    qc.setQueryData(['policy', 'B'], { id: 'B' });
    expect(status.received).not.toHaveBeenCalled();
    off();
    await qc.fetchQuery({ queryKey: ['policy', 'C'], queryFn: () => Promise.resolve({}) });
    expect(status.received).not.toHaveBeenCalled(); // 풀면 더 알리지 않는다
  });

  it('실제 받기가 낡음 표시를 걷는다 — 다른 조회를 받아도 그대로', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const s = toolStatus();
    const off = subscribeClearStale(qc, s.status);
    s.status.failStale('다만 받아 오지 못했습니다.', [POLICY]);
    await qc.fetchQuery({ queryKey: ['policy', 'A', 'effective-dates'], queryFn: () => Promise.resolve([]) });
    expect(s.status.isSticky()).toBe(true);
    await qc.fetchQuery({ queryKey: POLICY, queryFn: () => Promise.resolve({ id: 'A' }) });
    expect(s.status.isSticky()).toBe(false);
    off();
  });

  it('받기를 시작한 뒤에 받은 조회는 낡음으로 달지 않는다 — 그 전에 받았거나·받은 적 없거나·손으로 넣은 값이면 낡은 쪽(재검토 #7)', async () => {
    const qc = new QueryClient();
    const off = subscribeClearStale(qc, { received: vi.fn() });
    const fetchAt = async (key: readonly unknown[], at: number) => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(at);
      await qc.fetchQuery({ queryKey: key, queryFn: () => Promise.resolve({ at }) });
      now.mockRestore();
    };
    await fetchAt(POLICY, 1000);
    await fetchAt(VERSIONS, 3000);
    qc.setQueryData(['comments', 'a1'], [], { updatedAt: 3000 }); // 손으로 넣은 값 — 받기가 아니다
    expect(stillStale(qc, [POLICY, VERSIONS, ['comments', 'a1'], ['files', 'A']], 2000)).toEqual([POLICY, ['comments', 'a1'], ['files', 'A']]);
    expect(stillStale(qc, [VERSIONS], 3000)).toEqual([VERSIONS]); // 같은 때는 낡은 쪽
    expect(stillStale(qc, [VERSIONS], 2000)).toEqual([]);
    qc.removeQueries({ queryKey: VERSIONS, exact: true }); // 캐시에서 빠지면(로그아웃의 비우기 등) 받은 때도 지운다(재검토 3차 #4)
    qc.setQueryData(VERSIONS, []);
    expect(stillStale(qc, [VERSIONS], 2000)).toEqual([VERSIONS]);
    off();
    expect(stillStale(new QueryClient(), [POLICY], 0)).toEqual([POLICY]); // 구독이 적은 것이 없으면 낡은 쪽
  });
});

describe('알림이 머무는 시간·로그아웃 뒤 받기 (T-224)', () => {
  it('알림은 기본 4.2초, 긴 안내는 정한 만큼 머문다', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis); // 알림 저장소는 window.setTimeout 을 쓴다(시험은 node)
    toast('짧은 알림', 'success');
    toast('긴 안내', 'success', 9000);
    vi.advanceTimersByTime(TOAST_MS);
    expect(useToastStore.getState().items.map((i) => i.message)).toEqual(['긴 안내']);
    vi.advanceTimersByTime(9000 - TOAST_MS);
    expect(useToastStore.getState().items).toEqual([]);
  });

  it('범위가 바뀌었으면(로그아웃·다른 사용자 로그인) 받지 않고 조회도 만들지 않는다', async () => {
    const qc = new QueryClient();
    expect(await fetchPolicyNow(qc, 'A', () => false)).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
    expect(qc.getQueryCache().find({ queryKey: POLICY })).toBeUndefined();
  });
});

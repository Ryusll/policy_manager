import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * T-215 16차 적대적 검토 반영 — 끝난 뒤 다시 받기(lib/policyRefresh.fetchPolicyNow)는 본 조회만, 진행 중인 받기를 끊고, 다른 다시 받기에
 * 끊기면 다시 받되 인증 주체가 바뀌면 멈추고, 오프라인이어도 멈춰 기다리지 않는다(#2·#3·#4·회귀 #2·#3·#5). 그 사이 로그아웃했으면
 * 아무것도 알리지 않는다(#2 — T-181). 저장은 됐는데 새 순서를 받지 못하면 알린다(#5). 빈 장은 순서 서명에 넣지 않는다(회귀 #4).
 */
const api = vi.hoisted(() => ({ reorder: vi.fn(), get: vi.fn() }));
vi.mock('../apps/web/src/api/policies', () => ({ policiesApi: { reorderArticles: api.reorder, get: api.get } }));
const { fetchPolicyNow } = await import('../apps/web/src/lib/policyRefresh');
const { endAuthScope } = await import('../apps/web/src/lib/authScope');
const { joOrderSignature, useReorderSave } = await import('../apps/web/src/components/policy-detail/useReorderSave');
const { usePolicyRunsStore } = await import('../apps/web/src/stores/policyRunsStore');

function capture<T>(hook: () => T, client: QueryClient): T {
  let out: T | undefined;
  const C = () => {
    out = hook();
    return null;
  };
  const el: ReactElement = createElement(QueryClientProvider, { client }, createElement(C));
  renderToStaticMarkup(el);
  return out as T;
}
const t = (k: string) => k;
const always = () => true;
afterEach(() => {
  usePolicyRunsStore.getState().clear();
  vi.clearAllMocks();
});

const before = [{ id: 'c1', number: 1, articles: [{ id: 'a1', number: 1 }, { id: 'a2', number: 2 }] }];
const ours = [{ id: 'c1', number: 1, articles: [{ id: 'a2', number: 1 }, { id: 'a1', number: 2 }] }];
const swap = [
  { chapterId: 'c1', jo: 2 },
  { chapterId: 'c1', jo: 1 },
];

describe('끝난 뒤 다시 받기 (T-215 16~20차 — lib/policyRefresh)', () => {
  const newest = [{ id: 'c1', number: 1, articles: [{ id: 'a2', number: 1 }, { id: 'a1', number: 2 }, { id: 'a3', number: 3 }] }];
  // 화면 조회 — 시험에서는 화면 대신 fetchQuery 로 받기를 시작한다(재시도 없음)
  const quiet = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const deferred = () => {
    let resolve: (v: unknown) => void = () => undefined;
    let reject: (e: unknown) => void = () => undefined;
    const promise = new Promise((r, j) => {
      resolve = r;
      reject = j;
    });
    return { promise, resolve, reject };
  };

  it('저장 전에 시작해 진행 중인 화면 조회는 조용히 끊고 새로 받는다 — 그 조회를 시작한 쪽도 새 본문으로 이어지고, 늦게 온 옛 응답은 버린다', async () => {
    const client = quiet();
    client.setQueryData(['policy', 'A'], { chapters: before });
    const old = deferred();
    const screen = client.fetchQuery({ queryKey: ['policy', 'A'], queryFn: () => old.promise, staleTime: 0 });
    api.get.mockResolvedValueOnce({ chapters: ours });
    expect(await fetchPolicyNow(client, 'A', always)).toEqual({ chapters: ours });
    expect(await screen).toEqual({ chapters: ours });
    old.resolve({ chapters: before });
    await new Promise((r) => setTimeout(r, 0));
    expect(client.getQueryData(['policy', 'A'])).toEqual({ chapters: ours });
  });

  it('받는 사이 다른 저장의 다시 받기(무효화)가 이 받기를 끊으면 그 받기로 이어진다 — 더 새 본문을 돌려주고 캐시도 그 값', async () => {
    const client = quiet();
    client.setQueryData(['policy', 'A'], { chapters: before });
    const mine = deferred();
    api.get.mockImplementationOnce(() => mine.promise);
    api.get.mockResolvedValueOnce({ chapters: newest });
    const result = fetchPolicyNow(client, 'A', always);
    await client.refetchQueries({ queryKey: ['policy', 'A'], exact: true });
    mine.resolve({ chapters: ours }); // 끊긴 받기의 늦은 응답은 버려진다
    expect(await result).toEqual({ chapters: newest });
    expect(client.getQueryData(['policy', 'A'])).toEqual({ chapters: newest });
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('같은 규정의 다시 받기 둘이 겹치면 둘 다 뒤 받기의 값으로 끝난다 — 먼저 보낸 받기의 늦은 응답이 덮지 않는다', async () => {
    const client = quiet();
    client.setQueryData(['policy', 'A'], { chapters: before });
    const first = deferred();
    api.get.mockImplementationOnce(() => first.promise);
    api.get.mockResolvedValueOnce({ chapters: newest });
    const a = fetchPolicyNow(client, 'A', always);
    const b = fetchPolicyNow(client, 'A', always);
    first.resolve({ chapters: ours });
    expect(await a).toEqual({ chapters: newest });
    expect(await b).toEqual({ chapters: newest });
    expect(client.getQueryData(['policy', 'A'])).toEqual({ chapters: newest });
  });

  it('다시 받기가 실패하면 null — 본 조회는 오류·낡음으로 남아 다음에 보는 화면이 다시 받는다(따로 다시 시도하지 않는다)', async () => {
    // 앱과 같은 기본값(재시도 1번) — 그래도 이 받기는 다시 시도하지 않는다(서버 쪽 판정이라 vitest 의 TanStack 기본값은 재시도 0)
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 1 } } });
    client.setQueryData(['policy', 'A'], { chapters: before });
    api.get.mockImplementation(() => Promise.reject(new Error('down')));
    try {
      expect(await fetchPolicyNow(client, 'A', always)).toBeNull();
      expect(api.get).toHaveBeenCalledTimes(1);
      expect(client.getQueryState(['policy', 'A'])?.isInvalidated).toBe(true);
    } finally {
      api.get.mockReset();
    }
  });

  it('이 받기가 다른 받기에 이어졌는데 그 받기가 실패하면 null(옛 값을 새 값으로 보지 않는다)', async () => {
    const client = quiet();
    client.setQueryData(['policy', 'A'], { chapters: before });
    const mine = deferred();
    api.get.mockImplementationOnce(() => mine.promise);
    api.get.mockRejectedValueOnce(new Error('down'));
    const result = fetchPolicyNow(client, 'A', always);
    await client.refetchQueries({ queryKey: ['policy', 'A'], exact: true });
    expect(await result).toBeNull();
    expect(client.getQueryData(['policy', 'A'])).toEqual({ chapters: before });
  });

  // T-227 로 바뀐 동작: 끊으면 그 받기를 기다리던 쪽(다른 작업의 이 함수)이 받지 못한 것으로 끝나서(21차), 끊지 않고 기다린다
  it('값이 없는 채 받는 중이면(캐시가 지워졌다 다시 그린 첫 받기) 합류하지 않고 끝나기를 기다린 뒤 새로 받는다 — 그 받기의 옛 값은 쓰지 않는다', async () => {
    const client = quiet();
    const old = deferred();
    void client.fetchQuery({ queryKey: ['policy', 'A'], queryFn: () => old.promise }).catch(() => undefined);
    api.get.mockResolvedValueOnce({ chapters: ours });
    const result = fetchPolicyNow(client, 'A', always);
    await new Promise((r) => setTimeout(r, 0));
    expect(api.get).not.toHaveBeenCalled(); // 끊고 새로 받지 않는다 — 끝나기를 기다린다
    old.resolve({ chapters: before });
    expect(await result).toEqual({ chapters: ours });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['policy', 'A'])).toEqual({ chapters: ours });
  });

  it('캐시에 그 규정이 없어도 새로 받는다', async () => {
    api.get.mockResolvedValueOnce({ chapters: ours });
    expect(await fetchPolicyNow(quiet(), 'A', always)).toEqual({ chapters: ours });
  });

  it('오프라인이라 받기가 멈추면 기다리지 않고 null — 다시 연결되면 받기가 이어진다', async () => {
    const { onlineManager } = await import('@tanstack/react-query');
    const client = quiet();
    client.mount(); // 다시 연결을 듣는 것은 붙은(mount) 클라이언트다 — 앱에서는 QueryClientProvider 가 붙인다
    client.setQueryData(['policy', 'A'], { chapters: before });
    api.get.mockResolvedValueOnce({ chapters: ours });
    onlineManager.setOnline(false);
    try {
      expect(await fetchPolicyNow(client, 'A', always)).toBeNull();
      expect(api.get).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
    await vi.waitFor(() => expect(client.getQueryData(['policy', 'A'])).toEqual({ chapters: ours }));
    client.unmount();
  });

  it('인증 주체가 바뀌었으면 null — 로그아웃 뒤 결과는 알리지 않는다', async () => {
    const client = quiet();
    let inScope = true;
    api.get.mockImplementationOnce(() => {
      inScope = false;
      return Promise.resolve({ chapters: ours });
    });
    expect(await fetchPolicyNow(client, 'A', () => inScope)).toBeNull();
  });

  it('그 아래 조회(시점 본문 등)는 바로 다시 받게 하되(refetchType 기본값 active) 기다리지 않는다 — 본 조회만 다시 받는다', async () => {
    const client = quiet();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    api.get.mockResolvedValueOnce({ chapters: ours });
    await fetchPolicyNow(client, 'A', always);
    const filter = invalidate.mock.calls[0][0] as { queryKey: unknown[]; refetchType?: string; predicate: (q: { queryKey: unknown[] }) => boolean };
    expect(filter.queryKey).toEqual(['policy', 'A']);
    expect(filter.refetchType).toBeUndefined();
    expect(filter.predicate({ queryKey: ['policy', 'A'] })).toBe(false);
    expect(filter.predicate({ queryKey: ['policy', 'A', 'as-of', '2026-01-01'] })).toBe(true);
  });

  // 화면에 붙은 곁 조회는 위 무효화(refetchType active)가 다시 받는다 — 값이 있으면 진행 중인 받기를 끊고 새로 받고(그 조회를 기다리던
  // 쪽은 새 받기로 이어진다), 값 없이 첫 받기 중이면 그 받기에 합류한다(21·22차)
  it('직접 끊는 것은 본 조회뿐이다 — 화면에 붙지 않은 진행 중 곁 조회(시점 본문)는 다시 받지 않고 제 값으로 끝난다', async () => {
    const client = quiet();
    client.setQueryData(['policy', 'A', 'as-of', '2026-01-01'], { chapters: before });
    const asOfFetch = deferred();
    const asOfFn = vi.fn(() => asOfFetch.promise);
    const asOf = client.fetchQuery({ queryKey: ['policy', 'A', 'as-of', '2026-01-01'], queryFn: asOfFn, staleTime: 0 });
    api.get.mockResolvedValueOnce({ chapters: ours });
    await fetchPolicyNow(client, 'A', always);
    asOfFetch.resolve({ chapters: newest }); // 본 조회 값(ours)과 다른 값 — 끊겨 다시 받았으면 부른 수가 2다
    expect(await asOf).toEqual({ chapters: newest });
    expect(asOfFn).toHaveBeenCalledTimes(1);
  });
});

describe('조 순서 저장 — 로그아웃·성공 뒤 받기 (T-215 16차 #2·#5)', () => {
  const setup = () => {
    const client = new QueryClient();
    client.setQueryData(['policy', 'A'], { chapters: before });
    const o = { id: 'A', label: 'A-01 가 규정', panelOpen: false, chapters: before, signature: joOrderSignature(before), shown: { id: 'A', mounted: false }, report: vi.fn(), setError: vi.fn(), onSaved: vi.fn(), t };
    return { o, save: () => capture(() => useReorderSave(o), client).save(swap) };
  };

  it('실패 뒤 다시 받는 사이 로그아웃했으면 아무것도 알리지 않는다 — 앞 사람의 규정 이름이 다음 화면에 남지 않게', async () => {
    api.reorder.mockRejectedValueOnce(new Error('504'));
    api.get.mockImplementationOnce(() => {
      endAuthScope();
      return Promise.resolve({ chapters: ours });
    });
    const { o, save } = setup();
    await save();
    expect(o.report).not.toHaveBeenCalled();
    expect(o.onSaved).not.toHaveBeenCalled();
    expect(usePolicyRunsStore.getState().running).toEqual([]);
  });

  it('성공 뒤 다시 받는 사이 로그아웃했어도 아무것도 하지 않는다', async () => {
    api.reorder.mockResolvedValueOnce(undefined);
    api.get.mockImplementationOnce(() => {
      endAuthScope();
      return Promise.resolve({ chapters: ours });
    });
    const { o, save } = setup();
    await save();
    expect(o.report).not.toHaveBeenCalled();
    expect(o.onSaved).not.toHaveBeenCalled();
  });

  it('저장은 됐는데 새 순서를 받지 못하면 창을 닫고 그렇다고 알린다 — 옛 순서가 남은 창을 다시 열어 같은 이동을 또 보내지 않게', async () => {
    api.reorder.mockResolvedValueOnce(undefined);
    api.get.mockRejectedValueOnce(new Error('down'));
    const { o, save } = setup();
    await save();
    expect(o.onSaved).toHaveBeenCalledTimes(1);
    expect(o.report).toHaveBeenCalledWith('A', 'A-01 가 규정', 'policyDetail.reorder.savedStale', 'error');
  });

  it('5xx 가 까닭을 실었으면 반영됐는지 모른다는 글의 틀 안에 그 까닭을 넣는다(창은 닫는다, 17차 #6)', async () => {
    api.reorder.mockRejectedValueOnce({ response: { status: 500, data: { message: '순서 저장 실패(시험)' } } });
    api.get.mockResolvedValueOnce({ chapters: before });
    const { o, save } = setup();
    o.t = (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k);
    await save();
    expect(o.onSaved).toHaveBeenCalledTimes(1);
    expect(o.report).toHaveBeenCalledWith('A', 'A-01 가 규정', 'policyDetail.reorder.unverifiedWhy:{"reason":"순서 저장 실패(시험)"}', 'error');
  });

  it('저장하고 새 순서도 받았으면 창만 닫는다(알림 없음)', async () => {
    api.reorder.mockResolvedValueOnce(undefined);
    api.get.mockResolvedValueOnce({ chapters: ours });
    const { o, save } = setup();
    await save();
    expect(o.onSaved).toHaveBeenCalledTimes(1);
    expect(o.report).not.toHaveBeenCalled();
  });
});

describe('문구 (T-215 16차 #5·#7)', () => {
  it("반영·확인 못함 문구는 '응답을 받지 못했다'고 하지 않는다(5xx 에도 쓴다) — 저장했지만 못 받음 문구가 ko·en 에 있다", async () => {
    const { messages } = await import('../apps/web/src/i18n/messages');
    for (const lang of ['ko', 'en'] as const) {
      for (const k of ['appliedAnyway', 'unverified', 'savedStale']) expect(messages[lang][`policyDetail.reorder.${k}`], `${lang} ${k}`).toBeTruthy();
      // 17차 — 서버 까닭은 문구 틀 안에, 다시 받지 못했다는 덧붙임
      expect(messages[lang]['policyDetail.reorder.unverifiedWhy'], `${lang} unverifiedWhy`).toContain('{reason}');
      expect(messages[lang]['policyDetail.result.refreshFailed'], `${lang} refreshFailed`).toBeTruthy();
    }
    expect(messages.ko['policyDetail.reorder.appliedAnyway']).not.toContain('응답을 받지 못했');
    expect(messages.ko['policyDetail.reorder.unverified']).not.toContain('응답을 받지 못했');
    expect(messages.en['policyDetail.reorder.appliedAnyway']).not.toContain('did not arrive');
  });
});

describe('순서 서명 — 빈 장은 넣지 않는다 (T-215 16차 회귀 #4)', () => {
  it('다른 사람이 빈 장을 더하거나 지워도 서명은 같고(옮기던 것이 사라지지 않게), 조가 있는 장의 번호가 바뀌면 다르다', () => {
    const one = [{ id: 'c1', number: 1, articles: [{ id: 'x', number: 1 }] }];
    expect(joOrderSignature([...one, { id: 'c9', number: 2, articles: [] }])).toBe(joOrderSignature(one));
    expect(joOrderSignature([...one, { id: 'c9', number: 2 }])).toBe(joOrderSignature(one));
    expect(joOrderSignature([{ ...one[0], number: 3 }])).not.toBe(joOrderSignature(one));
  });
});

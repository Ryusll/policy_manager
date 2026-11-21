import { focusManager, onlineManager, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { always, before, deferred, flush, KEY, never, newest, ours, quiet, refetch, screen, wait, within } from './policyRefreshKit';

/**
 * T-227 — 끝난 뒤 다시 받기(lib/policyRefresh.fetchPolicyNow)의 겹침 경우(C-116 ⑥): 여러 번 끊김, 성공 뒤에 시작한 다른 받기, 이어
 * 기다리기 상한, 이어진 받기의 멈춤과 끊긴 옛 받기의 멈춤 표시, 받지 않은 거절. 값 없는 첫 받기는 policyRefreshFirstFetch, 기본
 * 동작은 policyDetailRound16 이 본다.
 */
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../apps/web/src/api/policies', () => ({ policiesApi: { get: api.get } }));
const { fetchPolicyNow } = await import('../apps/web/src/lib/policyRefresh');

afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
  api.get.mockReset();
});

describe('끝난 뒤 다시 받기의 겹침 (T-227 — lib/policyRefresh)', () => {
  it('끊긴 받기가 또 끊겨도(다시 받기 셋이 겹침) 지금 받는 것에 다시 이어 가장 새 본문으로 끝난다', async () => {
    const client = quiet();
    client.setQueryData(KEY, before);
    const last = deferred();
    api.get.mockImplementationOnce(never).mockImplementationOnce(never).mockImplementationOnce(() => last.promise);
    const result = fetchPolicyNow(client, 'A', always);
    refetch(client); // 둘째 받기가 이 받기를 끊는다 — 끊긴 받기의 약속은 둘째 받기로 이어진다
    await flush();
    refetch(client); // 셋째가 둘째를 끊는다 — 이어진 약속은 거절된다(한 번만 이어진다)
    await flush();
    last.resolve(newest);
    expect(await within(result)).toEqual(newest);
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(client.getQueryData(KEY)).toEqual(newest);
    expect(client.getQueryCache().hasListeners()).toBe(false); // 기다릴 때마다 단 캐시 구독은 끝나면 푼다(쌓이지 않게)
  });

  it('이 받기가 성공으로 끝났으면 바로 뒤에 시작한 다른 다시 받기는 기다리지 않는다 — 이어 기다리는 것은 끊겼을 때뿐', async () => {
    const client = quiet();
    client.setQueryData(KEY, before);
    const mine = deferred();
    const later = deferred();
    api.get.mockImplementationOnce(() => mine.promise).mockImplementationOnce(() => later.promise);
    const result = fetchPolicyNow(client, 'A', always);
    // 이 받기가 끝나자마자(이 함수가 결과를 보기 전에) 다른 다시 받기가 시작한다
    void client.getQueryCache().find({ queryKey: KEY, exact: true })?.promise?.then(() => refetch(client));
    mine.resolve(ours);
    expect(await within(result)).toEqual(ours);
    later.resolve(newest);
    await vi.waitFor(() => expect(client.getQueryData(KEY)).toEqual(newest));
  });

  it('끝없이 끊기면 다섯 번까지만 이어 기다리고 null — 진행이 풀린다(마지막 받기의 값은 화면이 받는다)', async () => {
    const client = quiet();
    client.setQueryData(KEY, before);
    const last = deferred();
    for (let k = 0; k < 7; k++) api.get.mockImplementationOnce(never);
    api.get.mockImplementationOnce(() => last.promise);
    let settled: unknown = 'pending';
    const result = fetchPolicyNow(client, 'A', always).then((v) => (settled = v));
    // 첫 끊김은 TanStack 이 이어 주고, 그 뒤 끊길 때마다 지금 받는 것에 다시 잇는다(다섯 번) — 여섯 번 끊겨도 따라가고 일곱째에서 그만둔다
    for (let k = 0; k < 6; k++) {
      refetch(client);
      await flush();
    }
    expect(settled).toBe('pending');
    refetch(client);
    await flush();
    expect(settled).toBeNull();
    last.resolve(newest);
    await result;
    await vi.waitFor(() => expect(client.getQueryData(KEY)).toEqual(newest));
    expect(api.get).toHaveBeenCalledTimes(8);
  });

  it('이어진 받기가 오프라인에서 시작해 멈추면 기다리지 않고 null — 다시 연결되면 그 받기가 끝나 화면이 새 본문을 받는다', async () => {
    const client = quiet();
    client.mount(); // 다시 연결을 듣는 것은 붙은 클라이언트다 — 앱에서는 QueryClientProvider 가 붙인다
    try {
      client.setQueryData(KEY, before);
      api.get.mockImplementationOnce(never).mockResolvedValueOnce(newest);
      const result = fetchPolicyNow(client, 'A', always);
      onlineManager.setOnline(false);
      refetch(client); // 오프라인에서 시작한 다시 받기가 이 받기를 끊고 멈춘다 — 이 받기의 약속은 그 받기로 이어졌다
      expect(await within(result)).toBeNull();
      expect(api.get).toHaveBeenCalledTimes(1);
      expect(client.getQueryCache().hasListeners()).toBe(false); // 멈춤으로 끝내도 구독은 푼다
      onlineManager.setOnline(true);
      await vi.waitFor(() => expect(client.getQueryData(KEY)).toEqual(newest));
    } finally {
      client.unmount();
    }
  });

  it('이어진 받기가 실패 뒤 재시도를 앞두고 탭이 가려져 멈추면 기다리지 않고 null — 탭으로 돌아오면 그 받기가 끝난다', async () => {
    const client = quiet();
    client.mount();
    client.setQueryData(KEY, before);
    const screenFn = vi.fn().mockRejectedValueOnce(new Error('flaky')).mockResolvedValueOnce(newest);
    const observer = screen(client, screenFn, { staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      api.get.mockImplementationOnce(never);
      const result = fetchPolicyNow(client, 'A', always);
      void observer.refetch(); // 화면이 다시 받으며 이 받기를 끊는다 — 이 받기의 약속은 그 받기로 이어진다
      focusManager.setFocused(false);
      expect(await within(result, 500)).toBeNull();
      expect(screenFn).toHaveBeenCalledTimes(1);
      focusManager.setFocused(true);
      await vi.waitFor(() => expect(client.getQueryData(KEY)).toEqual(newest));
    } finally {
      unsubscribe();
      client.unmount();
    }
  });

  it('끊긴 화면 받기가 재시도 대기 끝에 낸 멈춤 표시는 이 받기의 멈춤이 아니다 — 탭이 가려져도 이 받기의 값으로 끝난다', async () => {
    const client = quiet();
    client.mount();
    client.setQueryData(KEY, before);
    const screenFn = vi.fn().mockRejectedValueOnce(new Error('flaky')).mockResolvedValue(before);
    const unsubscribe = screen(client, screenFn, { retryDelay: 30 }).subscribe(() => undefined); // 낡은 값이라 바로 받는다 — 첫 시도 실패
    try {
      await flush();
      expect(client.getQueryState(KEY)?.fetchFailureCount).toBe(1); // 재시도를 기다리는 중
      const mine = deferred();
      api.get.mockImplementationOnce(() => mine.promise);
      const result = fetchPolicyNow(client, 'A', always); // 이 받기가 재시도를 기다리던 화면 받기를 끊는다
      focusManager.setFocused(false);
      await wait(60);
      expect(client.getQueryState(KEY)?.fetchStatus).toBe('paused'); // 끊긴 받기의 대기 사슬이 낸 표시 — 이 받기는 그대로 돈다
      mine.resolve(ours);
      expect(await within(result)).toEqual(ours);
    } finally {
      unsubscribe();
      client.unmount();
    }
  });

  it('끊긴 옛 받기의 멈춤 표시가 남은 채 이어진 받기가 탭이 보일 때 한 번 실패해도 멈춤으로 보지 않는다 — 그 받기의 재시도 값으로 끝난다', async () => {
    const client = quiet();
    client.mount();
    client.setQueryData(KEY, before);
    const second = deferred();
    const screenFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('flaky')) // 화면의 첫 받기 — 실패해 재시도를 기다린다
      .mockImplementationOnce(() => second.promise) // 화면의 다시 받기 첫 시도 — 아래에서 실패시킨다
      .mockResolvedValueOnce(newest); // 그 재시도
    const observer = screen(client, screenFn, { retryDelay: 30 });
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      await flush();
      expect(client.getQueryState(KEY)?.fetchFailureCount).toBe(1);
      api.get.mockImplementationOnce(never);
      const result = fetchPolicyNow(client, 'A', always); // 이 받기가 재시도를 기다리던 화면 받기를 끊는다
      void observer.refetch(); // 화면의 다시 받기가 이 받기를 끊는다 — 이 받기의 약속은 그 받기로 이어진다
      focusManager.setFocused(false);
      await wait(60); // 끊긴 첫 받기의 대기 사슬이 탭 가림을 보고 멈춤 표시를 낸다
      expect(client.getQueryState(KEY)).toMatchObject({ fetchStatus: 'paused', fetchFailureCount: 0 });
      focusManager.setFocused(true);
      await flush();
      second.reject(new Error('flaky')); // 탭이 보일 때 이어진 받기의 첫 시도가 실패한다 — 실패 횟수 1, 멈춤 표시는 남아 있다
      expect(await within(result, 500)).toEqual(newest);
    } finally {
      unsubscribe();
      client.unmount();
    }
  });

  it('이어진 받기의 다음 요청이 도는 사이 탭이 가려지고 다른 조회가 바뀌어도 남은 옛 표시를 멈춤으로 보지 않는다 — 그 요청의 값으로 끝난다', async () => {
    const client = quiet();
    client.mount();
    client.setQueryData(KEY, before);
    const second = deferred();
    const third = deferred();
    const screenFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('flaky')) // 화면의 첫 받기 — 실패해 재시도를 기다린다(끊기면 옛 표시를 낸다)
      .mockImplementationOnce(() => second.promise) // 화면의 다시 받기 첫 시도 — 실패시킨다
      .mockImplementationOnce(() => third.promise); // 그 재시도 — 도는 사이 탭을 가린다
    const observer = screen(client, screenFn, { retryDelay: 30 });
    const unsubscribe = observer.subscribe(() => undefined);
    let unsubscribeOther = () => {};
    try {
      await flush();
      api.get.mockImplementationOnce(never);
      const result = fetchPolicyNow(client, 'A', always);
      void observer.refetch();
      focusManager.setFocused(false);
      await wait(60); // 끊긴 첫 받기가 옛 멈춤 표시를 낸다
      focusManager.setFocused(true);
      await flush();
      second.reject(new Error('flaky')); // 실패 1회 — 탭이 보여 재시도한다
      await wait(60); // 재시도 요청이 돈다
      expect(screenFn).toHaveBeenCalledTimes(3);
      expect(client.getQueryState(KEY)).toMatchObject({ fetchStatus: 'paused', fetchFailureCount: 1 }); // 옛 표시가 남아 있다
      focusManager.setFocused(false);
      // 멈춤을 다시 보지 않는 알림들 — 화면이 다시 그려질 때의 옵션 알림(새 받기 함수), 무효화 알림, 다른 조회의 멈춤 알림
      observer.setOptions({ queryKey: KEY, queryFn: () => screenFn(), retry: 1, retryDelay: 30 });
      void client.invalidateQueries({ queryKey: KEY, refetchType: 'none' });
      const otherFn = vi.fn().mockRejectedValueOnce(new Error('flaky')).mockResolvedValue(1);
      const other = new QueryObserver(client, { queryKey: ['other'], queryFn: () => otherFn(), retry: 1, retryDelay: 5 });
      unsubscribeOther = other.subscribe(() => undefined); // 다른 조회 — 첫 시도가 실패하고 재시도 대기 끝에 탭 가림으로 멈춘다
      await vi.waitFor(() => expect(client.getQueryState(['other'])?.fetchStatus).toBe('paused'), { interval: 2 });
      third.resolve(newest);
      expect(await within(result, 500)).toEqual(newest);
    } finally {
      unsubscribeOther();
      unsubscribe();
      client.unmount();
    }
  });

  it('이 받기가 시작할 때 오프라인이라 null 로 끝낸 뒤 그 받기가 실패해도 받지 않은 거절이 남지 않는다', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const client = quiet();
    client.mount();
    try {
      client.setQueryData(KEY, before);
      api.get.mockRejectedValueOnce(new Error('down'));
      onlineManager.setOnline(false);
      expect(await within(fetchPolicyNow(client, 'A', always))).toBeNull();
      onlineManager.setOnline(true); // 다시 이어진 이 받기가 실패한다(재시도 없음)
      await vi.waitFor(() => expect(client.getQueryState(KEY)?.status).toBe('error'));
      await flush();
      await flush();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      client.unmount();
    }
  });
});

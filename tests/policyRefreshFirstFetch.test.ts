import { focusManager, onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { always, before, deferred, flush, KEY, never, newest, ours, quiet, screen, within } from './policyRefreshKit';

/**
 * T-227 — 끝난 뒤 다시 받기(lib/policyRefresh.fetchPolicyNow)에서 값 없는 첫 받기(캐시를 비운 뒤 다시 그린 화면)를 만났을 때: 끊지 않고
 * 끝나기를 기다린 뒤 새로 받고(겹친 두 작업 모두 값으로), 그 받기가 멈췄거나 기다리는 사이 멈추면 합류하지 않고 null, 기다리는 사이
 * 지워지거나 로그아웃한 경우. 이어진 받기의 겹침은 policyRefreshOverlap 이 본다.
 */
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../apps/web/src/api/policies', () => ({ policiesApi: { get: api.get } }));
const { fetchPolicyNow } = await import('../apps/web/src/lib/policyRefresh');

afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
  api.get.mockReset();
});

describe('값 없는 첫 받기 (T-227 — lib/policyRefresh)', () => {
  it('값 없는 조회에서 다시 받기 둘이 겹치면 둘 다 값으로 끝난다 — 뒤 받기는 앞 받기를 끊지 않고 끝나기를 기다린 뒤 새로 받는다(21차)', async () => {
    const client = quiet();
    const first = deferred();
    const second = deferred();
    api.get.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const a = fetchPolicyNow(client, 'A', always);
    const b = fetchPolicyNow(client, 'A', always);
    await flush();
    expect(api.get).toHaveBeenCalledTimes(1); // 뒤 받기는 앞 받기에 합류하지도, 끊지도 않는다
    first.resolve(ours);
    expect(await within(a)).toEqual(ours);
    second.resolve(newest);
    expect(await within(b)).toEqual(newest);
    expect(client.getQueryData(KEY)).toEqual(newest);
  });

  it('값 없는 첫 받기가 오프라인으로 멈춰 있으면 기다리지 않고 null — 다시 연결되면 그 받기가 끝난다', async () => {
    const client = quiet();
    client.mount();
    try {
      onlineManager.setOnline(false);
      void client.fetchQuery({ queryKey: KEY, queryFn: () => Promise.resolve(before) }).catch(() => undefined);
      expect(await within(fetchPolicyNow(client, 'A', always))).toBeNull();
      expect(api.get).not.toHaveBeenCalled();
      onlineManager.setOnline(true);
      await vi.waitFor(() => expect(client.getQueryData(KEY)).toEqual(before));
    } finally {
      client.unmount();
    }
  });

  it('값 없는 첫 받기가 오프라인에서 멈춘 뒤 탭이 가려진 채 다시 연결돼도 기다리지 않고 null — 탭으로 돌아오면 그 받기가 끝난다', async () => {
    const client = quiet();
    client.mount();
    try {
      onlineManager.setOnline(false);
      void client.fetchQuery({ queryKey: KEY, queryFn: () => Promise.resolve(before) }).catch(() => undefined);
      focusManager.setFocused(false);
      onlineManager.setOnline(true); // 다시 연결됐지만 탭이 가려져 있어 TanStack 이 잇지 않는다 — 실패 횟수 0·온라인인 멈춤
      await flush();
      expect(client.getQueryState(KEY)).toMatchObject({ fetchStatus: 'paused', fetchFailureCount: 0 });
      expect(await within(fetchPolicyNow(client, 'A', always))).toBeNull();
      expect(api.get).not.toHaveBeenCalled();
      focusManager.setFocused(true);
      await vi.waitFor(() => expect(client.getQueryData(KEY)).toEqual(before));
    } finally {
      client.unmount();
    }
  });

  it('값 없는 첫 받기를 기다리는 사이 그 받기가 재시도를 앞두고 탭 가림으로 멈추면 null — 탭으로 돌아오면 화면이 값을 받는다', async () => {
    const client = quiet();
    client.mount();
    const screenFn = vi.fn().mockRejectedValueOnce(new Error('flaky')).mockResolvedValue(before);
    const unsubscribe = screen(client, screenFn, { retryDelay: 30 }).subscribe(() => undefined); // 값이 없어 바로 받는다 — 첫 시도 실패
    try {
      await flush();
      expect(client.getQueryState(KEY)).toMatchObject({ fetchStatus: 'fetching', fetchFailureCount: 1 }); // 재시도를 기다린다 — 아직 멈추지 않았다
      const result = fetchPolicyNow(client, 'A', always);
      focusManager.setFocused(false); // 대기가 끝날 때 탭이 가려져 있어 그 받기가 멈춘다
      expect(await within(result, 500)).toBeNull();
      expect(api.get).not.toHaveBeenCalled();
      focusManager.setFocused(true);
      await vi.waitFor(() => expect(client.getQueryData(KEY)).toEqual(before));
    } finally {
      unsubscribe();
      client.unmount();
    }
  });

  it('값 없는 첫 받기가 재시도를 앞두고 멈춰 있으면 합류하지 않고 null — 화면이 내려가며 거둔 재시도를 다시 깨우지 않는다', async () => {
    const client = quiet();
    client.mount();
    const screenFn = vi.fn().mockRejectedValueOnce(new Error('flaky')).mockResolvedValue(before);
    const unsubscribe = screen(client, screenFn, { retryDelay: 30 }).subscribe(() => undefined); // 값이 없어 바로 받는다 — 첫 시도 실패
    try {
      await flush();
      expect(client.getQueryState(KEY)?.fetchFailureCount).toBe(1);
      // 재시도를 기다리는(받는 중) 사이 화면이 내려간다 — TanStack 이 남은 재시도를 거둔다(멈춘 첫 받기였다면 아예 되돌려 끊는다)
      unsubscribe();
      focusManager.setFocused(false);
      await vi.waitFor(() => expect(client.getQueryState(KEY)?.fetchStatus).toBe('paused'), { interval: 5 }); // 대기 끝에 탭 가림으로 멈춘다
      expect(await within(fetchPolicyNow(client, 'A', always))).toBeNull();
      focusManager.setFocused(true);
      await vi.waitFor(() => expect(client.getQueryState(KEY)?.status).toBe('error'));
      expect(screenFn).toHaveBeenCalledTimes(1); // 거둔 재시도는 돌지 않는다
      expect(api.get).not.toHaveBeenCalled();
    } finally {
      client.unmount();
    }
  });

  it('값 없는 첫 받기를 기다리는 사이 그 조회가 지워졌으면 새 조회로 받는다 — 화면이 보는 캐시에 새 본문이 남는다', async () => {
    const client = quiet();
    void client.fetchQuery({ queryKey: KEY, queryFn: never }).catch(() => undefined);
    api.get.mockResolvedValueOnce(ours);
    const result = fetchPolicyNow(client, 'A', always);
    client.removeQueries({ queryKey: KEY, exact: true }); // 지운 조회의 받기는 조용히 끊긴다
    expect(await within(result)).toEqual(ours);
    expect(client.getQueryData(KEY)).toEqual(ours);
  });

  it('값 없는 첫 받기를 기다리는 사이 로그아웃했으면 null — 다음 사용자로 다시 받지 않는다', async () => {
    const client = quiet();
    const old = deferred();
    void client.fetchQuery({ queryKey: KEY, queryFn: () => old.promise }).catch(() => undefined);
    let inScope = true;
    const result = fetchPolicyNow(client, 'A', () => inScope);
    inScope = false;
    old.resolve(before);
    expect(await within(result)).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });
});

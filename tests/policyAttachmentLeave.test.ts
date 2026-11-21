import { focusManager, onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachmentSetup, DELETED, revisit } from './attachmentKit';
import { deferred, flush } from './policyRefreshKit';

/**
 * T-227 — 첨부 올리기·지우기 뒤 목록 다시 받기에서 그 규정을 떠난 경우(lib/policyRefresh.refetchReceived): 보는 화면이 없는 목록은
 * 무효로 표시만 하고 기다리거나 알리지 않으며, 다시 받는 사이 떠났으면 받지 못해도 알리지 않고, 떠났다 돌아왔으면 알린다. 알림
 * 갈래는 policyDetailLeftovers 가 본다. 여기 시험은 모두 첨부 창이 닫힌 채라 알림은 결과 알림(report)으로만 간다 — report 로 본다.
 */
const api = vi.hoisted(() => ({ upload: vi.fn(), del: vi.fn() }));
vi.mock('../apps/web/src/api/policies', () => ({ policiesApi: {}, filesApi: { upload: api.upload, delete: api.del } }));
const { endAuthScope } = await import('../apps/web/src/lib/authScope');
const { useAttachmentActions } = await import('../apps/web/src/components/policy-detail/useAttachmentActions');
const { usePolicyRunsStore } = await import('../apps/web/src/stores/policyRunsStore');
const setup = attachmentSetup({ useAttachmentActions, running: () => usePolicyRunsStore.getState().running, endAuthScope });

afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
  usePolicyRunsStore.getState().clear();
  api.upload.mockReset();
  api.del.mockReset();
});

describe('첨부 목록 다시 받기 — 그 규정을 떠난 경우 (T-227 — refetchReceived)', () => {
  it('보는 화면이 없어 다시 받지 않은 목록은 앞서 남은 오류가 있어도 알리지 않는다 — 이번 다시 받기의 실패만 알린다', async () => {
    const s = await setup({ listFails: true, watched: false, earlierError: true, modalOpen: false });
    api.del.mockResolvedValueOnce(undefined);
    s.actions.remove('f-1');
    await s.finished();
    expect(s.list).not.toHaveBeenCalled();
    expect(s.report).not.toHaveBeenCalled();
  });

  it('보는 화면이 없는 목록은 멈춘 상태가 남아 있어도 알리지 않는다', async () => {
    const s = await setup({ noData: true, listFails: true, retry: 1, modalOpen: false }); // 값이 없어 바로 받는다 — 첫 시도 실패
    await flush();
    s.unsubscribe(); // 재시도를 기다리는(받는 중) 사이 규정 상세를 떠난다 — TanStack 이 남은 재시도를 거두지만 대기 사슬은 돈다
    focusManager.setFocused(false);
    await vi.waitFor(() => expect(s.client.getQueryState(['files', 'A'])).toMatchObject({ fetchStatus: 'paused', fetchFailureCount: 1 }), { interval: 2 });
    api.upload.mockResolvedValueOnce({ id: 'f-2' });
    s.actions.upload(new File(['x'], 'a.txt'));
    await s.finished();
    expect(s.list).toHaveBeenCalledTimes(1);
    expect(s.report).not.toHaveBeenCalled();
  });

  it('보는 화면이 없는 목록은 무효로 표시만 한다 — 30초(staleTime) 안에 돌아온 화면도 다시 받는다', async () => {
    const s = await setup({ watched: false, modalOpen: false });
    api.upload.mockResolvedValueOnce({ id: 'f-2' });
    s.actions.upload(new File(['x'], 'a.txt'));
    await s.finished();
    expect(s.list).not.toHaveBeenCalled();
    expect(s.client.getQueryState(['files', 'A'])?.isInvalidated).toBe(true);
    expect(s.report).not.toHaveBeenCalled();
    const next = revisit(s);
    await vi.waitFor(() => expect(s.list).toHaveBeenCalledTimes(1));
    next();
  });

  it('보는 화면이 없는 목록은 받는 중이어도 기다리지 않는다 — 진행을 바로 푼다', async () => {
    const pending = deferred();
    const s = await setup({ noData: true, watched: false, modalOpen: false });
    void s.client.prefetchQuery({ queryKey: ['files', 'A'], queryFn: () => pending.promise }); // 보는 화면 없이 받는 중(값 없음)
    api.upload.mockResolvedValueOnce({ id: 'f-2' });
    s.actions.upload(new File(['x'], 'a.txt'));
    await s.finished(); // 그 받기가 끝나기 전에 풀린다
    expect(s.report).not.toHaveBeenCalled();
    pending.resolve([{ id: 'f-1' }]);
  });

  it('다시 받는 사이 그 규정을 떠났으면 받지 못해도 알리지 않는다 — 다음에 보는 화면이 다시 받는다', async () => {
    const pending = deferred();
    const s = await setup({ lists: [() => pending.promise], modalOpen: false });
    api.del.mockResolvedValueOnce(undefined);
    s.actions.remove('f-1');
    await flush(); // 지운 뒤 목록 다시 받기가 나갔다
    expect(s.list).toHaveBeenCalledTimes(1);
    s.unsubscribe(); // 받는 사이 그 규정을 떠난다
    pending.reject(new Error('down'));
    await s.finished();
    expect(s.report).not.toHaveBeenCalled();
    // 다음 화면이 다시 받는다 — 오류로 끝난 받기는 TanStack 이 무효로 표시하므로 이 단언은 그 전제를 확인한다(우리 무효화는 '보는
    // 화면이 없는 목록은 무효로 표시만 한다' 시험이 지킨다)
    const next = revisit(s);
    await vi.waitFor(() => expect(s.list).toHaveBeenCalledTimes(2));
    next();
  });

  it('다시 받는 사이 떠났다가 같은 규정으로 돌아오면 그 받기의 실패를 알린다 — 보는 화면이 다시 있다', async () => {
    const pending = deferred();
    const s = await setup({ lists: [() => pending.promise], modalOpen: false });
    api.del.mockResolvedValueOnce(undefined);
    s.actions.remove('f-1');
    await flush();
    s.unsubscribe(); // 떠났다가
    const back = revisit(s); // 같은 규정으로 돌아온 화면이 진행 중인 받기에 합류한다
    pending.reject(new Error('down'));
    await s.finished();
    expect(s.list).toHaveBeenCalledTimes(1); // 새로 받지 않고 합류했다
    expect(s.report).toHaveBeenCalledWith('A', 'A-01', DELETED, 'error');
    back();
  });

  it('값 없이 받는 중인 목록을 기다리는 사이 그 규정을 떠나 그 받기가 멈추면 알리지 않는다 — 다음에 보는 화면이 다시 받는다', async () => {
    const s = await setup({ noData: true, listFails: true, retry: 1, retryDelay: 300, modalOpen: false }); // 첫 시도 실패 — 재시도 대기
    await flush();
    expect(s.client.getQueryState(['files', 'A'])).toMatchObject({ fetchStatus: 'fetching', fetchFailureCount: 1 });
    api.upload.mockResolvedValueOnce({ id: 'f-2' });
    s.actions.upload(new File(['x'], 'a.txt'));
    await flush(); // 값 없이 받는 중인 목록이 끝나기를 기다린다
    s.unsubscribe(); // 그 사이 규정을 떠난다 — 받는 중이라 TanStack 이 남은 재시도만 거둔다(멈춘 첫 받기였다면 되돌려 끊는다)
    focusManager.setFocused(false); // 대기가 끝날 때 탭이 가려져 있어 그 받기가 멈춘다
    await s.finished();
    expect(s.client.getQueryState(['files', 'A'])?.fetchStatus).toBe('paused');
    expect(s.list).toHaveBeenCalledTimes(1);
    expect(s.report).not.toHaveBeenCalled();
    focusManager.setFocused(true);
    s.client.getQueryCache().onFocus(); // 탭으로 돌아온다(시험의 클라이언트는 포커스를 듣지 않아 직접 알린다)
    // 거둔 재시도는 거절된다 — 오류로 끝난 뒤에 다음 화면이 붙는다(그 전에 붙으면 그 받기에 합류해 재시도를 되살린다)
    await vi.waitFor(() => expect(s.client.getQueryState(['files', 'A'])).toMatchObject({ status: 'error', errorUpdateCount: 1 }));
    // 값 없는 목록은 다음 화면이 붙을 때 받는다 — 아래는 그 TanStack 전제와 시험 순서를 확인한다(이 갈래는 무효화하지 않는다)
    const next = revisit(s);
    await vi.waitFor(() => expect(s.list).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(s.client.getQueryState(['files', 'A'])?.errorUpdateCount).toBe(2)); // 다음 화면의 새 받기(되살린 재시도가 아니다)
    expect(s.list).toHaveBeenCalledTimes(2);
    expect(s.report).not.toHaveBeenCalled(); // 기다리던 받기가 늦게 거절되고 다음 화면의 받기가 실패해도 이 작업은 알리지 않는다
    next();
  });
});

import { focusManager, onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachmentSetup, DELETED, notices, UPLOADED } from './attachmentKit';
import { deferred, flush } from './policyRefreshKit';

/**
 * T-227 — 규정 상세 남긴 것(C-116 ⑥): 첨부 올리기·지우기 뒤 파일 목록을 다시 받지 못했을 때의 알림(useAttachmentActions,
 * lib/policyRefresh.refetchReceived). 그 규정을 떠난 경우는 policyAttachmentLeave, 끝난 뒤 다시 받기의 겹침은
 * policyRefreshOverlap·policyRefreshFirstFetch, 도구 줄 실패 색은 policyToolbarKind 가 본다.
 */
const api = vi.hoisted(() => ({ upload: vi.fn(), del: vi.fn() }));
vi.mock('../apps/web/src/api/policies', () => ({ policiesApi: {}, filesApi: { upload: api.upload, delete: api.del } }));
const { endAuthScope } = await import('../apps/web/src/lib/authScope');
const { useAttachmentActions } = await import('../apps/web/src/components/policy-detail/useAttachmentActions');
const { usePolicyRunsStore } = await import('../apps/web/src/stores/policyRunsStore');
const { messages } = await import('../apps/web/src/i18n/messages');
const setup = attachmentSetup({ useAttachmentActions, running: () => usePolicyRunsStore.getState().running, endAuthScope });

afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
  usePolicyRunsStore.getState().clear();
  api.upload.mockReset();
  api.del.mockReset();
});

describe('첨부 목록을 다시 받지 못하면 알린다 (T-227 — useAttachmentActions)', () => {
  it('올린 뒤 열린 목록을 다시 받지 못하면 올렸다는 것과 함께 창 안에 알린다 — 다시 올리지 않게', async () => {
    const s = await setup({ listFails: true });
    api.upload.mockResolvedValueOnce({ id: 'f-2' });
    s.actions.upload(new File(['x'], 'a.txt'));
    await s.finished();
    expect(s.list).toHaveBeenCalledTimes(1);
    expect(s.setError).toHaveBeenLastCalledWith(UPLOADED);
    expect(s.report).not.toHaveBeenCalled();
  });

  it('지운 뒤 목록을 다시 받지 못했는데 첨부 창이 닫혀 있으면 결과 알림으로(실패 색) — 지웠다는 것을 먼저 말한다', async () => {
    const s = await setup({ listFails: true, modalOpen: false });
    api.del.mockResolvedValueOnce(undefined);
    s.actions.remove('f-1');
    await s.finished();
    expect(s.report).toHaveBeenCalledWith('A', 'A-01', DELETED, 'error');
    expect(notices(s.setError)).toEqual([]);
  });

  it('목록을 다시 받았으면 알리지 않는다', async () => {
    const s = await setup({});
    api.upload.mockResolvedValueOnce({ id: 'f-2' });
    s.actions.upload(new File(['x'], 'a.txt'));
    await s.finished();
    expect(s.list).toHaveBeenCalledTimes(1);
    expect(notices(s.setError)).toEqual([]);
    expect(s.report).not.toHaveBeenCalled();
  });

  it('다시 받기가 시작할 때 오프라인이라 멈추면 받지 못한 것으로 보고 알린다 — 목록이 옛것인 채 조용히 진행만 풀리지 않게', async () => {
    const s = await setup({});
    api.upload.mockImplementationOnce(() => {
      onlineManager.setOnline(false); // 올리기는 됐고, 목록을 다시 받을 때는 오프라인
      return Promise.resolve({ id: 'f-2' });
    });
    s.actions.upload(new File(['x'], 'a.txt'));
    await s.finished();
    expect(s.list).not.toHaveBeenCalled();
    expect(s.setError).toHaveBeenLastCalledWith(UPLOADED);
  });

  it('첫 시도가 실패하고 재시도를 앞두고 탭이 가려져 멈추면 기다리지 않고 알린다 — 진행이 탭이 돌아올 때까지 붙잡히지 않게', async () => {
    const s = await setup({ listFails: true, retry: 1 });
    api.del.mockImplementationOnce(() => {
      focusManager.setFocused(false);
      return Promise.resolve(undefined);
    });
    s.actions.remove('f-1');
    await s.finished();
    expect(s.list).toHaveBeenCalledTimes(1);
    expect(s.setError).toHaveBeenLastCalledWith(DELETED);
  });

  it('목록이 값 없이 받는 중이면(올리기 전에 보낸 받기) 합류하지 않고 끝나기를 기다린 뒤 다시 받는다 — 새 파일이 든 목록을 받고 알리지 않는다', async () => {
    const old = deferred();
    const s = await setup({ noData: true, lists: [() => old.promise, () => Promise.resolve([{ id: 'f-1' }, { id: 'f-2' }])] });
    api.upload.mockResolvedValueOnce({ id: 'f-2' });
    s.actions.upload(new File(['x'], 'a.txt'));
    await flush();
    expect(usePolicyRunsStore.getState().running).toEqual(['upload:A']); // 앞 받기가 끝나기를 기다린다
    old.resolve([{ id: 'f-1' }]); // 올리기 전에 보낸 받기 — 새 파일이 없다
    await s.finished();
    expect(s.list).toHaveBeenCalledTimes(2);
    expect(s.client.getQueryData(['files', 'A'])).toEqual([{ id: 'f-1' }, { id: 'f-2' }]);
    expect(notices(s.setError)).toEqual([]);
  });

  it('값 없는 목록이 오프라인에서 멈춘 뒤 탭이 가려진 채 다시 연결된 상태면 기다리지 않고 알린다', async () => {
    onlineManager.setOnline(false);
    const s = await setup({ noData: true }); // 값이 없어 바로 받으려다 오프라인이라 멈춘다
    focusManager.setFocused(false);
    onlineManager.setOnline(true); // 다시 연결됐지만 탭이 가려져 있어 그 받기는 멈춘 채다(실패 0회·온라인)
    expect(s.client.getQueryState(['files', 'A'])).toMatchObject({ fetchStatus: 'paused', fetchFailureCount: 0, status: 'pending' });
    api.upload.mockResolvedValueOnce({ id: 'f-2' });
    s.actions.upload(new File(['x'], 'a.txt'));
    await s.finished();
    expect(s.list).not.toHaveBeenCalled();
    expect(s.setError).toHaveBeenLastCalledWith(UPLOADED);
  });

  it('목록 다시 받기가 거듭 끊겨도 지금 받는 것에 이어 기다린다 — 마지막 받기의 목록을 받고 나서 진행을 푼다', async () => {
    const lists = [deferred(), deferred(), deferred()];
    const s = await setup({ lists: lists.map((d) => () => d.promise) });
    api.upload.mockResolvedValueOnce({ id: 'f-2' });
    s.actions.upload(new File(['x'], 'a.txt'));
    await flush(); // 올린 뒤 목록 다시 받기(첫째)가 나갔다
    void s.client.refetchQueries({ queryKey: ['files', 'A'] }); // 둘째가 첫째를 끊는다
    await flush();
    void s.client.refetchQueries({ queryKey: ['files', 'A'] }); // 셋째가 둘째를 끊는다
    await flush();
    expect(usePolicyRunsStore.getState().running).toEqual(['upload:A']); // 아직 받지 못했다 — 진행을 붙잡고 있다
    lists[2].resolve([{ id: 'f-1' }, { id: 'f-2' }]);
    await s.finished();
    expect(s.list).toHaveBeenCalledTimes(3);
    expect(s.client.getQueryData(['files', 'A'])).toEqual([{ id: 'f-1' }, { id: 'f-2' }]);
    expect(notices(s.setError)).toEqual([]);
  });

  it('다시 받는 사이 로그아웃했으면 알리지 않는다 — 앞 사람의 규정 이름이 다음 화면에 남지 않게', async () => {
    const s = await setup({ listFails: true, endScope: true, modalOpen: false });
    api.upload.mockResolvedValueOnce({ id: 'f-2' });
    s.actions.upload(new File(['x'], 'a.txt'));
    await s.finished();
    expect(s.list).toHaveBeenCalledTimes(1);
    expect(notices(s.setError)).toEqual([]);
    expect(s.report).not.toHaveBeenCalled();
  });

  it("문구는 올리기·지우기가 됐다는 말 뒤에 규정 정보 저장과 같은 '새로 고쳐 확인'을 단다 — 창은 열 때 다시 받지 않아 '다시 열라'고 하지 않는다(ko·en)", () => {
    expect(messages.ko['policyDetail.files.uploaded']).toBe('첨부파일을 올렸습니다.');
    expect(messages.ko['policyDetail.files.deleted']).toBe('첨부파일을 지웠습니다.');
    expect(messages.en['policyDetail.files.uploaded']).toBe('The attachment was uploaded.');
    expect(messages.en['policyDetail.files.deleted']).toBe('The attachment was deleted.');
    expect(messages.ko['policyDetail.result.refreshFailed']).toContain('화면을 새로 고침해 확인하세요');
    expect(messages.en['policyDetail.result.refreshFailed']).toContain('Reload the page');
  });
});

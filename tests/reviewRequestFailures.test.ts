import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T-224 단계 B2(설계 E5) — 편집기 검토 요청의 단계마다의 실패: 이어받는 초안은 이 요청이 보낸 글의 초안뿐이고(남의 초안·묶음 초안을 이어받아
 * 덮어쓰지 않게 — B2 검토), 저장됐는지 모르면 편집기와 쓰던 글을 그대로 둔다(닫으며 글을 지우지 않게). 반영이 확인됐는데 화면의 다시
 * 받기가 실패했으면 낡음 표시로.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), submit: vi.fn() }));
vi.mock('../apps/web/src/api/policies', () => ({
  policiesApi: { get: api.get },
  versionsApi: { list: api.list, create: api.create, update: api.update, submit: api.submit },
}));
const { down, editor, ko, ownDraft, refused, review, setup, statusOf, t } = await import('./reviewRequestHarness');
const { usePolicyRunsStore } = await import('../apps/web/src/stores/policyRunsStore');
const { nextDialogToken } = await import('../apps/web/src/lib/writeDialogs');
const { registerBanner } = await import('../apps/web/src/lib/articleBanner');
const { endAuthScope } = await import('../apps/web/src/lib/authScope');
const { subscribeClearStale } = await import('../apps/web/src/lib/toolStatus');

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  api.get.mockResolvedValue({ id: 'P1' });
  api.list.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const f of Object.values(api)) f.mockReset();
  usePolicyRunsStore.getState().clear();
});

describe('초안 저장 단계의 실패 (T-224 단계 B2, 설계 E5)', () => {
  it('거절 — 편집기 안에 서버의 한국어 문구, 편집기는 그대로(초안을 이어받지 않고 결과 자리에도 알리지 않는다)', async () => {
    const s = setup();
    const e = editor();
    api.create.mockRejectedValue(refused('본문을 입력하세요.'));
    await s.actions().requestReview(review({ token: e.token }));
    expect(e.controls.setError).toHaveBeenLastCalledWith('본문을 입력하세요.');
    expect(e.controls.adopt).not.toHaveBeenCalled();
    expect(e.controls.close).not.toHaveBeenCalled();
    expect(api.submit).not.toHaveBeenCalled();
    expect(s.last()).toBeUndefined();
    e.off();
  });

  it('새 초안이 응답 없이 끝났는데 다시 읽은 목록에 보낸 글의 초안이 생겼으면 — 그 초안을 이어받고 저장됐다고', async () => {
    const s = setup();
    const e = editor();
    api.create.mockRejectedValue(down);
    api.list.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'D1', status: 'draft', content: '남의 글', changeNote: '' }, ownDraft('D7', 7)]);
    await s.actions().requestReview(review({ token: e.token }));
    expect(e.controls.adopt).toHaveBeenCalledWith('D7');
    expect(e.controls.setError).toHaveBeenLastCalledWith(ko['policyWrites.version.draftMaybeSaved']);
    expect(e.controls.close).not.toHaveBeenCalled();
    e.off();
  });

  it('남이 만든 초안(글이 다름)이나 재파싱 묶음 초안은 이어받지 않는다 — 다음 요청이 그 초안을 덮어쓰지 않게(B2 검토)', async () => {
    const s = setup();
    const e = editor();
    api.create.mockRejectedValue(down);
    api.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'D9', status: 'draft', content: '다른 사람의 개정 초안', changeNote: '그 사람의 사유' },
        { ...ownDraft('D10', 10), reparseItem: { reviewId: 'R1' } },
        { ...ownDraft('D11', 11), changeNote: '다른 사유' }, // 글은 같아도 변경 사유가 다르면 이 요청의 것이 아니다
      ]);
    await s.actions().requestReview(review({ token: e.token }));
    expect(e.controls.adopt).not.toHaveBeenCalled();
    expect(e.controls.setError).toHaveBeenLastCalledWith(ko['policyWrites.version.draftUnknown']);
    e.off();
  });

  it('저장됐는지 모르면(새 초안을 못 찾음·고치던 초안) 편집기와 쓰던 글을 그대로 둔다 — 닫으며 글을 지우지 않는다(B2 검토)', async () => {
    const s = setup();
    let e = editor();
    api.create.mockRejectedValue(down);
    await s.actions().requestReview(review({ token: e.token }));
    expect(e.controls.close).not.toHaveBeenCalled();
    expect(e.controls.setError).toHaveBeenLastCalledWith(ko['policyWrites.version.draftUnknown']);
    e.off();
    e = editor();
    api.list.mockClear();
    api.update.mockRejectedValue(down);
    await s.actions().requestReview(review({ token: e.token, draftId: 'D5', draftNum: 5 }));
    expect(e.controls.close).not.toHaveBeenCalled();
    expect(e.controls.setError).toHaveBeenLastCalledWith(ko['policyWrites.version.draftUnknown']);
    expect(api.list).not.toHaveBeenCalled(); // 고치던 초안이면 다시 보내도 같은 초안을 고친다
    e.off();
  });

  it('실패 계획을 세우는 사이(목록을 다시 읽는 사이) 편집기를 닫았으면 결과 자리로 — 닫힌 편집기를 건드리지 않는다', async () => {
    const s = setup();
    const e = editor();
    api.create.mockRejectedValue(down);
    let answer!: (v: unknown) => void;
    api.list.mockResolvedValueOnce([]).mockReturnValueOnce(new Promise((r) => (answer = r)));
    const pending = s.actions().requestReview(review({ token: e.token }));
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    e.off();
    answer([ownDraft('D7', 7)]);
    await pending;
    expect(e.controls.adopt).not.toHaveBeenCalled();
    expect(s.last()).toBe(`제3조(수당) v7 — ${ko['policyWrites.version.draftMaybeSaved']}`);
  });

  it('실패 계획을 세우는 사이 로그아웃했으면 알리지 않는다', async () => {
    const s = setup();
    const e = editor();
    api.create.mockRejectedValue(down);
    api.list.mockResolvedValueOnce([]).mockImplementationOnce(() => {
      endAuthScope();
      return Promise.resolve([]);
    });
    await s.actions().requestReview(review({ token: e.token }));
    expect(e.controls.setError).not.toHaveBeenCalledWith(ko['policyWrites.version.draftUnknown']);
    expect(s.last()).toBeUndefined();
    e.off();
  });

  it('편집기가 닫혔으면 결과 자리에는 「쓰던 글은 그대로」 대신 확인하라는 글 — 창 안에서만 맞는 말을 창 밖에 쓰지 않는다(B2 재검토)', async () => {
    const s = setup();
    api.create.mockRejectedValue(down);
    await s.actions().requestReview(review({ token: nextDialogToken() }));
    expect(s.last()).toBe(`제3조(수당) — ${ko['policyWrites.version.draftUnknownClosed']}`);
  });

  it('초안을 확인해 이어받으면 앞 요청의 미확인 줄(조문 이름)은 걷는다 — 두 줄이 엇갈려 남지 않게(B2 재검토)', async () => {
    const s = setup();
    s.toolbar().fail('제3조(수당) — 초안 저장이 오류로 끝나 …', 'review:a1');
    const e = editor();
    api.create.mockResolvedValue({ id: 'D7', versionNum: 7 });
    api.submit.mockRejectedValue(refused('값을 정할 수 없는 변수 표식이 있습니다'));
    await s.actions().requestReview(review({ token: e.token }));
    expect(e.controls.adopt).toHaveBeenCalledWith('D7');
    expect(s.last()).toBe('');
    e.off();
  });

  it('편집기를 닫은 뒤 끝난 실패는 결과 자리로 — 판 번호를 모르면 조문만', async () => {
    const s = setup();
    api.create.mockRejectedValue(refused('본문을 입력하세요.'));
    await s.actions().requestReview(review({ token: nextDialogToken() }));
    expect(s.last()).toBe('제3조(수당) — 본문을 입력하세요.');
  });
});

describe('제출 단계의 실패 (T-224 단계 B2, 설계 E5)', () => {
  it('거절 — 저장한 초안을 이어받고 「초안은 저장했지만 …」(까닭은 서버의 한국어 문구, 영문이면 대체 문구)', async () => {
    const s = setup();
    const e = editor();
    api.create.mockResolvedValue({ id: 'D8', versionNum: 8 });
    api.submit.mockRejectedValue(refused('값을 정할 수 없는 변수 표식이 있습니다'));
    await s.actions().requestReview(review({ token: e.token }));
    expect(e.controls.adopt).toHaveBeenCalledWith('D8');
    expect(e.controls.setError).toHaveBeenLastCalledWith(t('policyWrites.version.draftSavedSubmitFailed', { reason: '값을 정할 수 없는 변수 표식이 있습니다' }));
    api.submit.mockRejectedValue(refused('Only draft versions can be submitted for review'));
    await s.actions().requestReview(review({ token: e.token, draftId: 'D8', draftNum: 8 }));
    expect(e.controls.setError).toHaveBeenLastCalledWith(t('policyWrites.version.draftSavedSubmitFailed', { reason: ko['policyWrites.version.submitRefused'] }));
    e.off();
  });

  it('응답 없이 끝나면 다시 읽은 상태로 — 검토 중이면 닫고 반영됐다고, 아니면(초안·모름) 그 초안으로 두고 확인 못 함(글은 그대로)', async () => {
    const s = setup();
    api.update.mockResolvedValue({});
    api.submit.mockRejectedValue(down);
    let e = editor();
    api.list.mockResolvedValue([{ id: 'D5', status: 'review' }]);
    await s.actions().requestReview(review({ token: e.token, draftId: 'D5', draftNum: 5 }));
    expect(e.controls.close).toHaveBeenCalled();
    expect(s.last()).toBe(`제3조(수당) v5 — ${t('policyWrites.landed', { action: '검토' })}`);
    e.off();
    for (const answer of [() => api.list.mockResolvedValue([{ id: 'D5', status: 'draft' }]), () => api.list.mockRejectedValue(new Error('down'))]) {
      e = editor();
      answer();
      await s.actions().requestReview(review({ token: e.token, draftId: 'D5', draftNum: 5 }));
      expect(e.controls.adopt).toHaveBeenCalledWith('D5');
      expect(e.controls.close).not.toHaveBeenCalled();
      expect(e.controls.setError).toHaveBeenLastCalledWith(t('policyWrites.unknown', { action: '검토' }));
      e.off();
    }
  });

  it('서버가 까닭을 실었으면 확인하지 못했다는 글에 함께 — 편집기가 닫혔으면 결과 자리로', async () => {
    const s = setup();
    api.update.mockResolvedValue({});
    api.submit.mockRejectedValue({ response: { status: 500, data: { message: '잠금을 기다리다 끝났습니다' } } });
    api.list.mockRejectedValue(new Error('down'));
    await s.actions().requestReview(review({ draftId: 'D5', draftNum: 5 }));
    expect(s.last()).toBe(`제3조(수당) v5 — ${t('policyWrites.unknownWhy', { action: '검토', reason: '잠금을 기다리다 끝났습니다' })}`);
  });

  it('반영이 확인됐어도 화면의 다시 받기가 실패했으면 낡음 표시로 — 그 뒤 받으면 걷힌다(B2 검토)', async () => {
    const s = setup();
    api.get.mockRejectedValue(new Error('down'));
    api.update.mockResolvedValue({});
    api.submit.mockRejectedValue(down);
    api.list.mockResolvedValue([{ id: 'D5', status: 'review' }]);
    const off = subscribeClearStale(s.qc, s.toolbar()); // 화면이 떠 있는 동안처럼 받기 성공을 듣는다
    await s.actions().requestReview(review({ draftId: 'D5', draftNum: 5 }));
    expect(s.last()).toBe(`제3조(수당) v5 — ${t('policyWrites.landed', { action: '검토' })} ${t('policyDetail.result.refreshFailed')}`);
    await s.qc.fetchQuery({ queryKey: ['policy', 'P1'], queryFn: () => Promise.resolve({ id: 'P1' }) });
    expect(s.last()).toBe(''); // 그 규정을 받으면 걷힌다
    off();
  });

  it('반영이 확인되면 다른 자리(보이지 않는 배너)에 남은 그 조문의 검토 요청 줄도 걷는다', async () => {
    const s = setup();
    const hidden = statusOf();
    hidden.status.fail('제3조(수당) — 확인하지 못했습니다.', 'review:a1');
    const off = registerBanner('P1', 'a1', hidden.status, false);
    api.update.mockResolvedValue({});
    api.submit.mockRejectedValue(down);
    api.list.mockResolvedValue([{ id: 'D5', status: 'review' }]);
    await s.actions().requestReview(review({ draftId: 'D5', draftNum: 5 }));
    expect(hidden.last()).toBe('');
    off();
  });
});

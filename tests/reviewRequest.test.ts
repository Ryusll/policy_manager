import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T-224 단계 B2(설계 E5) — 검토 요청도 판 쓰기 규칙으로: 목록·카드의 제출(submit)은 전환과 같고, 편집기의 검토 요청(requestReview)은
 * 초안을 고치거나 만든 뒤 제출한다. 새 초안이면 같은 글의 초안이 이미 있는지 먼저 읽어 이어 쓴다(다시 눌러 초안이 둘이 되지 않게). 작업
 * 이름은 판 id 를 알면 그 판의 것(version:판 id), 반영되면 조문 줄(review:조문 id)도 걷는다. 단계마다의 실패는 reviewRequestFailures.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), submit: vi.fn() }));
vi.mock('../apps/web/src/api/policies', () => ({
  policiesApi: { get: api.get },
  versionsApi: { list: api.list, create: api.create, update: api.update, submit: api.submit },
}));
const { A1, down, editor, ko, ownDraft, refused, review, setup, statusOf, t } = await import('./reviewRequestHarness');
const { usePolicyRunsStore } = await import('../apps/web/src/stores/policyRunsStore');
const { useToastStore } = await import('../apps/web/src/stores/toastStore');
const { runKey } = await import('../apps/web/src/lib/policyResult');
const { registerBanner } = await import('../apps/web/src/lib/articleBanner');

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  api.get.mockResolvedValue({ id: 'P1' });
  api.list.mockResolvedValue([]);
});
afterEach(() => {
  useToastStore.getState().clear();
  vi.unstubAllGlobals();
  for (const f of Object.values(api)) f.mockReset();
  usePolicyRunsStore.getState().clear();
});

describe('목록·카드의 검토 요청 (T-224 단계 B2 — submit)', () => {
  it('그 판을 제출하고 조문·판 번호 붙은 결과, 서버의 한국어 거절(변수 표식 까닭 등)은 그대로', async () => {
    const s = setup();
    api.submit.mockResolvedValue({});
    await s.actions().submit({ versionId: 'V2', versionNum: 2, ...A1 });
    expect(api.submit).toHaveBeenCalledWith('V2');
    expect(s.flash).toHaveBeenLastCalledWith('제3조(수당) v2 — 검토를 요청했습니다.', expect.any(Number));
    api.submit.mockRejectedValue(refused('값을 정할 수 없는 변수 표식이 있습니다 — {{RATE}}(요율)'));
    await s.actions().submit({ versionId: 'V2', versionNum: 2, ...A1 });
    expect(s.last()).toBe('제3조(수당) v2 — 값을 정할 수 없는 변수 표식이 있습니다 — {{RATE}}(요율)');
  });

  it('응답 없이 끝나도 다시 읽은 판이 검토 중이면 반영됐다고 — 행위 이름은 「검토」(검토 요청 요청이 되지 않게)', async () => {
    const s = setup();
    api.submit.mockRejectedValue(down);
    api.list.mockResolvedValue([{ id: 'V2', status: 'review' }]);
    await s.actions().submit({ versionId: 'V2', versionNum: 2, ...A1 });
    expect(s.last()).toBe(`제3조(수당) v2 — ${t('policyWrites.landed', { action: '검토' })}`);
    expect(s.last()).not.toContain('요청 요청');
  });
});

describe('편집기의 검토 요청 — 성공 (T-224 단계 B2 — requestReview)', () => {
  it('고치던 초안이면 고친 뒤 제출하고 편집기를 닫는다 — 결과 글은 그 초안의 번호, 목록은 읽지 않는다', async () => {
    const s = setup();
    const e = editor();
    api.update.mockResolvedValue({});
    api.submit.mockResolvedValue({});
    await s.actions().requestReview(review({ draftId: 'D5', draftNum: 5, token: e.token }));
    expect(api.update).toHaveBeenCalledWith('D5', { content: '바뀐 본문', changeNote: '사유' });
    expect(api.create).not.toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
    expect(api.submit).toHaveBeenCalledWith('D5');
    expect(e.controls.close).toHaveBeenCalled();
    expect(s.flash).toHaveBeenLastCalledWith('제3조(수당) v5 — 검토를 요청했습니다.', expect.any(Number));
    e.off();
  });

  it('초안이 없으면 같은 글의 초안이 없는지 먼저 보고 새로 만들어 제출한다 — 결과 글은 만든 판의 번호', async () => {
    const s = setup();
    api.list.mockResolvedValue([{ id: 'D1', status: 'draft', content: '다른 글', changeNote: '사유' }]);
    api.create.mockResolvedValue({ id: 'D6', versionNum: 6 });
    api.submit.mockResolvedValue({});
    await s.actions().requestReview(review());
    expect(api.list).toHaveBeenCalledWith('a1');
    expect(api.create).toHaveBeenCalledWith('a1', { content: '바뀐 본문', changeNote: '사유' });
    expect(api.submit).toHaveBeenCalledWith('D6');
    expect(s.flash).toHaveBeenLastCalledWith('제3조(수당) v6 — 검토를 요청했습니다.', expect.any(Number));
  });

  it('같은 글의 초안이 이미 있으면(앞 요청이 응답 없이 끝났지만 저장됨) 그 초안을 고쳐 제출한다 — 초안이 둘이 되지 않는다(B2 검토)', async () => {
    const s = setup();
    api.list.mockResolvedValue([ownDraft('D7', 7)]);
    api.update.mockResolvedValue({});
    api.submit.mockResolvedValue({});
    await s.actions().requestReview(review());
    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledWith('D7', { content: '바뀐 본문', changeNote: '사유' });
    expect(api.submit).toHaveBeenCalledWith('D7');
    expect(s.flash).toHaveBeenLastCalledWith('제3조(수당) v7 — 검토를 요청했습니다.', expect.any(Number));
  });

  it('같은 글이어도 남이 만든 초안은 이어 쓰지 않는다(작성자를 알 때) — 남의 초안을 덮어쓰지 않게(B2 재검토)', async () => {
    const s = setup();
    api.list.mockResolvedValue([{ ...ownDraft('D7', 7), createdBy: 'other-user' }]);
    api.create.mockResolvedValue({ id: 'D9', versionNum: 9 });
    api.submit.mockResolvedValue({});
    await s.actions().requestReview(review({ userId: 'me' }));
    expect(api.update).not.toHaveBeenCalled();
    expect(api.create).toHaveBeenCalled();
  });

  it('같은 글 초안을 찾을 목록을 읽지 못하면 보내지 않는다 — 같은 장애로 앞 초안을 못 찾고 또 만들지 않게(B2 재검토)', async () => {
    const s = setup();
    const e = editor();
    api.list.mockRejectedValue(new Error('down'));
    await s.actions().requestReview(review({ token: e.token }));
    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
    expect(e.controls.setError).toHaveBeenLastCalledWith(ko['policyWrites.version.lookupFailed']);
    expect(e.controls.close).not.toHaveBeenCalled();
    e.off();
  });

  it('같은 글이어도 재파싱 묶음 초안은 이어 쓰지 않는다', async () => {
    const s = setup();
    api.list.mockResolvedValue([{ ...ownDraft('D8', 8), reparseItem: { reviewId: 'R1' } }]);
    api.create.mockResolvedValue({ id: 'D9', versionNum: 9 });
    api.submit.mockResolvedValue({});
    await s.actions().requestReview(review());
    expect(api.update).not.toHaveBeenCalled();
    expect(api.create).toHaveBeenCalled();
  });

  it('판 쓰기가 도는 동안은 시작하지 않고 편집기 안에 까닭을 보인다', async () => {
    const s = setup();
    const e = editor();
    usePolicyRunsStore.getState().start(runKey('version', 'P1'), 'approve:V1');
    expect(await s.actions().requestReview(review({ token: e.token }))).toBe(false);
    expect(api.create).not.toHaveBeenCalled();
    expect(e.controls.setError).toHaveBeenLastCalledWith(ko['policyWrites.locked']);
    e.off();
  });

  it('진행 대상은 조문마다(review:조문 id) — 페이지가 그 조문의 검토 요청 단추에 처리 중…을 단다', async () => {
    const s = setup();
    let release!: (v: unknown) => void;
    api.create.mockReturnValue(new Promise((r) => (release = r)));
    api.submit.mockResolvedValue({});
    const pending = s.actions().requestReview(review());
    expect(usePolicyRunsStore.getState().targets[runKey('version', 'P1')]).toBe('review:a1');
    await vi.waitFor(() => expect(api.create).toHaveBeenCalled());
    release({ id: 'D9', versionNum: 9 });
    await pending;
  });
});

describe('다른 규정으로 옮긴 뒤 끝난 결과 (T-224 완료 정의 ②, B2 재검토)', () => {
  it('편집기의 검토 요청·목록의 제출 — 시작한 화면이 내려갔으면 「코드 제목 — 조문 v번호 — 문구」 알림으로', async () => {
    const s = setup({ mounted: false });
    api.create.mockResolvedValue({ id: 'D6', versionNum: 6 });
    api.submit.mockResolvedValue({});
    await s.actions().requestReview(review());
    api.submit.mockRejectedValueOnce(refused('값을 정할 수 없는 변수 표식이 있습니다'));
    await s.actions().submit({ versionId: 'V2', versionNum: 2, ...A1 });
    expect(useToastStore.getState().items.map((i) => i.message)).toEqual([
      'HR-01 취업규칙 — 제3조(수당) v6 — 검토를 요청했습니다.',
      'HR-01 취업규칙 — 제3조(수당) v2 — 값을 정할 수 없는 변수 표식이 있습니다',
    ]);
    expect(s.flash).not.toHaveBeenCalled();
  });
});

describe('작업 이름 — 같은 초안의 줄은 어느 길의 성공이든 걷는다 (T-224 단계 B2 검토)', () => {
  it('편집기의 성공은 그 판의 줄(version:판 id — 목록 제출의 실패)과 조문 줄(review:조문 id)을 걷는다', async () => {
    const s = setup();
    s.toolbar().fail('제3조(수당) v5 — 검토를 요청하지 못했습니다.', 'version:D5');
    s.toolbar().fail('제3조(수당) — 초안 저장이 오류로 끝나 …', 'review:a1');
    s.toolbar().fail('PDF 를 만들지 못했습니다.');
    api.update.mockResolvedValue({});
    api.submit.mockResolvedValue({});
    await s.actions().requestReview(review({ draftId: 'D5', draftNum: 5 }));
    expect(s.last()).toBe('PDF 를 만들지 못했습니다.');
  });

  it('목록·카드의 성공도 그 조문의 편집기 줄(review:조문 id)을 걷는다 — 결과가 가는 자리(도구 줄)에 남은 줄까지', async () => {
    const s = setup();
    s.toolbar().fail('제3조(수당) — 초안 저장이 오류로 끝나 …', 'review:a1');
    s.toolbar().fail('PDF 를 만들지 못했습니다.');
    api.submit.mockResolvedValue({});
    await s.actions().submit({ versionId: 'D5', versionNum: 5, ...A1 });
    expect(s.last()).toBe('PDF 를 만들지 못했습니다.');
  });

  it('보이지 않는 그 조문의 배너는 반영된 결과가 다른 자리로 가면 비운다', async () => {
    const s = setup();
    const hidden = statusOf();
    hidden.status.fail('제3조(수당) — 초안 저장이 오류로 끝나 …', 'review:a1');
    const off = registerBanner('P1', 'a1', hidden.status, false);
    api.submit.mockResolvedValue({});
    await s.actions().submit({ versionId: 'D5', versionNum: 5, ...A1 });
    expect(hidden.last()).toBe('');
    off();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T-224 단계 C(설계 E3·E6·E7·E12·E14) — 부칙·별표·서식(추가·수정·삭제), 의견(등록·처리 표시), 조문 추가를 useBodyWrites 로 옮겼다. 누를
 * 때의 규정·조문·대상을 잡아 끝까지 쓰고, 결과는 조문 배너(의견)·도구 줄·이름 붙은 알림으로. 응답 없음·5xx 뒤에는 다시 받은 값으로 반영
 * 여부를 보고, 조문 추가는 몇 번째 요청에서 실패했는지에 따라 양식을 다르게 둔다.
 */
const api = vi.hoisted(() => ({
  get: vi.fn(),
  createAppendix: vi.fn(),
  updateAppendix: vi.fn(),
  deleteAppendix: vi.fn(),
  createArticle: vi.fn(),
  commentCreate: vi.fn(),
  commentUpdate: vi.fn(),
  commentList: vi.fn(),
}));
vi.mock('../apps/web/src/api/policies', () => ({
  policiesApi: { get: api.get, createAppendix: api.createAppendix, updateAppendix: api.updateAppendix, deleteAppendix: api.deleteAppendix, createArticle: api.createArticle },
  commentsApi: { create: api.commentCreate, update: api.commentUpdate, list: api.commentList },
}));
const { DRAFT, dialog, down, ko, refused, setup, t } = await import('./bodyWritesHarness');
const { usePolicyRunsStore } = await import('../apps/web/src/stores/policyRunsStore');
const { runKey } = await import('../apps/web/src/lib/policyResult');

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  api.get.mockResolvedValue({ id: 'P1', appendices: [] });
  api.commentList.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const f of Object.values(api)) f.mockReset();
  usePolicyRunsStore.getState().clear();
});

describe('부칙·별표·서식 (T-224 단계 C — saveAppendix·deleteAppendix)', () => {
  it('추가 — 보낸 값(제목은 앞뒤 공백 없이·정렬 순서는 비우면 없음)으로 만들고 창을 닫는다, 결과 글은 그 제목', async () => {
    const s = setup();
    const d = dialog('appendix');
    api.createAppendix.mockResolvedValue({ id: 'X1' });
    await s.w().saveAppendix({ mode: 'create', draft: { ...DRAFT, title: ' 별표 1 ' }, kindLabel: '별표', idsBefore: [], token: d.token });
    expect(api.createAppendix).toHaveBeenCalledWith('P1', { kind: 'annex', title: '별표 1', body: '표 본문', sortOrder: undefined });
    expect(d.controls.close).toHaveBeenCalled();
    expect(s.flash).toHaveBeenLastCalledWith('별표 1 — 추가했습니다.', expect.any(Number));
    d.off();
  });

  it('수정 거절 — 창 안에 서버의 한국어 문구(영문이면 입력값을 확인하라는 대체 문구), 창은 그대로, 다시 보내면 앞 거절 문구를 먼저 걷는다', async () => {
    const s = setup();
    const d = dialog('appendix');
    api.updateAppendix.mockRejectedValue(refused('제목을 입력하세요.'));
    await s.w().saveAppendix({ mode: 'edit', appendixId: 'X1', draft: DRAFT, kindLabel: '별표', idsBefore: ['X1'], token: d.token });
    expect(api.updateAppendix).toHaveBeenCalledWith('P1', 'X1', expect.objectContaining({ title: '별표 1' }));
    expect(d.controls.setError).toHaveBeenLastCalledWith('제목을 입력하세요.');
    api.updateAppendix.mockRejectedValue(refused('Bad Request'));
    await s.w().saveAppendix({ mode: 'edit', appendixId: 'X1', draft: DRAFT, kindLabel: '별표', idsBefore: ['X1'], token: d.token });
    expect(d.controls.setError.mock.calls.map((c) => c[0])).toEqual([null, '제목을 입력하세요.', null, ko['bodyWrites.appendix.failed']]);
    expect(ko['bodyWrites.appendix.failed']).not.toContain('새로 고쳐'); // 새로 고치면 쓰던 본문을 잃는다
    expect(d.controls.close).not.toHaveBeenCalled();
    d.off();
  });

  it('추가가 응답 없이 끝나도 다시 받은 규정에 그 항목이 생겼으면 반영됐다고(설계 E3) — 없으면 확인 못 함, 행위 이름은 그 종류 이름(E12)', async () => {
    const s = setup();
    api.createAppendix.mockRejectedValue(down);
    api.get.mockResolvedValue({ id: 'P1', appendices: [{ id: 'X0', kind: 'form', title: '서식 1' }, { id: 'X9', kind: 'annex', title: '별표 1', body: '표 본문' }] });
    await s.w().saveAppendix({ mode: 'create', draft: DRAFT, kindLabel: '별표', idsBefore: ['X0'], token: null });
    expect(s.last()).toBe(`별표 1 — ${t('policyWrites.landed', { action: '별표 추가' })}`);
    api.get.mockResolvedValue({ id: 'P1', appendices: [{ id: 'X0', kind: 'form', title: '서식 1' }] });
    await s.w().saveAppendix({ mode: 'create', draft: DRAFT, kindLabel: '별표', idsBefore: ['X0'], token: null });
    expect(s.last()).toBe(`별표 1 — ${t('policyWrites.unknown', { action: '별표 추가' })}`);
  });

  it('삭제 — 지우면 고른 항목을 푼다(onApplied), 이미 지워졌으면(404) 성공 쪽으로 「이미 지워진 항목입니다」', async () => {
    const s = setup();
    const onApplied = vi.fn();
    api.deleteAppendix.mockResolvedValue({});
    await s.w().deleteAppendix({ appendixId: 'X1', title: '부칙', kindLabel: '부칙', onApplied });
    expect(api.deleteAppendix).toHaveBeenCalledWith('P1', 'X1');
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(s.flash).toHaveBeenLastCalledWith('부칙 — 지웠습니다.', expect.any(Number));
    api.deleteAppendix.mockRejectedValue(refused('Appendix not found', 404));
    await s.w().deleteAppendix({ appendixId: 'X1', title: '부칙', kindLabel: '부칙', onApplied });
    expect(onApplied).toHaveBeenCalledTimes(2);
    expect(s.flash).toHaveBeenLastCalledWith(`부칙 — ${ko['bodyWrites.appendix.alreadyDeleted']}`, expect.any(Number));
  });
});

describe('의견 (T-224 단계 C — postComment·resolveComment, 설계 E7)', () => {
  it('등록 — 그 조문에 보내고 의견 목록을 다시 받은 뒤 결과, 입력칸 비우기는 페이지에 맡긴다(clearInput)', async () => {
    const s = setup();
    const clearInput = vi.fn();
    api.commentCreate.mockResolvedValue({ id: 'C1' });
    await s.w().postComment({ articleId: 'a1', articleLabel: '제3조(수당)', content: '의견입니다', idsBefore: [], clearInput });
    expect(api.commentCreate).toHaveBeenCalledWith('a1', { content: '의견입니다' });
    expect(clearInput).toHaveBeenCalledTimes(1);
    expect(s.flash).toHaveBeenLastCalledWith('제3조(수당) — 의견을 등록했습니다.', expect.any(Number));
  });

  it('등록 거절은 입력칸을 두고 알린다 — 응답 없음이면 다시 읽은 목록에 그 글이 생겼는지로 반영 여부', async () => {
    const s = setup();
    const clearInput = vi.fn();
    api.commentCreate.mockRejectedValue(refused('content must be shorter than or equal to 2000 characters'));
    await s.w().postComment({ articleId: 'a1', articleLabel: '제3조(수당)', content: '의견', idsBefore: [], clearInput });
    expect(s.last()).toBe(`제3조(수당) — ${ko['bodyWrites.comment.failed']}`);
    expect(clearInput).not.toHaveBeenCalled();
    api.commentCreate.mockRejectedValue(down);
    api.commentList.mockResolvedValue([{ id: 'C0', content: '의견', user: { id: 'U1' } }, { id: 'C2', content: '의견', user: { id: 'U1' } }]);
    await s.w().postComment({ articleId: 'a1', articleLabel: '제3조(수당)', content: '의견', idsBefore: ['C0'], userId: 'U1', clearInput });
    expect(s.last()).toBe(`제3조(수당) — ${t('policyWrites.landed', { action: '의견 등록' })}`);
    expect(clearInput).toHaveBeenCalledTimes(1);
  });

  it('처리 표시 — 그 의견을 바꾸고 결과 글은 바꾼 쪽, 한 규정에서 의견 쓰기는 한 번에 하나', async () => {
    const s = setup();
    api.commentUpdate.mockResolvedValue({});
    await s.w().resolveComment({ articleId: 'a1', articleLabel: '제3조(수당)', commentId: 'C1', resolve: true });
    expect(api.commentUpdate).toHaveBeenCalledWith('C1', { isResolved: true });
    expect(s.flash).toHaveBeenLastCalledWith('제3조(수당) — 의견을 처리완료로 바꿨습니다.', expect.any(Number));
    usePolicyRunsStore.getState().start(runKey('comment', 'P1'), 'resolve:C2');
    expect(await s.w().resolveComment({ articleId: 'a1', articleLabel: '제3조(수당)', commentId: 'C1', resolve: false })).toBe(false);
    expect(await s.w().postComment({ articleId: 'a1', articleLabel: '제3조(수당)', content: '또', idsBefore: [] })).toBe(false);
  });
});

describe('조문 추가 (T-224 단계 C — addArticle, 설계 E6)', () => {
  const two = [{ number: 3, title: '수당' }, { number: 3, clauseNumber: 1, content: '항 본문' }];

  it('조 머리와 항을 차례로 만들고 양식을 닫는다', async () => {
    const s = setup();
    const d = dialog('addArticle');
    api.createArticle.mockResolvedValue({ id: 'A' });
    await s.w().addArticle({ chapterId: 'CH', payloads: two, articleLabel: '제3조 ①', token: d.token });
    expect(api.createArticle.mock.calls).toEqual([['P1', 'CH', two[0]], ['P1', 'CH', two[1]]]);
    expect(d.controls.close).toHaveBeenCalled();
    expect(s.flash).toHaveBeenLastCalledWith('제3조 ① — 조문을 추가했습니다.', expect.any(Number));
    d.off();
  });

  it('첫 요청 거절은 양식 안에, 첫 요청이 응답 없이 끝나면 양식을 닫고 확인 못 함 — 같은 입력을 그대로 다시 보내 겹치지 않게(설계 E3)', async () => {
    const s = setup();
    const d = dialog('addArticle');
    api.createArticle.mockRejectedValueOnce(refused('이미 있는 조 번호입니다.'));
    await s.w().addArticle({ chapterId: 'CH', payloads: two, articleLabel: '제3조 ①', token: d.token });
    expect(d.controls.setError).toHaveBeenLastCalledWith('이미 있는 조 번호입니다.');
    expect(api.createArticle).toHaveBeenCalledTimes(1); // 두 번째는 보내지 않았다
    expect(d.controls.close).not.toHaveBeenCalled();
    api.createArticle.mockRejectedValueOnce(down);
    await s.w().addArticle({ chapterId: 'CH', payloads: two, articleLabel: '제3조 ①', token: d.token });
    expect(d.controls.close).toHaveBeenCalledTimes(1);
    expect(s.last()).toBe(`제3조 ① — ${t('policyWrites.unknown', { action: '조문 추가' })}`);
    expect(api.createArticle).toHaveBeenCalledTimes(2);
    d.off();
  });

  it('하나라도 만든 뒤 실패하면 양식을 닫고 「일부만 추가했을 수 있습니다」 — 같은 양식으로 다시 보내 겹치지 않게', async () => {
    const s = setup();
    const d = dialog('addArticle');
    api.createArticle.mockResolvedValueOnce({ id: 'A' }).mockRejectedValueOnce(refused('항 번호가 겹칩니다.'));
    await s.w().addArticle({ chapterId: 'CH', payloads: two, articleLabel: '제3조 ①', token: d.token });
    expect(d.controls.close).toHaveBeenCalled();
    expect(s.last()).toBe(`제3조 ① — ${ko['bodyWrites.article.partial']}`);
    d.off();
  });
});

import { QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T-224 단계 C(설계 E3·E7·E12) — 부칙·별표·서식과 의견의 응답 없음·5xx 뒤 반영 판정(누르기 전에 없던 것이 보낸 그대로 생겼는가, 그 항목이
 * 보낸 그대로 바뀌었는가), 의견 결과가 그 조문 배너로 가는가, 다시 받지 못하면 낡음 표시인가. 바탕은 bodyWritesHarness, 기본 흐름은
 * bodyWrites.test.ts, 조문 추가는 bodyWritesArticle.test.ts, 진행 중 대상·결과 이름·숨은 배너는 bodyWritesRuns.test.ts.
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
const { A1, DRAFT, dialog, down, ko, refused, setup, statusOf, t } = await import('./bodyWritesHarness');
const { usePolicyRunsStore } = await import('../apps/web/src/stores/policyRunsStore');
const { registerBanner } = await import('../apps/web/src/lib/articleBanner');

const landed = (action: string) => t('policyWrites.landed', { action });
const unknown = (action: string) => t('policyWrites.unknown', { action });
const stale = (message: string) => `${message} ${t('policyDetail.result.refreshFailed')}`;

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

describe('규정을 받기 전 (T-224 단계 C)', () => {
  it('규정 id 가 없으면 아무것도 보내지 않고 false', async () => {
    const s = setup({ policyId: undefined });
    expect(await s.w().saveAppendix({ mode: 'create', draft: DRAFT, kindLabel: '별표', idsBefore: [], token: null })).toBe(false);
    expect(await s.w().postComment({ ...A1, content: '의견', idsBefore: [] })).toBe(false);
    expect(await s.w().addArticle({ chapterId: 'CH', payloads: [{ number: 3, title: '수당' }], articleLabel: '제3조', token: null })).toBe(false);
    expect(api.createAppendix).not.toHaveBeenCalled();
    expect(api.commentCreate).not.toHaveBeenCalled();
    expect(api.createArticle).not.toHaveBeenCalled();
  });
});

describe('부칙·별표·서식 — 응답 없음 뒤 반영 판정 (T-224 단계 C, 설계 E3·E12)', () => {
  const sent = { kind: 'annex', title: '별표 1', body: '표 본문' };

  it('추가 — 누르기 전에 없던 항목이 보낸 구분·제목·본문 그대로 생겼을 때만 반영됐다고', async () => {
    const s = setup();
    api.createAppendix.mockRejectedValue(down);
    const add = { mode: 'create' as const, draft: DRAFT, kindLabel: '별표', idsBefore: ['X0'], token: null };
    const old = { id: 'X0', ...sent }; // 누르기 전부터 있던 같은 항목
    // 새 항목은 모두 한 칸씩 어긋난다 — 다른 구분·제목·본문
    api.get.mockResolvedValue({ id: 'P1', appendices: [old, { id: 'X7', ...sent, kind: 'form' }, { id: 'X8', ...sent, title: '별표 2' }, { id: 'X6', ...sent, body: '다른 본문' }] });
    await s.w().saveAppendix(add);
    expect(s.last()).toBe(`별표 1 — ${unknown('별표 추가')}`);
    api.get.mockResolvedValue({ id: 'P1', appendices: [old, { id: 'X9', ...sent }] });
    await s.w().saveAppendix(add);
    expect(s.last()).toBe(`별표 1 — ${landed('별표 추가')}`);
  });

  it('수정 — 그 항목이 보낸 구분·제목·본문·정렬 순서 그대로일 때만 반영(정렬 순서는 보냈을 때만), 항목이 없어졌으면 모른다', async () => {
    const s = setup();
    api.updateAppendix.mockRejectedValue(down);
    const edit = { mode: 'edit' as const, appendixId: 'X1', draft: { ...DRAFT, sortOrder: '3' }, kindLabel: '별표', idsBefore: ['X1'], token: null };
    for (const row of [{ id: 'X1', ...sent, sortOrder: 3, body: '옛 본문' }, { id: 'X1', ...sent, sortOrder: 1 }, { id: 'X2', ...sent, sortOrder: 3 }]) {
      api.get.mockResolvedValue({ id: 'P1', appendices: [row] });
      await s.w().saveAppendix(edit);
      expect(s.last(), JSON.stringify(row)).toBe(`별표 1 — ${unknown('별표 수정')}`);
    }
    api.get.mockResolvedValue({ id: 'P1', appendices: [{ id: 'X1', ...sent, sortOrder: 3 }] });
    await s.w().saveAppendix(edit);
    expect(s.last()).toBe(`별표 1 — ${landed('별표 수정')}`);
    // 정렬 순서를 비워 보냈으면(서버가 그대로 둔다) 그 값은 보지 않는다
    api.get.mockResolvedValue({ id: 'P1', appendices: [{ id: 'X1', ...sent, sortOrder: 7 }] });
    await s.w().saveAppendix({ ...edit, draft: DRAFT });
    expect(s.last()).toBe(`별표 1 — ${landed('별표 수정')}`);
  });

  it('수정하려는 항목이 이미 지워졌으면(404) 입력값이 아니라 그 까닭을 창 안에 — 창은 둬서 쓰던 내용을 복사할 수 있게', async () => {
    const s = setup();
    const d = dialog('appendix');
    api.updateAppendix.mockRejectedValue(refused('Appendix not found', 404));
    await s.w().saveAppendix({ mode: 'edit', appendixId: 'X1', draft: DRAFT, kindLabel: '별표', idsBefore: ['X1'], token: d.token });
    expect(d.controls.setError).toHaveBeenLastCalledWith(ko['bodyWrites.appendix.gone']);
    expect(d.controls.close).not.toHaveBeenCalled();
    d.off();
    // 창이 닫혔으면(옮김) 결과 자리에는 창 밖에서 맞는 글, 서버가 한국어로 까닭을 실었으면 그 글
    await s.w().saveAppendix({ mode: 'edit', appendixId: 'X1', draft: DRAFT, kindLabel: '별표', idsBefore: ['X1'], token: null });
    expect(s.last()).toBe(`별표 1 — ${ko['bodyWrites.appendix.goneClosed']}`);
    api.updateAppendix.mockRejectedValue(refused('이 항목은 이미 지워졌습니다.', 404));
    await s.w().saveAppendix({ mode: 'edit', appendixId: 'X1', draft: DRAFT, kindLabel: '별표', idsBefore: ['X1'], token: null });
    expect(s.last()).toBe('별표 1 — 이 항목은 이미 지워졌습니다.');
    // 추가의 404 는 규정이 없어진 것 — 창 안과 밖 어디서나 맞는 글(입력값을 보라고 하지 않는다)
    api.createAppendix.mockRejectedValue(refused('Policy not found', 404));
    await s.w().saveAppendix({ mode: 'create', draft: { ...DRAFT, title: '별표 2' }, kindLabel: '별표', idsBefore: [], token: null });
    expect(s.last()).toContain(`별표 2 — ${ko['bodyWrites.appendix.policyGone']}`);
    const d2 = dialog('appendix');
    await s.w().saveAppendix({ mode: 'create', draft: { ...DRAFT, title: '별표 2' }, kindLabel: '별표', idsBefore: [], token: d2.token });
    expect(d2.controls.setError).toHaveBeenLastCalledWith(ko['bodyWrites.appendix.policyGone']);
    d2.off();
  });

  it('삭제 — 거절은 서버의 한국어 문구, 응답 없음 뒤 그 항목이 없어졌으면 반영(고른 항목을 푼다), 남아 있으면 모른다', async () => {
    const s = setup();
    const onApplied = vi.fn();
    const del = { appendixId: 'X1', title: '부칙', kindLabel: '부칙', onApplied };
    api.deleteAppendix.mockRejectedValue(refused('결재 중인 항목은 지울 수 없습니다.', 409));
    await s.w().deleteAppendix(del);
    expect(s.last()).toBe('부칙 — 결재 중인 항목은 지울 수 없습니다.');
    api.deleteAppendix.mockRejectedValue(down);
    api.get.mockResolvedValue({ id: 'P1', appendices: [{ id: 'X1', kind: 'supplementary', title: '부칙' }] });
    await s.w().deleteAppendix(del);
    expect(s.last()).toBe(`부칙 — ${unknown('부칙 삭제')}`);
    expect(onApplied).not.toHaveBeenCalled();
    api.get.mockResolvedValue({ id: 'P1', appendices: [] });
    await s.w().deleteAppendix(del);
    expect(s.last()).toBe(`부칙 — ${landed('부칙 삭제')}`);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });
});

describe('의견 (T-224 단계 C, 설계 E3·E7·E12)', () => {
  it('등록 — 거절은 서버의 한국어 문구(입력칸은 둔다), 응답 없음 뒤에는 누르기 전에 없던 내 같은 글이 생겼을 때만 반영 — 모르면 입력칸은 비운다', async () => {
    const s = setup();
    const clearInput = vi.fn();
    const post = (idsBefore: string[] | null, userId?: string) => s.w().postComment({ ...A1, content: '의견', idsBefore, userId, clearInput });
    api.commentCreate.mockRejectedValue(refused('잠긴 조문에는 의견을 달 수 없습니다.'));
    await post([], 'U1');
    expect(s.last()).toBe('제3조(수당) — 잠긴 조문에는 의견을 달 수 없습니다.');
    expect(clearInput).not.toHaveBeenCalled();
    api.commentCreate.mockRejectedValue(down);
    // 새 글은 모두 한 칸씩 어긋난다 — 누르기 전부터 있던 글, 다른 내용, 다른 사람의 같은 글
    api.commentList.mockResolvedValue([
      { id: 'C0', content: '의견', user: { id: 'U1' } },
      { id: 'C3', content: '다른 의견', user: { id: 'U1' } },
      { id: 'C4', content: '의견', user: { id: 'U2' } },
    ]);
    await post(['C0'], 'U1');
    expect(s.last()).toBe(`제3조(수당) — ${unknown('의견 등록')}`);
    expect(clearInput).toHaveBeenCalledTimes(1); // 그대로 다시 보내 같은 의견이 둘 되지 않게
    // 누를 때 의견 목록을 받지 못했거나(무엇이 새 글인지 가릴 수 없다) 나를 모르면, 같은 글이 보여도 모른다 — 목록을 읽지도 않는다
    api.commentList.mockResolvedValue([{ id: 'C5', content: '의견', user: { id: 'U1' } }, { id: 'C6', content: '의견' }]);
    await post(null, 'U1');
    expect(s.last()).toBe(`제3조(수당) — ${unknown('의견 등록')}`);
    await post([]);
    expect(s.last()).toBe(`제3조(수당) — ${unknown('의견 등록')}`);
    expect(api.commentList).toHaveBeenCalledTimes(1);
    await post([], 'U1');
    expect(s.last()).toBe(`제3조(수당) — ${landed('의견 등록')}`);
  });

  it('조문이 이미 지워졌으면(404) 입력값이 아니라 그 까닭을 — 입력칸은 둔다', async () => {
    const s = setup();
    const clearInput = vi.fn();
    api.commentCreate.mockRejectedValue(refused('Article not found', 404));
    await s.w().postComment({ ...A1, content: '의견', idsBefore: [], userId: 'U1', clearInput });
    expect(s.last()).toBe(`제3조(수당) — ${ko['bodyWrites.comment.gone']}`);
    expect(clearInput).not.toHaveBeenCalled();
  });

  it('처리 표시 — 행위 이름은 누른 단추 글, 응답 없음 뒤에는 그 의견이 바꾼 쪽이 됐을 때만 반영', async () => {
    const s = setup();
    api.commentUpdate.mockResolvedValue({});
    await s.w().resolveComment({ ...A1, commentId: 'C1', resolve: false });
    expect(api.commentUpdate).toHaveBeenCalledWith('C1', { isResolved: false });
    expect(s.flash).toHaveBeenLastCalledWith('제3조(수당) — 의견을 미처리로 되돌렸습니다.', expect.any(Number));
    api.commentUpdate.mockRejectedValue(down);
    api.commentList.mockResolvedValue([{ id: 'C1', isResolved: true }]);
    await s.w().resolveComment({ ...A1, commentId: 'C1', resolve: false });
    expect(s.last()).toBe(`제3조(수당) — ${unknown('미처리로 되돌리기')}`);
    api.commentList.mockResolvedValue([{ id: 'C1', isResolved: false }]);
    await s.w().resolveComment({ ...A1, commentId: 'C1', resolve: false });
    expect(s.last()).toBe(`제3조(수당) — ${landed('미처리로 되돌리기')}`);
    await s.w().resolveComment({ ...A1, commentId: 'C1', resolve: true });
    expect(s.last()).toBe(`제3조(수당) — ${unknown('처리완료로 변경')}`);
  });

  it('결과는 그 조문을 분절 보기로 보이는 화면이면 그 조문 배너로', async () => {
    const s = setup();
    const banner = statusOf();
    const off = registerBanner('P1', 'a1', banner.status);
    api.commentCreate.mockResolvedValue({ id: 'C1' });
    await s.w().postComment({ ...A1, content: '의견', idsBefore: [], userId: 'U1' });
    expect(banner.flash).toHaveBeenLastCalledWith('제3조(수당) — 의견을 등록했습니다.', expect.any(Number));
    api.commentUpdate.mockResolvedValue({});
    await s.w().resolveComment({ ...A1, commentId: 'C1', resolve: true });
    expect(banner.flash).toHaveBeenLastCalledWith('제3조(수당) — 의견을 처리완료로 바꿨습니다.', expect.any(Number));
    expect(s.flash).not.toHaveBeenCalled();
    off();
  });

  it('그 조문의 의견 목록을 다시 받지 못하면 결과에 받아 오지 못했다고(낡음 표시) — 등록·처리 표시 모두', async () => {
    const s = setup();
    const fetchComments = vi.fn().mockResolvedValue([]);
    const unsub = new QueryObserver(s.qc, { queryKey: ['comments', 'a1'], queryFn: fetchComments, retry: false }).subscribe(() => undefined);
    await vi.waitFor(() => expect(s.qc.getQueryState(['comments', 'a1'])?.status).toBe('success'));
    fetchComments.mockRejectedValue(new Error('down'));
    api.commentCreate.mockResolvedValue({ id: 'C1' });
    await s.w().postComment({ ...A1, content: '의견', idsBefore: [], userId: 'U1' });
    const posted = stale('제3조(수당) — 의견을 등록했습니다.');
    expect(s.last()).toBe(posted);
    api.commentUpdate.mockResolvedValue({});
    await s.w().resolveComment({ ...A1, commentId: 'C1', resolve: true });
    expect(s.last()).toBe(`${posted} / ${stale('제3조(수당) — 의견을 처리완료로 바꿨습니다.')}`);
    unsub();
  });
});

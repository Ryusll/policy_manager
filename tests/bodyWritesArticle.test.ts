import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T-224 단계 C(설계 E3·E6) — 조문 추가의 응답 없음·5xx 뒤 반영 판정(articleAddPlan). 서버에 같은 자리를 막는 제약이 없어, 첫 요청이 응답
 * 없이 끝나도 양식을 닫고 다시 받은 규정의 그 장에 누르기 전에 없던 그 자리의 새 행이 생겼는지로 반영·일부만·확인 못 함을 가린다. 기본
 * 흐름(차례로 보내기·첫 요청 거절·하나 만든 뒤 실패)은 bodyWrites.test.ts.
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
const { dialog, down, ko, setup, t } = await import('./bodyWritesHarness');
const { usePolicyRunsStore } = await import('../apps/web/src/stores/policyRunsStore');

const landed = (action: string) => t('policyWrites.landed', { action });
const unknown = (action: string) => t('policyWrites.unknown', { action });
const stale = (message: string) => `${message} ${t('policyDetail.result.refreshFailed')}`;
const two = [{ number: 3, title: '수당' }, { number: 3, clauseNumber: 1, content: '항 본문' }];
const policyWith = (articles: Record<string, unknown>[], other: Record<string, unknown>[] = []) => ({
  id: 'P1',
  appendices: [],
  chapters: [{ id: 'CH', articles }, { id: 'CH2', articles: other }],
});
const old3 = { id: 'O3', number: 3 }; // 누르기 전부터 있던 제3조

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  api.get.mockResolvedValue({ id: 'P1', appendices: [] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const f of Object.values(api)) f.mockReset();
  usePolicyRunsStore.getState().clear();
});

describe('조문 추가 — 응답 없음 뒤 반영 판정 (T-224 단계 C, 설계 E3·E6)', () => {
  it('첫 요청이 응답 없이 끝나면 다시 받은 규정의 그 장에 누르기 전에 없던 그 자리의 행이 생겼을 때만 반영 — 보낼 항이 남았으면 일부만', async () => {
    // 경우마다 새 화면(결과 줄은 자리마다 따로 남는다 — bodyWritesRuns.test.ts)
    const fresh = (cache: Record<string, unknown>[]) => {
      const s = setup();
      const d = dialog('addArticle');
      s.qc.setQueryData(['policy', 'P1'], policyWith(cache));
      const add = (payloads: Record<string, unknown>[], articleLabel: string) => s.w().addArticle({ chapterId: 'CH', payloads, articleLabel, token: d.token });
      return { s, d, add };
    };
    api.createArticle.mockRejectedValue(down);
    const old31 = { id: 'O31', number: 3, clauseNumber: 1 }; // 누르기 전부터 있던 같은 자리
    const a = fresh([old3, old31]);
    // 새 행은 모두 한 칸씩 어긋난다 — 다른 조·가지·항·목, 다른 장
    const near = [
      { id: 'N1', number: 4, clauseNumber: 1 },
      { id: 'N2', number: 3, branchNumber: 2, clauseNumber: 1 },
      { id: 'N3', number: 3, clauseNumber: 2 },
      { id: 'N4', number: 3, clauseNumber: 1, itemNumber: 1 },
      { id: 'N8', number: 3, clauseNumber: 1, title: '다른 제목' }, // 같은 자리에 다른 사람이 만든 다른 조
    ];
    api.get.mockResolvedValue(policyWith([old3, old31, ...near], [{ id: 'N5', number: 3, clauseNumber: 1 }]));
    await a.add([{ number: 3, clauseNumber: 1 }], '제3조 ①');
    expect(a.s.last()).toBe(`제3조 ① — ${unknown('조문 추가')}`);
    expect(a.d.controls.close).toHaveBeenCalledTimes(1);
    a.d.off();
    // 지금 장이 이 장인 행(구조 변경 예정으로 다른 장 아래 보여도)
    const b = fresh([old3]);
    api.get.mockResolvedValue(policyWith([old3], [{ id: 'N6', number: 4, title: '상여', liveChapterId: 'CH' }]));
    await b.add([{ number: 4, title: '상여' }], '제4조');
    expect(b.s.last()).toBe(`제4조 — ${landed('조문 추가')}`);
    b.d.off();
    const c = fresh([old3]);
    api.get.mockResolvedValue(policyWith([old3, { id: 'N7', number: 5, branchNumber: 2, title: '수당' }]));
    await c.add([{ number: 5, branchNumber: 2, title: '수당' }, { number: 5, branchNumber: 2, clauseNumber: 1, content: '항' }], '제5조의2 ①');
    expect(c.s.last()).toBe(`제5조의2 ① — ${ko['bodyWrites.article.partial']}`);
    expect(api.createArticle).toHaveBeenCalledTimes(3); // 첫 요청에서 멈췄다 — 남은 항은 보내지 않는다
    c.d.off();
  });

  it('첫 내용을 보냈는데 새 행에 초안이 없으면 일부만(서버는 행을 만든 뒤 초안을 따로 저장한다), 초안이 다른 내용이면 내 것이 아니라 확인 못 함', async () => {
    const s = setup();
    api.createArticle.mockRejectedValue(down);
    const add = async (row: Record<string, unknown>, content?: string) => {
      s.qc.setQueryData(['policy', 'P1'], policyWith([old3]));
      api.get.mockResolvedValue(policyWith([old3, { id: 'N1', number: 4, title: '상여', ...row }]));
      await s.w().addArticle({ chapterId: 'CH', payloads: [{ number: 4, title: ' 상여 ', ...(content === undefined ? {} : { content }) }], articleLabel: '제4조', token: null });
      return s.last();
    };
    expect(await add({}, '본문')).toBe(`제4조 — ${ko['bodyWrites.article.partial']}`);
    expect(await add({ pendingVersion: { id: 'V1', status: 'draft', content: '다른 본문' } }, '본문')).toBe(`제4조 — ${unknown('조문 추가')}`);
    expect(await add({ pendingVersion: { id: 'V1', status: 'draft', content: '본문' } }, '본문')).toBe(`제4조 — ${landed('조문 추가')}`);
    // 첫 내용을 보내지 않았으면 초안이 있는 행은 남의 것
    expect(await add({ pendingVersion: { id: 'V2', status: 'draft', content: '본문' } })).toBe(`제4조 — ${unknown('조문 추가')}`);
    expect(await add({})).toBe(`제4조 — ${landed('조문 추가')}`);
  });

  it('장이 이미 지워졌으면(404) 입력값이 아니라 그 까닭을 양식 안에 — 양식은 둬서 쓰던 내용을 복사할 수 있게', async () => {
    const s = setup();
    const d = dialog('addArticle');
    api.createArticle.mockRejectedValue({ response: { status: 404, data: { message: 'Chapter not found' } } });
    await s.w().addArticle({ chapterId: 'CH', payloads: [{ number: 4, title: '상여' }], articleLabel: '제4조', token: d.token });
    expect(d.controls.setError).toHaveBeenLastCalledWith(ko['bodyWrites.article.gone']);
    expect(d.controls.close).not.toHaveBeenCalled();
    d.off();
  });

  it('첫 요청이 응답 없이 끝났는데 규정을 다시 받지 못했으면 캐시에 무엇이 있든 반영을 보지 않고 확인 못 함, 서버 까닭이 있으면 함께', async () => {
    const s = setup();
    s.qc.setQueryData(['policy', 'P1'], policyWith([old3]));
    api.createArticle.mockImplementation(() => {
      // 받기가 아니라 손으로 넣은 값 — 받은 것으로 치지 않는다
      s.qc.setQueryData(['policy', 'P1'], policyWith([old3, { id: 'N1', number: 4, title: '상여' }]));
      return Promise.reject(Object.assign(new Error('Bad Gateway'), down));
    });
    api.get.mockRejectedValue(new Error('down'));
    await s.w().addArticle({ chapterId: 'CH', payloads: [{ number: 4, title: '상여' }], articleLabel: '제4조', token: null });
    expect(s.last()).toBe(`제4조 — ${unknown('조문 추가')}`);
    api.createArticle.mockReset();
    api.createArticle.mockRejectedValue({ response: { status: 503, data: { message: '점검 중입니다' } } });
    await s.w().addArticle({ chapterId: 'CH', payloads: [{ number: 8, title: '복무' }], articleLabel: '제8조', token: null });
    expect(s.last()).toContain(`제8조 — ${t('policyWrites.unknownWhy', { action: '조문 추가', reason: '점검 중입니다' })}`);
  });

  it('하나라도 만든 뒤 실패했는데 규정을 다시 받지 못했으면 낡음 표시 — 만든 조문이 화면에 없다', async () => {
    const s = setup();
    const d = dialog('addArticle');
    api.createArticle.mockResolvedValueOnce({ id: 'A' }).mockRejectedValueOnce(down);
    api.get.mockRejectedValue(new Error('down'));
    await s.w().addArticle({ chapterId: 'CH', payloads: two, articleLabel: '제3조 ①', token: d.token });
    expect(d.controls.close).toHaveBeenCalled();
    expect(s.last()).toBe(stale(`제3조 ① — ${ko['bodyWrites.article.partial']}`));
    d.off();
  });
});

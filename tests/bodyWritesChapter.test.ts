import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T-224 마지막 재검토 — 장이 하나도 없는 규정의 조문 추가는 먼저 숨은 장을 만든다(useBodyWrites.ensureHiddenChapter). 조문 추가의 진행에
 * 걸고, 결과는 다른 쓰기와 같은 자리·규칙, 응답 없음·5xx 면 다시 받은 규정에 누르기 전에 없던 숨은 장이 생겼는지로 반영을 본다 — 서버에 같은
 * 장을 막는 제약이 없어 그대로 다시 만들면 둘이 된다. 만들어졌으면(성공·반영) 그 장으로 양식을 연다(onReady).
 */
const api = vi.hoisted(() => ({
  get: vi.fn(),
  createAppendix: vi.fn(),
  updateAppendix: vi.fn(),
  deleteAppendix: vi.fn(),
  createArticle: vi.fn(),
  createChapter: vi.fn(),
  commentCreate: vi.fn(),
  commentUpdate: vi.fn(),
  commentList: vi.fn(),
}));
vi.mock('../apps/web/src/api/policies', () => ({
  policiesApi: { get: api.get, createAppendix: api.createAppendix, updateAppendix: api.updateAppendix, deleteAppendix: api.deleteAppendix, createArticle: api.createArticle, createChapter: api.createChapter },
  commentsApi: { create: api.commentCreate, update: api.commentUpdate, list: api.commentList },
}));
const { down, ko, refused, setup, t } = await import('./bodyWritesHarness');
const { usePolicyRunsStore } = await import('../apps/web/src/stores/policyRunsStore');
const { useToastStore } = await import('../apps/web/src/stores/toastStore');

const action = '조문을 넣을 장 만들기';
const hidden = (id: string) => ({ id, number: 1, title: '', suppressHeader: true, articles: [] });

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  api.get.mockResolvedValue({ id: 'P1', appendices: [], chapters: [] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const f of Object.values(api)) f.mockReset();
  usePolicyRunsStore.getState().clear();
  useToastStore.getState().clear();
});

describe('숨은 장 만들기 (T-224 마지막 재검토 — ensureHiddenChapter)', () => {
  it('만들면 그 장으로 양식을 열고(onReady) 도구 줄에 잠깐 알린다 — 보낸 값은 장 머리를 숨긴 1장', async () => {
    const s = setup();
    const onReady = vi.fn();
    api.createChapter.mockResolvedValue({ id: 'CH1' });
    expect(await s.w().ensureHiddenChapter({ onReady })).toBe(true);
    expect(api.createChapter).toHaveBeenCalledWith('P1', { number: 1, title: '', suppressHeader: true });
    expect(onReady).toHaveBeenCalledWith('CH1');
    expect(s.flash).toHaveBeenLastCalledWith(ko['bodyWrites.article.chapterReady'], expect.any(Number));
  });

  it('거절은 다시 해도 같으니 새로 고쳐 확인하라고(잠시 뒤 다시가 아니다), 서버가 한국어로 까닭을 실었으면 그 글 — 양식은 열지 않는다', async () => {
    const s = setup();
    const onReady = vi.fn();
    api.createChapter.mockRejectedValue(refused('Forbidden resource', 403));
    await s.w().ensureHiddenChapter({ onReady });
    expect(s.last()).toBe(ko['bodyWrites.article.chapterRefused']);
    api.createChapter.mockRejectedValue(refused('규정이 잠겨 장을 만들 수 없습니다.', 409));
    await s.w().ensureHiddenChapter({ onReady });
    expect(s.last()).toBe('규정이 잠겨 장을 만들 수 없습니다.');
    expect(onReady).not.toHaveBeenCalled();
  });

  it('응답 없이 끝나면 다시 받은 규정에 누르기 전에 없던 숨은 장이 생겼을 때만 반영 — 그 장으로 연다, 아니면 확인 못 함(다시 만들지 않게)', async () => {
    const s = setup();
    const onReady = vi.fn();
    api.createChapter.mockRejectedValue(down);
    s.qc.setQueryData(['policy', 'P1'], { id: 'P1', chapters: [hidden('OLD')] }); // 누르기 전부터 있던 숨은 장(이 경로로는 오지 않지만 판정은 새 장만)
    // 새 장은 모두 숨은 장이 아니다 — 머리를 보이는 장, 화면이 만든 가상 장
    api.get.mockResolvedValue({ id: 'P1', chapters: [hidden('OLD'), { id: 'SHOWN', number: 2, title: '총칙', suppressHeader: false, articles: [] }, { ...hidden('VIRTUAL'), virtual: true }] });
    await s.w().ensureHiddenChapter({ onReady });
    expect(s.last()).toBe(t('policyWrites.unknown', { action }));
    expect(onReady).not.toHaveBeenCalled();
    s.qc.setQueryData(['policy', 'P1'], { id: 'P1', chapters: [] });
    api.get.mockResolvedValue({ id: 'P1', chapters: [hidden('NEW')] });
    await s.w().ensureHiddenChapter({ onReady });
    expect(s.last()).toBe(t('policyWrites.landed', { action }));
    expect(onReady).toHaveBeenCalledWith('NEW');
    // 다시 받지 못했으면 캐시에 무엇이 있든 반영을 보지 않는다
    s.qc.setQueryData(['policy', 'P1'], { id: 'P1', chapters: [] });
    api.createChapter.mockImplementation(() => {
      s.qc.setQueryData(['policy', 'P1'], { id: 'P1', chapters: [hidden('CACHED')] });
      return Promise.reject(Object.assign(new Error('Bad Gateway'), down));
    });
    api.get.mockRejectedValue(new Error('down'));
    await s.w().ensureHiddenChapter({ onReady });
    expect(s.last()).toBe(t('policyWrites.unknown', { action }));
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('그 규정을 떠났으면 결과는 규정 이름이 붙은 알림으로', async () => {
    const s = setup({ mounted: false });
    api.createChapter.mockRejectedValue(refused('Forbidden resource', 403));
    await s.w().ensureHiddenChapter({ onReady: vi.fn() });
    expect(useToastStore.getState().items.at(-1)?.message).toBe(`HR-01 취업규칙 — ${ko['bodyWrites.article.chapterRefused']}`);
  });

  it('조문 추가가 도는 동안은 시작하지 않고 까닭을 알린다 — 겹쳐 눌러도 장을 두 번 만들지 않는다', async () => {
    const s = setup();
    let release!: (v: unknown) => void;
    api.createChapter.mockReturnValueOnce(new Promise((r) => (release = r)));
    const first = s.w().ensureHiddenChapter({ onReady: vi.fn() });
    expect(await s.w().ensureHiddenChapter({ onReady: vi.fn() })).toBe(false);
    expect(useToastStore.getState().items.at(-1)?.message).toBe(ko['bodyWrites.running']);
    release({ id: 'CH1' });
    await first;
    expect(api.createChapter).toHaveBeenCalledTimes(1);
  });
});

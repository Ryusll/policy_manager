import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T-224 단계 C — 진행 중 대상과 막힘(완료 정의 ① — 도는 동안 같은 종류의 쓰기를 다시 보내지 못한다, 대상 이름은 페이지가 '처리 중…'을
 * 견주는 값), 결과 줄의 이름은 항목마다(다른 항목의 결과가 앞 항목의 '확인하지 못했습니다' 줄을 걷거나 바꾸지 않는다), 같은 조문의 숨은
 * 배너(의견 쓰기의 성공이 판 쓰기의 줄을 지우지 않는다). 바탕은 bodyWritesHarness.
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
const { A1, DRAFT, down, setup, statusOf, t } = await import('./bodyWritesHarness');
const { usePolicyRunsStore } = await import('../apps/web/src/stores/policyRunsStore');
const { runKey } = await import('../apps/web/src/lib/policyResult');
const { registerBanner } = await import('../apps/web/src/lib/articleBanner');
const { useToastStore } = await import('../apps/web/src/stores/toastStore');

const unknown = (action: string) => t('policyWrites.unknown', { action });

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  api.get.mockResolvedValue({ id: 'P1', appendices: [], chapters: [] });
  api.commentList.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const f of Object.values(api)) f.mockReset();
  usePolicyRunsStore.getState().clear();
  useToastStore.getState().clear();
});

describe('진행 중 대상과 막힘 (T-224 단계 C, 완료 정의 ①)', () => {
  it('쓰기마다 진행 대상은 페이지가 견주는 이름이고, 도는 동안 같은 쓰기를 다시 보내면 시작하지 않는다', async () => {
    const s = setup();
    const w = () => s.w();
    const rows: [string, (typeof api)[keyof typeof api], () => Promise<boolean>, string, string][] = [
      ['부칙 추가', api.createAppendix, () => w().saveAppendix({ mode: 'create', draft: DRAFT, kindLabel: '별표', idsBefore: [], token: null }), 'appendix', 'appendix:new'],
      ['부칙 수정', api.updateAppendix, () => w().saveAppendix({ mode: 'edit', appendixId: 'X1', draft: DRAFT, kindLabel: '별표', idsBefore: ['X1'], token: null }), 'appendix', 'appendix:X1'],
      ['부칙 삭제', api.deleteAppendix, () => w().deleteAppendix({ appendixId: 'X1', title: '부칙', kindLabel: '부칙' }), 'appendix', 'delete:X1'],
      ['의견 등록', api.commentCreate, () => w().postComment({ ...A1, content: '의견', idsBefore: [], userId: 'U1' }), 'comment', 'comment:new:a1'],
      ['처리 표시', api.commentUpdate, () => w().resolveComment({ ...A1, commentId: 'C1', resolve: true }), 'comment', 'resolve:C1'],
      ['조문 추가', api.createArticle, () => w().addArticle({ chapterId: 'CH', payloads: [{ number: 4, title: '상여' }], articleLabel: '제4조', token: null }), 'addArticle', 'addArticle'],
    ];
    for (const [name, fn, write, kind, target] of rows) {
      let release!: (v: unknown) => void;
      fn.mockReturnValueOnce(new Promise((r) => (release = r)));
      const first = write();
      expect(usePolicyRunsStore.getState().targets[runKey(kind as never, 'P1')], name).toBe(target);
      expect(await write(), name).toBe(false); // 옮겼다 돌아와 다시 눌러도 같다 — 진행은 화면 밖 저장소에 있다
      release({ id: 'N' });
      expect(await first, name).toBe(true);
      expect(fn, name).toHaveBeenCalledTimes(1);
      expect(usePolicyRunsStore.getState().running, name).toEqual([]);
    }
  });
});

describe('결과 줄의 이름은 항목마다 (T-224 단계 C)', () => {
  it('새 부칙의 확인 못 함 줄은 다른 항목의 성공·실패가 걷거나 바꾸지 않고, 같은 항목을 다시 보내 성공하면 걷힌다', async () => {
    const s = setup();
    const create = (title: string, kind: 'annex' | 'form' = 'annex') =>
      s.w().saveAppendix({ mode: 'create', draft: { ...DRAFT, kind, title }, kindLabel: kind === 'form' ? '서식' : '별표', idsBefore: [], token: null });
    const line1 = `별표 1 — ${unknown('별표 추가')}`;
    api.createAppendix.mockRejectedValueOnce(down);
    await create('별표 1');
    expect(s.last()).toBe(line1);
    api.createAppendix.mockResolvedValueOnce({ id: 'F1' });
    await create('서식 1', 'form');
    expect(s.last()).toBe(line1); // 다른 항목의 성공은 이 줄을 걷지 않고 이름 붙은 알림으로
    expect(s.flash).not.toHaveBeenCalled();
    expect(useToastStore.getState().items.at(-1)?.message).toContain('서식 1 — 추가했습니다.');
    api.createAppendix.mockRejectedValueOnce(down);
    await create('별표 2');
    const line2 = `별표 2 — ${unknown('별표 추가')}`;
    expect(s.last()).toBe(`${line1} / ${line2}`); // 다른 항목의 실패는 덧붙는다
    api.createAppendix.mockResolvedValueOnce({ id: 'X1' });
    await create('별표 1');
    expect(s.last()).toBe(line2);
  });

  it('조문 추가도 자리마다 — 제5조의 확인 못 함 줄은 제6조의 성공이 걷지 않고, 제5조를 다시 보내 성공하면 걷힌다', async () => {
    const s = setup();
    const add = (number: number) => s.w().addArticle({ chapterId: 'CH', payloads: [{ number, title: '조' }], articleLabel: `제${number}조`, token: null });
    const line = `제5조 — ${unknown('조문 추가')}`;
    api.createArticle.mockRejectedValueOnce(down).mockResolvedValueOnce({ id: 'A6' }).mockResolvedValueOnce({ id: 'A5' });
    await add(5);
    expect(s.last()).toBe(line);
    await add(6);
    expect(s.last()).toBe(line);
    expect(s.flash).not.toHaveBeenCalled();
    await add(5);
    expect(s.last()).toBe('');
    expect(s.flash).toHaveBeenLastCalledWith('제5조 — 조문을 추가했습니다.', expect.any(Number));
    // 같은 조의 다른 항·목도 다른 자리 — 가지·항·목까지 이름에 든다
    const at = (clauseNumber: number, itemNumber: number) =>
      s.w().addArticle({ chapterId: 'CH', payloads: [{ number: 7, branchNumber: 2, clauseNumber, itemNumber, content: '목' }], articleLabel: `제7조의2 ${clauseNumber}-${itemNumber}`, token: null });
    api.createArticle.mockRejectedValueOnce(down).mockResolvedValueOnce({ id: 'A721' }).mockResolvedValueOnce({ id: 'A712' });
    await at(1, 1);
    await at(2, 1);
    await at(1, 2);
    expect(s.last()).toBe(`제7조의2 1-1 — ${unknown('조문 추가')}`);
  });

  it('조 머리를 먼저 만드는 두 요청도 추가하는 행의 자리로 부른다 — 일부만 뒤 그 항을 한 요청으로 다시 보내 성공하면 걷히고, 같은 조의 다른 항은 걷지 않는다', async () => {
    const s = setup();
    const head = { number: 5, title: '수당' };
    const twoStep = (clauseNumber: number) => s.w().addArticle({ chapterId: 'CH', payloads: [head, { number: 5, clauseNumber, content: '항' }], articleLabel: `제5조 ${clauseNumber}`, token: null });
    const oneStep = (clauseNumber: number) => s.w().addArticle({ chapterId: 'CH', payloads: [{ number: 5, clauseNumber, title: '', content: '항' }], articleLabel: `제5조 ${clauseNumber}`, token: null });
    api.createArticle.mockResolvedValueOnce({ id: 'H5' }).mockRejectedValueOnce(down); // 조 머리는 만들고 항에서 실패
    await twoStep(1);
    const partial = `제5조 1 — ${t('bodyWrites.article.partial')}`;
    expect(s.last()).toBe(partial);
    api.createArticle.mockRejectedValueOnce(down); // 다른 항(②)의 첫 요청이 응답 없이 끝난다
    await twoStep(2);
    const unknown2 = `제5조 2 — ${unknown('조문 추가')}`;
    expect(s.last()).toBe(`${partial} / ${unknown2}`);
    api.createArticle.mockResolvedValueOnce({ id: 'C51' });
    await oneStep(1); // 조 머리가 생겨 그 항만 한 요청으로
    expect(s.last()).toBe(unknown2);
  });
});

describe('같은 조문의 숨은 배너 (T-224 단계 C)', () => {
  it('의견 쓰기가 성공해도 숨은 배너에 남은 다른 작업의 줄(판 쓰기의 확인 못 함)은 지우지 않고, 성공 글만 든 배너는 비운다', async () => {
    const s = setup();
    api.commentCreate.mockResolvedValue({ id: 'C1' });
    const kept = statusOf();
    kept.status.fail('제3조(수당) v2 — 시행 승인 요청이 오류로 끝나 반영됐는지 확인하지 못했습니다', 'version:V2');
    let off = registerBanner('P1', 'a1', kept.status, false);
    await s.w().postComment({ ...A1, content: '의견', idsBefore: [], userId: 'U1' });
    expect(kept.last()).toBe('제3조(수당) v2 — 시행 승인 요청이 오류로 끝나 반영됐는지 확인하지 못했습니다');
    off();
    const flashed = statusOf();
    flashed.status.flash('제3조(수당) — 의견을 등록했습니다.', 3000); // 앞 성공 글만 든 배너
    off = registerBanner('P1', 'a1', flashed.status, false);
    expect(flashed.last()).toBeUndefined();
    await s.w().postComment({ ...A1, content: '또', idsBefore: [], userId: 'U1' });
    expect(flashed.last()).toBe('');
    off();
  });
});

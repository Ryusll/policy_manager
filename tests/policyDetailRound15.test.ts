import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * T-215 15차 적대적 검토 반영 — 조 순서 저장 실패 뒤의 판정(#1 서버가 거절했으면 그 사이 순서가 바뀌었어도 서버 문구, 응답이 없을 때는
 * 보낸 차례가 보일 때만 '이미 바뀌었습니다' · #2 화면을 옮겨 지켜보는 쪽이 없어도 직접 다시 받는다), 순서 서명은 응답 차례에 기대지
 * 않는다(#4), 창을 새로 그리면 알린다(#5), 초안 일괄 시행도 다시 받은 뒤에 푼다(#6), 영어 문구(#8)
 */
const api = vi.hoisted(() => ({ reorder: vi.fn(), get: vi.fn() }));
vi.mock('../apps/web/src/api/policies', () => ({ policiesApi: { reorderArticles: api.reorder, get: api.get } }));
const { expectedPlaces, joOrderSignature, orderApplied, reorderNotice, useReorderSave } = await import('../apps/web/src/components/policy-detail/useReorderSave');
const { default: ArticleReorderPanel } = await import('../apps/web/src/components/ArticleReorderPanel');
const { usePolicyRunsStore } = await import('../apps/web/src/stores/policyRunsStore');
const { messages } = await import('../apps/web/src/i18n/messages');

function capture<T>(hook: () => T, client: QueryClient): T {
  let out: T | undefined;
  const C = () => {
    out = hook();
    return null;
  };
  const el: ReactElement = createElement(QueryClientProvider, { client }, createElement(C));
  renderToStaticMarkup(el);
  return out as T;
}
const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const t = (k: string) => k;
afterEach(() => {
  usePolicyRunsStore.getState().clear();
  vi.clearAllMocks();
});

// 제1조(a1)·제2조(a2) 를 바꿔 보낸다 — 반영되면 a2 가 1, a1 이 2
const before = [{ id: 'c1', number: 1, articles: [{ id: 'a1', number: 1 }, { id: 'a2', number: 2 }] }];
const ours = [{ id: 'c1', number: 1, articles: [{ id: 'a2', number: 1 }, { id: 'a1', number: 2 }] }];
// 그 사이 다른 사람이 조를 하나 더했다(우리 차례는 반영되지 않음)
const theirs = [{ id: 'c1', number: 1, articles: [{ id: 'a1', number: 1 }, { id: 'a2', number: 2 }, { id: 'a3', number: 3 }] }];
const swap = [
  { chapterId: 'c1', jo: 2 },
  { chapterId: 'c1', jo: 1 },
];

function setup(fresh: unknown) {
  const client = new QueryClient();
  client.setQueryData(['policy', 'A'], { chapters: before });
  if (fresh instanceof Error) api.get.mockRejectedValueOnce(fresh);
  else api.get.mockResolvedValueOnce({ chapters: fresh });
  const o = { id: 'A', label: 'A-01 가 규정', panelOpen: false, chapters: before, signature: joOrderSignature(before), shown: { id: 'A', mounted: false }, report: vi.fn(), setError: vi.fn(), setNote: vi.fn(), onSaved: vi.fn(), t, note: null, basedOn: 'f'.repeat(64) };
  return { client, o, save: () => capture(() => useReorderSave(o), client).save(swap) };
}

describe('조 순서 저장 실패 뒤의 판정 (T-215 15차 #1·#2)', () => {
  it('서버가 거절(400)했는데 그 사이 다른 사람이 조를 더했다 — 창을 닫지 않고 서버 문구 그대로', async () => {
    api.reorder.mockRejectedValueOnce({ response: { status: 400, data: { message: '규정의 모든 조를 빠짐없이 한 번씩 보내야 합니다.' } } });
    const { o, save } = setup(theirs);
    await save();
    expect(o.onSaved).not.toHaveBeenCalled();
    expect(o.report).toHaveBeenCalledWith('A', 'A-01 가 규정', '규정의 모든 조를 빠짐없이 한 번씩 보내야 합니다.', 'error');
  });

  it('서버가 거절(409)했으면 받은 순서가 보낸 차례와 같아도 반영됐다고 하지 않는다', async () => {
    api.reorder.mockRejectedValueOnce({ response: { status: 409, data: { message: '시행 예정 개정이 있는 조는 옮길 수 없습니다.' } } });
    const { o, save } = setup(ours);
    await save();
    expect(o.onSaved).not.toHaveBeenCalled();
    expect(o.report).toHaveBeenCalledWith('A', 'A-01 가 규정', '시행 예정 개정이 있는 조는 옮길 수 없습니다.', 'error');
  });

  it('응답이 없고(504) 받은 순서가 다른 사람의 것 — 반영됐다고 하지 않고, 반영됐는지 모른다며 창을 닫는다(16차 #1 — 서버가 나중에 반영할 수 있어 옛 순서 창에서 다시 저장하면 두 번 적용된다)', async () => {
    api.reorder.mockRejectedValueOnce(new Error('504'));
    const { o, save } = setup(theirs);
    await save();
    expect(o.onSaved).toHaveBeenCalledTimes(1);
    expect(o.report).toHaveBeenCalledWith('A', 'A-01 가 규정', 'policyDetail.reorder.unverified', 'error');
    expect(o.report).not.toHaveBeenCalledWith('A', 'A-01 가 규정', 'policyDetail.reorder.appliedAnyway', 'error');
  });

  it('응답이 없고(504) 지켜보는 화면이 없어도(옮김) 직접 다시 받아, 보낸 차례가 보이면 창을 닫고 그렇다고 알린다', async () => {
    api.reorder.mockRejectedValueOnce(new Error('504'));
    const { client, o, save } = setup(ours);
    await save();
    expect(api.get).toHaveBeenCalledWith('A');
    expect(o.onSaved).toHaveBeenCalledTimes(1);
    expect(o.report).toHaveBeenCalledWith('A', 'A-01 가 규정', 'policyDetail.reorder.appliedAnyway', 'error');
    expect(client.getQueryData(['policy', 'A'])).toEqual({ chapters: ours });
  });

  it('응답이 없고 다시 받지도 못했다 — 반영됐는지 모른다며 창을 닫는다', async () => {
    api.reorder.mockRejectedValueOnce(new Error('network'));
    const { o, save } = setup(new Error('down'));
    await save();
    expect(o.onSaved).toHaveBeenCalledTimes(1);
    expect(o.report).toHaveBeenCalledWith('A', 'A-01 가 규정', 'policyDetail.reorder.unverified', 'error');
  });
});

describe('보낸 차례가 갈 자리와 순서 서명 (T-215 15차 #1·#4)', () => {
  // 제2조는 조 본문과 항이 같은 번호의 두 행(a2·a2c), 제2조의2(a3)는 가지 조, 제2장의 제3조(a4)
  const chapters = [
    { id: 'c1', number: 1, articles: [{ id: 'a1', number: 1 }, { id: 'a2', number: 2 }, { id: 'a2c', number: 2 }, { id: 'a3', number: 2, branchNumber: 1 }] },
    { id: 'c2', number: 2, articles: [{ id: 'a4', number: 3 }] },
  ];
  const order = [
    { chapterId: 'c1', jo: 2 },
    { chapterId: 'c1', jo: 1 },
    { chapterId: 'c2', jo: 2, branch: 1 },
    { chapterId: 'c2', jo: 3 },
  ];

  it('서버처럼 — n번째가 가리키는 옛 (번호·가지)의 행이 모두 n번 조·가지 없음·그 장으로', () => {
    const want = expectedPlaces(chapters, order);
    expect(Object.fromEntries(want)).toEqual({ a2: 'c1/1/', a2c: 'c1/1/', a1: 'c1/2/', a3: 'c2/3/', a4: 'c2/4/' });
    const after = [
      { id: 'c1', number: 1, articles: [{ id: 'a2', number: 1 }, { id: 'a2c', number: 1, branchNumber: null }, { id: 'a1', number: 2 }] },
      { id: 'c2', number: 2, articles: [{ id: 'a3', number: 3, branchNumber: null }, { id: 'a4', number: 4 }] },
    ];
    expect(orderApplied(after, want)).toBe(true);
    expect(orderApplied(chapters, want)).toBe(false);
    expect(orderApplied([{ ...after[0] }, { id: 'c2', number: 2, articles: [{ id: 'a3', number: 3 }, { id: 'a4', number: 3 }] }], want)).toBe(false);
    expect(orderApplied(after, new Map())).toBe(false);
  });

  it('순서 서명은 응답 배열의 차례에 기대지 않는다 — 자리가 같은 조문의 차례가 바뀌어도 같고, 자리·장 번호가 바뀌면 다르다', () => {
    const a = [{ id: 'c1', number: 1, articles: [{ id: 'x', number: 1 }, { id: 'y', number: 1 }] }];
    const flipped = [{ id: 'c1', number: 1, articles: [{ id: 'y', number: 1 }, { id: 'x', number: 1 }] }];
    expect(joOrderSignature(flipped)).toBe(joOrderSignature(a));
    expect(joOrderSignature([{ id: 'c1', number: 1, articles: [{ id: 'x', number: 1 }, { id: 'y', number: 2 }] }])).not.toBe(joOrderSignature(a));
    expect(joOrderSignature([{ id: 'c1', number: 2, articles: a[0].articles }])).not.toBe(joOrderSignature(a));
    expect(joOrderSignature([{ id: 'c1', number: 1, articles: [{ id: 'x', number: 1, branchNumber: 0 }, { id: 'y', number: 1, branchNumber: null }] }])).toBe(joOrderSignature(a));
  });
});

describe('창을 새로 그리면 알린다·초안 일괄 시행·영어 문구 (T-215 15차 #5·#6·#8)', () => {
  it('순서 창은 기준(연 때·저장을 시작한 때·거절 안내를 단 때) 뒤에 새로 그려지면 안내를 보인다 — 저장 중에는 없다(T-225 로 서명 비교에서 바꿈)', () => {
    const page = src('apps/web/src/pages/PolicyDetailPage.tsx');
    // 창이 열렸는지만 둔다 — 연 뒤 새로 그렸는지는 훅의 창 기준(서명을 견주지 않는다, T-225)
    expect(page).toContain('const [reorderOpen, setReorderOpen] = useState(false);');
    expect(page).toMatch(/setReorderNote\(null\);\s*setReorderOpen\(true\);/);
    // 저장하는 동안은 안내하지 않는다 — 제 저장이 끝나 다시 받은 순서로 창이 잠깐 새로 그려져도 '옮기던 것이 있으면 다시 옮기세요'를 띄우지 않게(16차).
    // 안내 칸은 reorderNotice 가 정한다(T-225 — 거절 안내가 그 순서의 것이면 그것 하나)
    expect(page).toContain('{...reorderNotice({ note: reorderNote, signature: reorderSig, redrawn: reorder.redrawn, saving: reorder.saving }, t)}');
    const k = (key: string) => key;
    expect(reorderNotice({ note: null, signature: 'S2', redrawn: true, saving: true }, k)).toEqual({});
    expect(reorderNotice({ note: null, signature: 'S2', redrawn: true, saving: false }, k)).toEqual({ notice: 'policyDetail.reorder.reopened', noticeAlert: false });
    expect(reorderNotice({ note: null, signature: 'S1', redrawn: false, saving: false }, k)).toEqual({});
    expect(page).toMatch(/useReorderSave\(\{[^}]*chapters: policy\?\.chapters,/);
    const chapters = [{ id: 'c1', number: 1, title: '총칙', articles: [{ id: 'a1', number: 1, title: '목적' }] }];
    const html = renderToStaticMarkup(createElement(ArticleReorderPanel, { chapters, notice: '다시 열었습니다', onCancel: () => undefined, onSave: () => undefined }));
    expect(html).toMatch(/<p role="status"[^>]*>다시 열었습니다<\/p>/);
    // 저장이 반영되지 않았다는 안내(T-225 거절)는 alert — 창이 새로 붙으며 끼워 넣는 status 칸은 화면 낭독기가 읽지 않을 수 있다
    const alertHtml = renderToStaticMarkup(createElement(ArticleReorderPanel, { chapters, notice: '반영하지 않았습니다', noticeAlert: true, onCancel: () => undefined, onSave: () => undefined }));
    expect(alertHtml).toMatch(/<p role="alert"[^>]*>반영하지 않았습니다<\/p>/);
    expect(renderToStaticMarkup(createElement(ArticleReorderPanel, { chapters, onCancel: () => undefined, onSave: () => undefined }))).not.toContain('role="status"');
    expect(messages.ko['policyDetail.reorder.reopened']).toBeTruthy();
    expect(messages.en['policyDetail.reorder.reopened']).toBeTruthy();
    expect(messages.en['policyDetail.reorder.unverified']).toBeTruthy();
  });

  it('초안 일괄 시행 — 다시 받은 뒤에 창을 닫고 알리며 진행을 푼다', () => {
    const page = src('apps/web/src/pages/PolicyDetailPage.tsx');
    expect(page).toMatch(
      /onSuccess: async \(res, v\) => \{\s*(\/\/[^\n]*\n\s*)*const inScope = authScopeGuard\(\);\s*const fresh = await fetchPolicyNow\(qc, v\.policyId, inScope\);\s*if \(!inScope\(\)\) return;\s*setPublishDraftsForm/,
    );
    // 17차 — 다시 받지 못했으면 화면이 옛 값이라고 덧붙인다
    expect(page).toMatch(
      /if \(fresh\) reportResult\(v\.policyId, v\.label, done, 'success', 4000\);\s*else reportResult\(v\.policyId, v\.label, `\$\{done\} \$\{t\('policyDetail\.result\.refreshFailed'\)\}`, 'error'\);/,
    );
  });

  it('영어 — 한 건이어도 맞는 꼴, 예시와 버튼 이름은 줄과 같은 법령식 번호', () => {
    expect(messages.en['policyDetail.reorder.moved']).toBe('Article numbers that will change: {n}');
    expect(messages.en['policyDetail.reorder.numbering']).toContain('제1장 제1·2조 → 제2장 제3조');
    expect(messages.en['policyDetail.reorder.up']).toBe('Move 제{n}조 up');
    expect(messages.en['policyDetail.reorder.down']).toBe('Move 제{n}조 down');
  });
});

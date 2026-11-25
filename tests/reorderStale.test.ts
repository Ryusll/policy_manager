import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * T-225 — 조 순서 저장의 비교 후 교체(화면 쪽): 창이 그린 규정의 배치 지문(GET :id 의 current.joOrderBasis)을 저장할 때 꼭 함께 보내고,
 * 서버가 창을 연 뒤에 배치가 바뀌었다고 거절하면(409 POLICY_JO_ORDER_STALE) 서버 문구 대신 화면 문구를 창 위 안내 칸에 하나만 보인다
 * (다시 받은 순서로 새로 그린 창의 '다시 열었습니다' 안내 대신 — 완료 정의 ②의 같은 자리). 문구는 창에 무엇이 있는지에 따라 셋.
 */
const api = vi.hoisted(() => ({ reorder: vi.fn(), get: vi.fn() }));
vi.mock('../apps/web/src/api/policies', () => ({ policiesApi: { reorderArticles: api.reorder, get: api.get } }));
const { baseStep, joOrderSignature, noteLeft, reorderNotice, staleKey, useReorderSave } = await import('../apps/web/src/components/policy-detail/useReorderSave');
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
const t = (k: string) => k;
const before = [{ id: 'c1', number: 1, articles: [{ id: 'a1', number: 1 }, { id: 'a2', number: 2 }] }];
const theirs = [{ id: 'c1', number: 1, articles: [{ id: 'a2', number: 1 }, { id: 'a1', number: 2 }] }];
const swap = [
  { chapterId: 'c1', jo: 2 },
  { chapterId: 'c1', jo: 1 },
];
const BASIS = 'a'.repeat(64);

function setup(panelOpen: boolean, refetch: () => Promise<unknown> = () => Promise.resolve({ chapters: theirs }), basis: { value?: string } = { value: BASIS }) {
  const client = new QueryClient();
  client.setQueryData(['policy', 'A'], { chapters: before });
  api.get.mockImplementationOnce(refetch); // 거절 뒤 다시 받기 — 기본은 다른 저장이 바꾼 순서
  const o = {
    id: 'A',
    label: 'A-01 가 규정',
    panelOpen,
    chapters: before,
    basedOn: basis.value,
    signature: joOrderSignature(before),
    shown: { id: 'A', mounted: true },
    report: vi.fn(),
    setError: vi.fn(),
    note: null,
    setNote: vi.fn(),
    onSaved: vi.fn(),
    t,
  };
  return { o, client, save: () => capture(() => useReorderSave(o), client).save(swap) };
}
const stale = { response: { status: 409, data: { statusCode: 409, code: 'POLICY_JO_ORDER_STALE', message: '창을 연 뒤에 …(서버 문구)' } } };
/** 저장을 시작할 때 걷는 것(빈 오류·안내 없음) 말고 남긴 것 */
const shownErrors = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => c[0]).filter(Boolean);

afterEach(() => {
  usePolicyRunsStore.getState().clear();
  api.reorder.mockReset();
  api.get.mockReset();
});

describe('조 순서 저장 — 창을 연 뒤에 바뀐 배치 (T-225)', () => {
  it('창이 그린 규정의 배치 지문을 함께 보낸다', async () => {
    api.reorder.mockResolvedValueOnce({ changed: 2 });
    const { save } = setup(true);
    await save();
    expect(api.reorder).toHaveBeenCalledWith('A', swap, BASIS);
  });

  it('지문이 없으면(옛 응답) 보내지 않고 창 안에 새로 고치라는 문구 — 진행도 걸지 않는다', async () => {
    const { o, save } = setup(true, undefined, {}); // GET :id 가 지문을 주지 않은 옛 응답
    await save();
    expect(api.reorder).not.toHaveBeenCalled();
    expect(o.setError).toHaveBeenLastCalledWith('policyDetail.reorder.basisMissing');
    expect(usePolicyRunsStore.getState().running).toEqual([]);
  });

  it('서버가 지문 없음으로 거절하면(400 code) 서버 문구 대신 화면 문구', async () => {
    api.reorder.mockRejectedValueOnce({ response: { status: 400, data: { code: 'POLICY_JO_ORDER_BASIS_REQUIRED', message: '화면이 최신이 아니어서 …' } } });
    const { o, save } = setup(true);
    await save();
    expect(o.setError).toHaveBeenLastCalledWith('policyDetail.reorder.basisMissing');
  });

  it('거절되면(409 code) 규정을 다시 받고, 다시 그린 순서의 창 위 안내 칸에 화면 문구 하나만 — 오류 칸은 비우고 창은 닫지 않는다', async () => {
    api.reorder.mockRejectedValueOnce(stale);
    const { o, save } = setup(true);
    await save();
    expect(api.get).toHaveBeenCalledWith('A');
    expect(o.setNote).toHaveBeenNthCalledWith(1, null);
    expect(o.setNote).toHaveBeenLastCalledWith({ sig: joOrderSignature(theirs), message: 'policyDetail.reorder.stale' });
    expect(shownErrors(o.setError)).toEqual([]);
    expect(o.report).not.toHaveBeenCalled();
    expect(o.onSaved).not.toHaveBeenCalled();
  });

  it('지금 순서를 받아 오지 못했으면 옛 순서 그대로인 창에 새로 고치라는 문구 — 다시 저장해도 같은 거절이다', async () => {
    api.reorder.mockRejectedValueOnce(stale);
    const { o, save } = setup(true, () => Promise.reject(new Error('network')));
    await save();
    expect(o.setNote).toHaveBeenLastCalledWith({ sig: joOrderSignature(before), message: 'policyDetail.reorder.staleUnfetched' });
    expect(shownErrors(o.setError)).toEqual([]);
  });

  it('다시 받았는데 순서가 창과 같으면(바꿨다 되돌림) 옮긴 그대로 다시 저장하라는 문구 — 창은 새로 그려지지 않아 옮긴 것이 남아 있다', async () => {
    api.reorder.mockRejectedValueOnce(stale);
    const { o, save } = setup(true, () => Promise.resolve({ chapters: before }));
    await save();
    expect(o.setNote).toHaveBeenLastCalledWith({ sig: joOrderSignature(before), message: 'policyDetail.reorder.staleSame' });
  });

  it('다시 받기는 실패했어도 그 사이 다른 받기로 캐시 순서가 바뀌었으면 창은 지금 순서 — 그 순서에 확인하라는 문구', async () => {
    api.reorder.mockRejectedValueOnce(stale);
    const { o, client, save } = setup(true, () => {
      client.setQueryData(['policy', 'A'], { chapters: theirs });
      return Promise.reject(new Error('network'));
    });
    await save();
    expect(o.setNote).toHaveBeenLastCalledWith({ sig: joOrderSignature(theirs), message: 'policyDetail.reorder.stale' });
  });

  it('창이 닫혀 있으면 같은 문구를 결과 알림으로', async () => {
    api.reorder.mockRejectedValueOnce(stale);
    const { o, save } = setup(false);
    await save();
    expect(o.report).toHaveBeenCalledWith('A', 'A-01 가 규정', 'policyDetail.reorder.stale', 'error');
    expect(shownErrors(o.setNote)).toEqual([]);
  });

  it('code 가 없는 409(잠금 기다림 한도 등)는 서버 문구 그대로 오류 칸에', async () => {
    api.reorder.mockRejectedValueOnce({ response: { status: 409, data: { message: '다른 작업이 같은 규정을 고치는 중입니다 — 잠시 뒤 다시 시도하세요.' } } });
    const { o, save } = setup(true);
    await save();
    expect(o.setError).toHaveBeenLastCalledWith('다른 작업이 같은 규정을 고치는 중입니다 — 잠시 뒤 다시 시도하세요.');
    expect(shownErrors(o.setNote)).toEqual([]);
  });
});

describe('창 위 안내 칸과 거절 안내의 수명 (T-225)', () => {
  it('거절 안내가 지금 그린 순서의 것이면 그것 하나(role=alert), 아니면 기준 뒤에 새로 그려졌을 때만 다시 열기 안내(status, 저장 중엔 없음)', () => {
    const note = { sig: 'S2', message: '거절' };
    expect(reorderNotice({ note, signature: 'S2', redrawn: true, saving: false }, t)).toEqual({ notice: '거절', noticeAlert: true });
    expect(reorderNotice({ note, signature: 'S3', redrawn: true, saving: false }, t)).toEqual({ notice: 'policyDetail.reorder.reopened', noticeAlert: false });
    expect(reorderNotice({ note: null, signature: 'S2', redrawn: true, saving: false }, t)).toEqual({ notice: 'policyDetail.reorder.reopened', noticeAlert: false });
    expect(reorderNotice({ note: null, signature: 'S2', redrawn: false, saving: false }, t)).toEqual({});
    expect(reorderNotice({ note: null, signature: 'S2', redrawn: true, saving: true }, t)).toEqual({});
  });

  it('창 기준 — 열 때·거절 안내 때 잡고, 그린 순서가 바뀌면 새로 그림을 켜며 같은 순서로 돌아와도 끄지 않는다', () => {
    const closed = { sig: null, redrawn: false };
    let b = baseStep(closed, { type: 'sig', sig: 'S1' });
    expect(b).toEqual(closed); // 닫혀 있으면 무시
    b = baseStep(b, { type: 'open', sig: 'S1' });
    expect(b).toEqual({ sig: 'S1', redrawn: false });
    expect(baseStep(b, { type: 'sig', sig: 'S1' })).toBe(b); // 같은 순서면 그대로
    b = baseStep(baseStep(b, { type: 'sig', sig: 'S2' }), { type: 'sig', sig: 'S1' });
    expect(b).toEqual({ sig: 'S1', redrawn: true }); // S1→S2→S1 — 돌아와도 새로 그린 것(T-215 16차의 한계를 푼다)
    b = baseStep(b, { type: 'note', sig: 'S3' });
    expect(b).toEqual({ sig: 'S3', redrawn: false }); // 거절 안내를 단 순서가 새 기준
    b = baseStep(baseStep(b, { type: 'sig', sig: 'S4' }), { type: 'save', sig: 'S4' });
    expect(b).toEqual({ sig: 'S4', redrawn: false }); // 저장을 시작한 순서도 새 기준 — 그 뒤 새로 그렸는지가 '이 저장 동안'
    expect(baseStep(b, { type: 'close' })).toEqual(closed);
  });

  it('창 기준은 값이 같으면 받은 객체를 그대로 돌려준다 — 창이 닫힌 채 규정을 열 때 규정 상세 전체를 한 번 더 그리지 않게', () => {
    const closed = { sig: null, redrawn: false };
    expect(baseStep(closed, { type: 'close' })).toBe(closed);
    const at = { sig: 'S1', redrawn: false };
    for (const type of ['open', 'save', 'note'] as const) expect(baseStep(at, { type, sig: 'S1' })).toBe(at);
    expect(baseStep(at, { type: 'save', sig: 'S2' })).toEqual({ sig: 'S2', redrawn: false });
    const redrawn = { sig: 'S1', redrawn: true };
    expect(baseStep(redrawn, { type: 'save', sig: 'S1' })).toEqual({ sig: 'S1', redrawn: false }); // 표시를 끄는 것은 바뀐 값
    expect(baseStep(redrawn, { type: 'close' })).toEqual(closed);
  });

  it('차례 — 거절(S2) 뒤 코드 없는 4xx 면 안내 없음, 또 바뀌어(S3) 다시 그리면 다시 열기 안내, S2 로 돌아와도 다시 열기 안내', () => {
    let note: { sig: string; message: string } | null = null;
    let base = baseStep({ sig: null, redrawn: false }, { type: 'open', sig: 'S1' });
    // 훅의 effect 와 같은 판정 — 그린 순서가 바뀌면 기준을 갱신하고 안내가 떠났으면 걷는다
    const render = (signature: string, saving = false) => {
      base = baseStep(base, { type: 'sig', sig: signature });
      if (noteLeft(note, signature)) note = null;
      return reorderNotice({ note, signature, redrawn: base.redrawn, saving }, t);
    };
    // 거절: 받은 순서 S2 와 안내·기준을 한 번에 그린다(flushSync)
    note = { sig: 'S2', message: '거절' };
    base = baseStep(base, { type: 'note', sig: 'S2' });
    expect(render('S2')).toEqual({ notice: '거절', noticeAlert: true });
    // 같은 창에서 다시 저장 — 시작할 때 안내를 걷고, 코드 없는 4xx 로 끝나 창은 S2 그대로
    note = null;
    expect(render('S2', true)).toEqual({});
    expect(render('S2')).toEqual({});
    // 다른 사람이 바꿔 S3 으로 새로 그림 → 다시 열기 안내, 다시 S2 로 새로 그려도 안내(옮긴 것이 또 사라졌다)
    expect(render('S3')).toEqual({ notice: 'policyDetail.reorder.reopened', noticeAlert: false });
    expect(render('S2')).toEqual({ notice: 'policyDetail.reorder.reopened', noticeAlert: false });
  });

  it('차례 — 새로 그려진 창(다시 열기 안내)에서 다시 옮겨 저장했다가 코드 없는 4xx 면 안내를 다시 띄우지 않고, 그 저장 동안 새로 그려졌으면 띄운다', () => {
    let base = baseStep({ sig: null, redrawn: false }, { type: 'open', sig: 'S1' });
    base = baseStep(base, { type: 'sig', sig: 'S2' });
    expect(reorderNotice({ note: null, signature: 'S2', redrawn: base.redrawn, saving: false }, t)).toEqual({ notice: 'policyDetail.reorder.reopened', noticeAlert: false });
    // S2 에서 다시 옮겨 저장 — 저장을 시작한 순서가 기준, 코드 없는 409 로 끝나고 창은 S2 그대로(옮긴 것이 남아 있다)
    base = baseStep(base, { type: 'save', sig: 'S2' });
    expect(reorderNotice({ note: null, signature: 'S2', redrawn: base.redrawn, saving: true }, t)).toEqual({});
    expect(reorderNotice({ note: null, signature: 'S2', redrawn: base.redrawn, saving: false }, t)).toEqual({});
    // 같은 차례인데 저장하는 동안 다른 받기가 S3 으로 새로 그렸으면 — 옮긴 것이 사라졌으니 안내, 거절 문구는 'stale'
    const during = baseStep(baseStep({ sig: 'S2', redrawn: false }, { type: 'sig', sig: 'S3' }), { type: 'sig', sig: 'S2' });
    expect(reorderNotice({ note: null, signature: 'S2', redrawn: during.redrawn, saving: false }, t)).toEqual({ notice: 'policyDetail.reorder.reopened', noticeAlert: false });
    expect(staleKey({ toDialog: true, fresh: true, redrawn: during.redrawn })).toBe('policyDetail.reorder.stale');
  });

  it('안내를 단 순서를 떠나면 걷는다 — 같은 순서로 돌아와도 옛 거절 문구가 되살아나지 않는다(S2→S3→S2)', () => {
    expect(noteLeft({ sig: 'S2', message: '거절' }, 'S3')).toBe(true);
    expect(noteLeft({ sig: 'S2', message: '거절' }, 'S2')).toBe(false);
    expect(noteLeft(null, 'S1')).toBe(false);
  });

  it('거절 안내의 문구 — 새로 그렸으면 확인 뒤 다시, 받지 못했으면 새로 고침, 옮긴 것이 창에 그대로일 때만 그대로 다시 저장', () => {
    expect(staleKey({ toDialog: true, fresh: true, redrawn: true })).toBe('policyDetail.reorder.stale');
    expect(staleKey({ toDialog: true, fresh: false, redrawn: true })).toBe('policyDetail.reorder.stale');
    expect(staleKey({ toDialog: true, fresh: false, redrawn: false })).toBe('policyDetail.reorder.staleUnfetched');
    expect(staleKey({ toDialog: true, fresh: true, redrawn: false })).toBe('policyDetail.reorder.staleSame');
    // 창이 닫혔으면(결과 알림) 옮긴 것이 없으니 '그대로 다시 저장'을 쓰지 않는다
    expect(staleKey({ toDialog: false, fresh: true, redrawn: false })).toBe('policyDetail.reorder.stale');
    expect(staleKey({ toDialog: false, fresh: false, redrawn: false })).toBe('policyDetail.reorder.staleUnfetched');
  });

  it('창이 닫힌 뒤 거절되고 받은 순서가 그대로면 결과 알림은 확인하고 다시 옮기라는 문구', async () => {
    api.reorder.mockRejectedValueOnce(stale);
    const { o, save } = setup(false, () => Promise.resolve({ chapters: before }));
    await save();
    expect(o.report).toHaveBeenCalledWith('A', 'A-01 가 규정', 'policyDetail.reorder.stale', 'error');
  });

  it('문구(ko·en)는 반영하지 않았다는 것과 할 일을 말하고, 규정 상세가 지문·안내를 훅과 창에 잇는다', () => {
    expect(messages.ko['policyDetail.reorder.stale']).toMatch(/반영하지 않았습니다 — 지금 순서를 확인한 뒤 다시 옮기세요\.$/);
    expect(messages.en['policyDetail.reorder.stale']).toMatch(/was not applied — check the current order and move the articles again\.$/);
    expect(messages.ko['policyDetail.reorder.staleUnfetched']).toMatch(/반영하지 않았습니다 — 지금 순서를 받아 오지 못했으니 화면을 새로 고친 뒤 다시 옮기세요\.$/);
    expect(messages.en['policyDetail.reorder.staleUnfetched']).toMatch(/was not applied — the current order could not be loaded, so reload the page and move the articles again\.$/);
    expect(messages.ko['policyDetail.reorder.staleSame']).toMatch(/반영하지 않았습니다 — 지금 순서가 이 창과 같으니 옮긴 그대로 다시 저장하세요\.$/);
    expect(messages.en['policyDetail.reorder.staleSame']).toMatch(/was not applied — the current order matches this panel, so save your moves again\.$/);
    expect(messages.ko['policyDetail.reorder.basisMissing']).toMatch(/저장하지 않았습니다 — 화면을 새로 고친 뒤 다시 옮기세요\.$/);
    expect(messages.en['policyDetail.reorder.basisMissing']).toMatch(/was not saved — reload the page and move the articles again\.$/);
    const page = readFileSync(join(__dirname, '..', 'apps/web/src/pages/PolicyDetailPage.tsx'), 'utf8');
    expect(page).toMatch(/useReorderSave\(\{[^}]*basedOn: policy\?\.current\?\.joOrderBasis,/);
    expect(page).toMatch(/useReorderSave\(\{[^}]*note: reorderNote,\s*setNote: setReorderNote,/);
    expect(page).toMatch(/setReorderNote\(null\);\s*setReorderOpen\(true\);/);
    expect(page).toContain('{...reorderNotice({ note: reorderNote, signature: reorderSig, redrawn: reorder.redrawn, saving: reorder.saving }, t)}');
    // 거절 안내의 서명은 훅이 캐시에서, 창의 서명은 페이지가 그린 규정에서 같은 함수로 얻는다 — 페이지의 규정 조회가 select 없이 그 캐시
    // 항목을 그대로 그려야 둘이 같다(다르면 방금 단 안내를 effect 가 곧바로 걷는다)
    expect(page).toMatch(/const \{ data: policy, isLoading \} = useQuery\(\{\s*queryKey: \['policy', id\],\s*queryFn: \(\) => policiesApi\.get\(id!\),\s*enabled: !!id,\s*\}\);/);
    expect(page).toContain('const reorderSig = useMemo(() => joOrderSignature(policy?.chapters), [policy?.chapters]);');
    const hook = readFileSync(join(__dirname, '..', 'apps/web/src/components/policy-detail/useReorderSave.ts'), 'utf8');
    expect(hook).toContain("const sig = joOrderSignature(qc.getQueryData<{ chapters?: Chapters }>(['policy', id])?.chapters);");
    expect(hook).toMatch(/useEffect\(\(\) => \{\s*if \(noteLeft\(o\.note, o\.signature\)\) latest\.current\.setNote\(null\);\s*\}, \[o\.note, o\.signature, latest\]\);/);
    // 창 기준은 layout effect 로 — 그린 직후 같은 태스크 안에서 고쳐, 저장이 끝나 문구를 고를 때 baseNow 가 그 그리기까지를 담게
    expect(hook).toMatch(/useLayoutEffect\(\(\) => \{\s*setBase\(\(b\) => baseStep\(b, o\.panelOpen \? \{ type: 'open', sig: latest\.current\.signature \} : \{ type: 'close' \}\)\);\s*\}, \[o\.panelOpen, latest\]\);/);
    expect(hook).toMatch(/useLayoutEffect\(\(\) => \{\s*setBase\(\(b\) => baseStep\(b, \{ type: 'sig', sig: o\.signature \}\)\);\s*\}, \[o\.signature\]\);/);
    expect(hook).toMatch(/flushSync\(\(\) => \{\s*setNote\(\{ sig, message \}\);\s*setBase\(\(b\) => baseStep\(b, \{ type: 'note', sig \}\)\);\s*\}\);/);
    // 성공·5xx 는 창 닫기를 진행 풀기보다 먼저 그린다 — 풀린 그리기에 열린 창이 새 순서로 붙어 '다시 열었습니다'가 끼지 않게
    expect(hook).toMatch(/if \(!failure\) \{\s*flushSync\(\(\) => onSaved\(\)\);/);
    expect(hook).toMatch(/if \(!refused\(failure\.err\)\) \{\s*flushSync\(\(\) => onSaved\(\)\);/);
    // 창 기준의 새로 그림 표시를 페이지에 넘긴다(다시 열기 안내 — 실제 그리기의 차례는 Chrome 하네스로 봤다)
    expect(hook).toMatch(/return \{\s*saving,\s*(\/\*\*[^*]*\*\/\s*)?redrawn: base\.redrawn,/);
    // 저장을 시작할 때 창 기준을 다시 잡고(그 뒤 새로 그렸는지 = 이 저장 동안 새로 그렸는지), 문구를 고를 때는 그 사이 그린 것까지 반영된 지금 값을 읽는다
    expect(hook).toMatch(/if \(!start\('reorder', id\)\) return;\s*watch\.mine = true;\s*setBase\(\(b\) => baseStep\(b, \{ type: 'save', sig: joOrderSignature\(chapters\) \}\)\);/);
    expect(hook).toContain('const baseNow = useLatest(base);');
    expect(hook).toContain('const redrawn = baseNow.current.redrawn || sig !== joOrderSignature(chapters);');
    expect(hook).toContain('const message = t(staleKey({ toDialog, fresh: fresh !== null, redrawn }));');
  });
});

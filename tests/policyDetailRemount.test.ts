import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * T-215 13차 적대적 검토 반영 — 규정마다 새로 그리는 화면(11차)의 남은 곁길:
 * #1 다시 그린 화면에서 저장 중에 연 조 순서 창이 옛 순서를 들고 남았다 — 저장 중에는 창을 열지 않고, 다른 화면이 시작한 저장이 끝나면
 *    이 화면도 선택한 조를 놓는다 · #2 다시 그린 화면의 열린 창에 실패를 보인다(도구 줄은 창 뒤에 가린다) · #3 지우는 파일·#4 보낸 날짜를
 *    다시 그린 화면도 안다 · #5 양식 메뉴가 한 번 옛 양식으로 깜박였다 · #6 등록부의 걸기·빼기를 시험이 본다 · #8 첨부 창 문구 키
 */
const api = vi.hoisted(() => ({ upload: vi.fn(), del: vi.fn(), reorder: vi.fn(), get: vi.fn() }));
vi.mock('../apps/web/src/api/policies', () => ({
  filesApi: { upload: api.upload, delete: api.del },
  policiesApi: { reorderArticles: api.reorder, get: api.get },
}));
const { openDialogFor, registerOpenDialog, registerToolbar, toolbarFor } = await import('../apps/web/src/lib/policyResult');
const { useAttachmentActions } = await import('../apps/web/src/components/policy-detail/useAttachmentActions');
const { joOrderSignature, reorderWatchStep, useReorderSave } = await import('../apps/web/src/components/policy-detail/useReorderSave');
const { shownTemplateId, TEMPLATE_SELECTION_INITIAL } = await import('../apps/web/src/components/policy-detail/useTemplateSelection');
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
const flush = () => new Promise((r) => setTimeout(r, 0));
const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const t = (k: string) => k;
afterEach(() => {
  usePolicyRunsStore.getState().clear();
  vi.clearAllMocks();
});

describe('등록부 — 걸고 빼기 (T-215 13차 #6)', () => {
  it('도구 줄: 새 화면이 먼저 걸었으면 옛 화면의 빼기는 그대로 둔다, 제 것을 빼면 비운다', () => {
    const s1 = { id: 1 } as never;
    const s2 = { id: 2 } as never;
    const off1 = registerToolbar('A', s1);
    expect(toolbarFor('A')).toBe(s1);
    const off2 = registerToolbar('A', s2); // 옮겼다 돌아와 새로 그린 화면
    off1(); // 내려간 옛 화면의 정리가 늦게 돌아도
    expect(toolbarFor('A')).toBe(s2);
    off2();
    expect(toolbarFor('A')).toBeUndefined();
  });

  it('열린 창: 같은 규칙', () => {
    const e1 = vi.fn();
    const e2 = vi.fn();
    const off1 = registerOpenDialog('attachments', 'A', e1);
    const off2 = registerOpenDialog('attachments', 'A', e2);
    off1();
    expect(openDialogFor('attachments', 'A')).toBe(e2);
    expect(openDialogFor('reorder', 'A')).toBeUndefined();
    off2();
    expect(openDialogFor('attachments', 'A')).toBeUndefined();
  });

  it('훅은 그린 직후 걸고 내려갈 때 뺀다(효과 정리 — 서버 렌더에서는 돌지 않아 원문으로 본다)', () => {
    const lib = src('apps/web/src/lib/policyResult.ts');
    expect(lib).toContain('useLayoutEffect(() => (policyId ? registerToolbar(policyId, status) : undefined), [policyId, status]);');
    expect(lib).toContain('useLayoutEffect(() => (policyId && open ? registerOpenDialog(kind, policyId, setError) : undefined), [kind, policyId, open, setError]);');
  });
});

describe('다시 그린 화면의 열린 첨부 창·지우는 파일 (T-215 13차 #2·#3)', () => {
  const opts = (over = {}) => ({ id: 'A', label: 'A-01 가 규정', modalOpen: false, shown: { id: 'A', mounted: false }, report: vi.fn(), setError: vi.fn(), t, ...over });

  it('시작한 화면이 내려갔어도 같은 규정을 다시 그린 화면에 첨부 창이 열려 있으면 실패는 그 창 안', async () => {
    const client = new QueryClient();
    const openHere = vi.fn();
    const off = registerOpenDialog('attachments', 'A', openHere);
    api.upload.mockRejectedValueOnce({ response: { data: { message: '파일이 너무 큽니다' } } });
    const old = opts();
    capture(() => useAttachmentActions(old), client).upload(new File(['x'], 'a.pdf'));
    await flush();
    expect(openHere).toHaveBeenCalledWith('파일이 너무 큽니다');
    expect(old.report).not.toHaveBeenCalled();
    off();
    api.upload.mockRejectedValueOnce({});
    const again = opts();
    capture(() => useAttachmentActions(again), client).upload(new File(['x'], 'b.pdf'));
    await flush();
    expect(again.report).toHaveBeenCalledWith('A', 'A-01 가 규정', 'policyDetail.files.uploadFailed', 'error');
  });

  it('조 순서 — 실패해도 다시 받고, 서버가 거절했으면 그 문구를 알리고 창은 둔다. 응답만 끊기고 보낸 차례가 보이면 창을 닫고 그렇다고 알린다(14차 #2·15차 #1·16차 #1)', async () => {
    const before = [{ id: 'c1', articles: [{ id: 'a1', number: 1 }, { id: 'a2', number: 2 }] }];
    const after = [{ id: 'c1', articles: [{ id: 'a2', number: 1 }, { id: 'a1', number: 2 }] }];
    const order = [
      { chapterId: 'c1', jo: 2 },
      { chapterId: 'c1', jo: 1 },
    ];
    const client = new QueryClient();
    client.setQueryData(['policy', 'A'], { chapters: before });
    const o = { id: 'A', label: 'A-01 가 규정', panelOpen: false, chapters: before, signature: joOrderSignature(before), shown: { id: 'A', mounted: false }, report: vi.fn(), setError: vi.fn(), setNote: vi.fn(), onSaved: vi.fn(), t, note: null, basedOn: 'f'.repeat(64) };
    api.reorder.mockRejectedValueOnce({ response: { status: 409, data: {} } });
    api.get.mockResolvedValueOnce({ chapters: before });
    await capture(() => useReorderSave(o), client).save(order);
    expect(o.report).toHaveBeenCalledWith('A', 'A-01 가 규정', 'policyDetail.reorder.failed', 'error');
    expect(o.onSaved).not.toHaveBeenCalled();
    // 서버에는 반영됐는데 응답만 실패 — 실패 뒤 다시 받아야 새 순서를 안다(다시 받기가 서버의 새 순서를 가져온다)
    api.reorder.mockRejectedValueOnce(new Error('504'));
    api.get.mockResolvedValueOnce({ chapters: after });
    const o2 = { ...o, report: vi.fn(), onSaved: vi.fn() };
    await capture(() => useReorderSave(o2), client).save(order);
    expect(o2.onSaved).toHaveBeenCalledTimes(1);
    expect(o2.report).toHaveBeenCalledWith('A', 'A-01 가 규정', 'policyDetail.reorder.appliedAnyway', 'error');
    expect(src('apps/web/src/components/policy-detail/useAttachmentActions.ts')).toContain("useOpenDialog('attachments', o.id, o.modalOpen, o.setError);");
  });

  it('순서 창은 순서 서명이 바뀌면 새로 그린다 — 다시 받은 새 순서로 다시 잡히고 옛 순서를 들고 남지 않는다(14차 #1)', () => {
    const page = src('apps/web/src/pages/PolicyDetailPage.tsx');
    expect(page).toContain('const reorderSig = useMemo(() => joOrderSignature(policy?.chapters), [policy?.chapters]);');
    expect(page).toMatch(/<ArticleReorderPanel\s+key=\{reorderSig\}/);
    expect(page).toContain('signature: reorderSig,');
    const a = [{ id: 'c1', articles: [{ id: 'a1', number: 1 }, { id: 'a2', number: 2, branchNumber: null }] }];
    expect(joOrderSignature(a)).toBe(joOrderSignature(JSON.parse(JSON.stringify(a))));
    expect(joOrderSignature(a)).not.toBe(joOrderSignature([{ id: 'c1', articles: [{ id: 'a1', number: 2 }, { id: 'a2', number: 1 }] }]));
    expect(joOrderSignature(a)).not.toBe(joOrderSignature([{ id: 'c2', articles: a[0].articles }]));
  });

  it.each([
    ['다른 화면의 저장이 끝나 순서가 바뀜 — 선택을 놓는다', { saving: true, mine: false, sigAtStart: 'S1' }, false, 'S2', true],
    ['다른 화면의 저장이 실패로 끝나 순서 그대로 — 놓지 않는다', { saving: true, mine: false, sigAtStart: 'S1' }, false, 'S1', false],
    ['이 화면이 시작한 저장 — save 가 다룬다', { saving: true, mine: true, sigAtStart: 'S1' }, false, 'S2', false],
    ['저장 중을 처음 봄(저장 중에 그려짐) — 그때의 순서를 잡는다', { saving: false, mine: false, sigAtStart: '' }, true, 'S1', false],
    ['같은 단계를 두 번(StrictMode) — 바꾸지 않는다', { saving: true, mine: false, sigAtStart: 'S1' }, true, 'S1', false],
  ] as const)('조 순서 지켜보기: %s', (_n, w, saving, sig, settled) => {
    const r = reorderWatchStep({ ...w }, saving, sig);
    expect(r.settled).toBe(settled);
    if (!w.saving && saving) expect(r.next.sigAtStart).toBe(sig);
    if (w.saving && !saving) expect(r.next).toEqual({ saving: false, mine: false, sigAtStart: '' });
  });

  it('지우는 파일 id 를 저장소에 둔다 — 다시 그린 화면도 그 줄에 지우는 중을 보인다', async () => {
    const client = new QueryClient();
    let settle: () => void = () => undefined;
    api.del.mockReturnValueOnce(new Promise<void>((r) => (settle = r)));
    capture(() => useAttachmentActions(opts()), client).remove('f-9');
    await flush();
    expect(usePolicyRunsStore.getState().targets).toEqual({ 'deleteFile:A': 'f-9' });
    settle();
    await flush();
    expect(usePolicyRunsStore.getState().targets).toEqual({});
    expect(src('apps/web/src/components/policy-detail/useAttachmentActions.ts')).toContain("removingId: deleteBusy ? targetOf('deleteFile', o.id) : undefined,");
  });
});

describe('조 순서 창·규정 정보·양식 메뉴 (T-215 13차 #1·#4·#5)', () => {
  it('저장 중에는 조 순서 창을 열지 않고, 다른 화면이 시작한 저장이 끝나면 이 화면도 선택한 조를 놓는다', () => {
    const page = src('apps/web/src/pages/PolicyDetailPage.tsx');
    expect(page).toContain('disabled={reorder.saving}');
    expect(page).toContain("{t(reorder.saving ? 'policyDetail.reorder.busy' : 'policyDetail.reorder.open')}");
    // 지켜보기의 판단은 reorderWatchStep(위 표), 훅은 그 결과로 onSaved 를 부르고 자기 저장을 표시한다(14차 #8 — 순수 함수로 뺐다)
    const hook = src('apps/web/src/components/policy-detail/useReorderSave.ts');
    expect(hook).toMatch(/const \{ next, settled \} = reorderWatchStep\(watch, saving, o\.signature\);\s*Object\.assign\(watch, next\);\s*if \(settled\) latest\.current\.onSaved\(\);/);
    // 진행을 건 바로 뒤에 자기 저장을 표시한다(T-225 — 그 앞에 지문이 없으면 보내지 않는 확인이 들어갔다)
    expect(hook).toMatch(/if \(!start\('reorder', id\)\) return;\s*watch\.mine = true;/);
  });

  it('규정 정보 — 보낸 날짜를 저장소에 두고, 저장 중이면 그 날짜를 그린다(칸은 막는다)', () => {
    const page = src('apps/web/src/pages/PolicyDetailPage.tsx');
    expect(page).toContain("if (!startRun('info', id!, JSON.stringify(sent))) return;");
    expect(page).toContain("revisionDate={infoSent ? (infoSent.revisionDate ?? '') : policyRevisionDate}");
    expect(page).toContain("effectiveDate={infoSent ? (infoSent.effectiveDate ?? '') : policyEffectiveDate}");
    expect(page).toContain('saving={infoBusy}');
  });

  it.each([
    ['서버 값을 따라온 상태 — 고른 값', { policyId: 'A', server: 'S', selected: 'X', savingFor: [] }, 'S', undefined, 'X'],
    ['서버 값이 바뀌었는데 상태가 아직 — 서버 값(옛 고른 값으로 깜박이지 않게)', { policyId: 'A', server: 'S', selected: 'S', savingFor: [] }, 'N', undefined, 'N'],
    ['저장 중 — 보낸 값', { policyId: 'A', server: 'S', selected: 'S', savingFor: [] }, 'S', 'P', 'P'],
    ["저장 중 — 보낸 값이 '자동'('')", { policyId: 'A', server: 'S', selected: 'S', savingFor: [] }, 'S', '', ''],
    ['처음(아직 동기화 전) — 서버 값', TEMPLATE_SELECTION_INITIAL, 'S', undefined, 'S'],
    ['규정을 아직 받지 않음 — 빈 값', TEMPLATE_SELECTION_INITIAL, null, undefined, ''],
  ] as const)('%s', (_name, state, serverValue, pendingValue, want) => {
    expect(shownTemplateId(state as never, 'A', serverValue as string | null, pendingValue as string | undefined)).toBe(want);
  });
});

describe('첨부 창 문구 키 (T-215 13차 #8)', () => {
  it('첨부 창의 문구는 키로 — 한국어를 직접 쓰지 않고, ko·en 이 짝을 이룬다', () => {
    const page = src('apps/web/src/pages/PolicyDetailPage.tsx');
    for (const s of ['첨부파일 확인', '등록된 첨부파일이 없습니다', "'업로드 중...'", "'파일 추가'", '을(를) 삭제할까요?', '삭제 중…</span>']) expect(page, s).not.toContain(s);
    for (const k of ['title', 'close', 'empty', 'add', 'uploading', 'delete', 'deleteNamed', 'deleting', 'confirmDelete']) {
      const key = `policyDetail.files.${k}`;
      expect(messages.ko[key], key).toBeTruthy();
      expect(messages.en[key], key).toBeTruthy();
      expect(page, key).toContain(`'${key}'`);
    }
  });
});

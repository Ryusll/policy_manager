import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * T-215 12차 적대적 검토 반영 — 규정마다 화면을 새로 그리면서 생긴 곁길:
 * #1 첨부 올리기·지우기와 조 순서 저장의 실패가 내려간 화면의 지역 상태에 쓰여 사라지고, 옮겼다 돌아오면 다시 누를 수 있었다
 * #2 새로 그린 화면이 무엇을 저장 중인지 몰라 옛 양식에 '저장 중'을 붙였다
 * #3 앞 화면이 시작한 작업의 결과가, 같은 규정을 다시 그린 화면이 떠 있어도 4초짜리 알림으로만 갔다
 * #4 새 화면이 저장소의 진행을 구독하는지 시험이 보지 않았다, #5 같은 실패 글 판정이 ' / ' 로 잘라 서버 문구에 따라 어긋났다
 */
// 순서 저장이 실패하면 시작한 규정을 다시 받는다(15차 #2) — 서버는 떠 있고 순서는 그대로인 규정
const api = vi.hoisted(() => ({ upload: vi.fn(), del: vi.fn(), reorder: vi.fn(), get: vi.fn(() => Promise.resolve({ chapters: [] })) }));
vi.mock('../apps/web/src/api/policies', () => ({
  filesApi: { upload: api.upload, delete: api.del },
  policiesApi: { reorderArticles: api.reorder, get: api.get },
}));
const { deliverResult, useToolStatus } = await import('../apps/web/src/lib/policyResult');
const { useAttachmentActions } = await import('../apps/web/src/components/policy-detail/useAttachmentActions');
const { useReorderSave } = await import('../apps/web/src/components/policy-detail/useReorderSave');
const { useTemplateSelection } = await import('../apps/web/src/components/policy-detail/useTemplateSelection');
const { usePolicyRunsStore } = await import('../apps/web/src/stores/policyRunsStore');

/** 훅을 한 번 그려 돌려준 값을 받는다 — 부를 때마다 새 화면이다(규정을 옮겼다 돌아와 새로 그린 화면) */
function capture<T>(hook: () => T, client?: QueryClient): T {
  let out: T | undefined;
  const C = () => {
    out = hook();
    return null;
  };
  const el: ReactElement = client ? createElement(QueryClientProvider, { client }, createElement(C)) : createElement(C);
  renderToStaticMarkup(el);
  return out as T;
}
const pending = () => {
  let settle: { ok: () => void; fail: (e: unknown) => void } = { ok: () => undefined, fail: () => undefined };
  const p = new Promise<void>((ok, fail) => (settle = { ok: () => ok(), fail }));
  return { p, settle: () => settle };
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const t = (k: string) => k;
const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
afterEach(() => {
  usePolicyRunsStore.getState().clear();
  vi.clearAllMocks();
});

describe('첨부 올리기·지우기 — 진행은 규정별 저장소, 실패는 버리지 않는다 (T-215 12차 #1)', () => {
  const opts = (over: Partial<Parameters<typeof useAttachmentActions>[0]> = {}) => ({
    id: 'A', label: 'A-01 가 규정', modalOpen: true, shown: { id: 'A', mounted: false }, report: vi.fn(), setError: vi.fn(), t, ...over,
  });

  it('올리는 중에 다시 그린 화면은 다시 올리지 않고, 앞 화면이 내려간 뒤의 실패는 규정 이름 붙은 결과 알림으로 간다', async () => {
    const client = new QueryClient();
    const call = pending();
    api.upload.mockReturnValueOnce(call.p);
    const first = opts();
    capture(() => useAttachmentActions(first), client).upload(new File(['x'], 'a.pdf'));
    await flush(); // mutation 은 다음 차례에 요청을 보낸다
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(usePolicyRunsStore.getState().running).toEqual(['upload:A']);
    capture(() => useAttachmentActions(opts()), client).upload(new File(['x'], 'a.pdf')); // 옮겼다 돌아와 새로 그린 화면
    await flush();
    expect(api.upload).toHaveBeenCalledTimes(1);
    call.settle().fail({ response: { data: { message: '파일이 너무 큽니다' } } });
    await flush();
    expect(first.report).toHaveBeenCalledWith('A', 'A-01 가 규정', '파일이 너무 큽니다', 'error');
    expect(first.setError).not.toHaveBeenCalledWith('파일이 너무 큽니다');
    expect(usePolicyRunsStore.getState().running).toEqual([]);
  });

  it('시작한 규정의 첨부 창이 열려 있으면 실패는 창 안, 창을 닫았으면 결과 알림 — 지우기도 같다', async () => {
    const client = new QueryClient();
    for (const [modalOpen, where] of [[true, 'dialog'], [false, 'report']] as const) {
      api.del.mockRejectedValueOnce({});
      const o = opts({ modalOpen, shown: { id: 'A', mounted: true } });
      capture(() => useAttachmentActions(o), client).remove('f-1');
      await flush();
      if (where === 'dialog') expect(o.setError).toHaveBeenCalledWith('policyDetail.files.deleteFailed');
      else expect(o.report).toHaveBeenCalledWith('A', 'A-01 가 규정', 'policyDetail.files.deleteFailed', 'error');
      expect(usePolicyRunsStore.getState().running).toEqual([]);
    }
  });
});

describe('조 순서 저장 — 같은 규칙 (T-215 12차 #1)', () => {
  it('저장 중에 다시 그린 화면은 겹쳐 저장하지 않고, 옮긴 뒤의 실패는 결과 알림으로, 성공하면 저장 중이 풀린다', async () => {
    const client = new QueryClient();
    const call = pending();
    api.reorder.mockReturnValueOnce(call.p);
    const o = { id: 'A', label: 'A-01 가 규정', panelOpen: true, shown: { id: 'A', mounted: false }, report: vi.fn(), setError: vi.fn(), onSaved: vi.fn(), t };
    const saving = capture(() => useReorderSave(o), client).save([]);
    await capture(() => useReorderSave(o), client).save([]);
    expect(api.reorder).toHaveBeenCalledTimes(1);
    // 서버가 거절한 실패(4xx — 반영 안 됨)는 창을 닫지 않고 그 문구로 알린다. 응답이 없는 실패는 16차부터 창을 닫는다(policyDetailRound16)
    call.settle().fail({ response: { status: 400, data: { message: '규정의 모든 조를 빠짐없이 한 번씩 보내야 합니다.' } } });
    await saving;
    expect(o.report).toHaveBeenCalledWith('A', 'A-01 가 규정', '규정의 모든 조를 빠짐없이 한 번씩 보내야 합니다.', 'error');
    expect(o.onSaved).not.toHaveBeenCalled();
    expect(usePolicyRunsStore.getState().running).toEqual([]);
    api.reorder.mockResolvedValueOnce(undefined);
    const shown = { ...o, shown: { id: 'A', mounted: true } };
    await capture(() => useReorderSave(shown), client).save([]);
    expect(shown.onSaved).toHaveBeenCalledTimes(1);
  });
});

describe('새로 그린 화면은 무엇을 저장 중인지 안다 (T-215 12차 #2)', () => {
  it('양식 저장은 보낸 양식을 저장소에 두고 끝나면 뺀다 — 새로 그린 화면은 그 값을 고른 값으로 그린다', async () => {
    // 서버 렌더에서 zustand 는 처음 값을 그리므로 화면 값은 원문 대조와 Chrome(돌아온 화면의 체크 항목)이 본다
    const call = pending();
    const save = vi.fn(() => call.p);
    const done = capture(() => useTemplateSelection({ policyId: 'A', serverValue: 'old', canSave: true, save, onError: vi.fn() })).change('new');
    expect(usePolicyRunsStore.getState().targets).toEqual({ 'template:A': 'new' });
    call.settle().ok();
    await done;
    expect(usePolicyRunsStore.getState()).toMatchObject({ running: [], targets: {} });
    // '' (자동)도 보낸 값이다 — 없음과 가른다
    expect(usePolicyRunsStore.getState().start('template:B', '')).toBe(true);
    expect(usePolicyRunsStore.getState().targets).toEqual({ 'template:B': '' });
    const hook = src('apps/web/src/components/policy-detail/useTemplateSelection.ts');
    expect(hook).toContain("const pending = saving ? targetOf('template', policyId) : undefined;");
    expect(hook).toContain('selectedId: shownTemplateId(state, policyId, serverValue, pending)');
  });

  it('규정 정보를 저장하는 동안은 날짜·알림 칸을 바꾸지 못한다 — 저장이 끝나 다시 받을 때 그사이 고친 값이 말없이 덮였다', () => {
    // 칸은 펼친 뒤에만 그려져 서버 렌더로는 보지 못한다 — 원문 대조와 Chrome(돌아온 화면에서 저장 중 칸이 막힘)이 본다
    expect(src('apps/web/src/components/policy-detail/PolicyInfoEdit.tsx')).toContain('<fieldset disabled={p.saving}');
  });
});

describe('결과는 지금 그 규정을 그리는 화면의 도구 줄로 (T-215 12차 #3)', () => {
  const sink = () => ({ flash: vi.fn(), fail: vi.fn(), isSticky: () => false });
  it('시작한 화면이 내려갔어도 같은 규정을 다시 그린 화면이 있으면 그 도구 줄, 없으면 규정 이름 붙은 알림', () => {
    const away = { id: 'A', mounted: false };
    const now = sink();
    const toast = vi.fn();
    deliverResult(away, { ...sink(), toast, screenFor: (id) => (id === 'A' ? now : undefined) }, t, { startedId: 'A', label: 'A-01', message: '실패', kind: 'error' });
    expect(now.fail).toHaveBeenCalledWith('실패');
    expect(toast).not.toHaveBeenCalled();
    deliverResult(away, { ...sink(), toast, screenFor: () => undefined }, t, { startedId: 'A', label: 'A-01', message: '실패', kind: 'error' });
    expect(toast).toHaveBeenCalledWith('policyDetail.result.forPolicy', 'error');
  });

  it('화면은 그린 직후 자기 도구 줄을 그 규정에 걸고, 결과 알림은 그것을 찾는다', () => {
    expect(src('apps/web/src/pages/PolicyDetailPage.tsx')).toContain('useShownToolbar(id, toolStatus);');
    expect(src('apps/web/src/lib/policyResult.ts')).toContain('toast, screenFor: toolbarFor }');
  });
});

describe('저장소 구독·같은 실패 글 (T-215 12차 #4·#5)', () => {
  it('useRuns 는 진행 목록을 구독한다 — 한 번 읽고 말면 진행이 바뀌어도 다시 그리지 않는다', () => {
    expect(src('apps/web/src/lib/policyResult.ts')).toContain('const running = usePolicyRunsStore((s) => s.running);');
  });

  it("같은 실패 글은 한 번만 — 글에 ' / ' 가 들어 있어도, 앞 글의 조각과 같은 글은 따로 붙는다", () => {
    let msg = '';
    const setMsg = (v: string | ((cur: string) => string)) => {
      msg = typeof v === 'function' ? v(msg) : v;
    };
    const status = capture(() => useToolStatus(setMsg as never, () => undefined));
    status.fail('입력 오류 / 제목이 비었습니다');
    status.fail('입력 오류 / 제목이 비었습니다');
    expect(msg).toBe('입력 오류 / 제목이 비었습니다');
    status.fail('입력 오류');
    expect(msg).toBe('입력 오류 / 제목이 비었습니다 / 입력 오류');
    status.show('진행 중');
    status.fail('입력 오류');
    expect(msg).toBe('입력 오류');
  });
});

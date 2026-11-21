import { QueryClient } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { vi } from 'vitest';
import { useBodyWrites } from '../apps/web/src/components/policy-detail/useBodyWrites';
import { useToolStatus } from '../apps/web/src/lib/toolStatus';
import { usePolicyRunsStore } from '../apps/web/src/stores/policyRunsStore';
import { runKey } from '../apps/web/src/lib/policyResult';
import { nextDialogToken, registerWriteDialog } from '../apps/web/src/lib/writeDialogs';
import { messages } from '../apps/web/src/i18n/messages';

/**
 * T-224 단계 C 시험의 바탕 — 본문 안 쓰기 훅(useBodyWrites)을 한 번 그려 함수를 받고(도구 줄 상태는 진짜), 창·양식을 등록부에 건다. api
 * 모의는 시험 파일이 vi.mock 으로 건다(이 파일이 가져오는 api 도 그 모의를 쓴다).
 */
export const ko = messages.ko as Record<string, string>;
export const t = (k: string, v?: Record<string, string | number>) => (ko[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v?.[n] ?? `{${n}}`));
export const refused = (message: string, status = 400) => ({ response: { status, data: { message } } });
export const down = { response: { status: 502 } };
export const DRAFT = { kind: 'annex' as const, title: '별표 1', body: '표 본문', sortOrder: '' };
export const A1 = { articleId: 'a1', articleLabel: '제3조(수당)' };

/** policyId 를 undefined 로 주면 규정을 아직 받지 못한 화면, mounted false 면 시작한 화면이 내려간 뒤(다른 규정으로 옮김 — 결과는 이름 붙은 알림) */
export function setup(opts: { policyId?: string; mounted?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const setMsg = vi.fn();
  const flash = vi.fn();
  const store = usePolicyRunsStore.getState();
  const o = {
    policyId: 'policyId' in opts ? opts.policyId : 'P1',
    label: 'HR-01 취업규칙',
    qc,
    shown: { id: 'P1', mounted: opts.mounted ?? true },
    toolbar: undefined as unknown as ReturnType<typeof useToolStatus>,
    t,
    start: (k: string, p: string, target?: string) => store.start(runKey(k as never, p), target),
    end: (k: string, p: string) => store.end(runKey(k as never, p)),
  };
  let w!: ReturnType<typeof useBodyWrites>;
  const C = () => {
    o.toolbar = useToolStatus(setMsg, flash);
    w = useBodyWrites(o);
    return null;
  };
  renderToStaticMarkup(createElement(C));
  return { qc, flash, last: () => setMsg.mock.calls.at(-1)?.[0], w: () => w };
}

/** 열린 창·양식(등록부의 kind) — 닫기·실패를 본다 */
export function dialog(kind: string) {
  const token = nextDialogToken();
  const controls = { token, setError: vi.fn(), close: vi.fn() };
  return { token, controls, off: registerWriteDialog('P1', kind, controls) };
}

/** 따로 그린 도구 줄 상태(조문 배너 자리) — 남긴 줄(last)과 잠깐 보인 글(flash)을 본다 */
export function statusOf() {
  const setMsg = vi.fn();
  const flash = vi.fn();
  let status!: ReturnType<typeof useToolStatus>;
  const C = () => {
    status = useToolStatus(setMsg, flash);
    return null;
  };
  renderToStaticMarkup(createElement(C));
  return { status, flash, last: () => setMsg.mock.calls.at(-1)?.[0] };
}

import { QueryClient } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { vi } from 'vitest';
import { useVersionActions } from '../apps/web/src/components/policy-detail/useVersionActions';
import { useToolStatus } from '../apps/web/src/lib/toolStatus';
import { usePolicyRunsStore } from '../apps/web/src/stores/policyRunsStore';
import { runKey } from '../apps/web/src/lib/policyResult';
import { nextDialogToken, registerWriteDialog } from '../apps/web/src/lib/writeDialogs';
import { messages } from '../apps/web/src/i18n/messages';

/**
 * T-224 단계 B2 시험의 바탕 — 판 쓰기 훅을 한 번 그려 함수를 받고(도구 줄 상태는 진짜), 편집기를 등록부에 건다. api 모의는 시험 파일이
 * vi.mock 으로 건다(이 파일이 가져오는 api 도 그 모의를 쓴다).
 */
export const ko = messages.ko as Record<string, string>;
export const t = (k: string, v?: Record<string, string | number>) => (ko[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v?.[n] ?? `{${n}}`));
export const A1 = { articleId: 'a1', articleLabel: '제3조(수당)' };
export const refused = (message: string) => ({ response: { status: 400, data: { message } } });
export const down = { response: { status: 502 } };
/** 이 요청이 보내는 글의 초안(같은 글·같은 변경 사유) */
export const ownDraft = (id: string, versionNum: number, status = 'draft') => ({ id, versionNum, status, content: '바뀐 본문', changeNote: '사유' });
export const review = (over: Record<string, unknown> = {}) => ({ ...A1, draftId: null, content: '바뀐 본문', changeNote: '사유', token: null, ...over });

/** mounted false 면 시작한 화면이 내려간 뒤(다른 규정으로 옮김) — 결과는 '코드 제목 — 문구' 알림으로 간다 */
export function setup(opts: { mounted?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const setMsg = vi.fn();
  const flash = vi.fn();
  const store = usePolicyRunsStore.getState();
  const o = {
    policyId: 'P1',
    label: 'HR-01 취업규칙',
    qc,
    shown: { id: 'P1', mounted: opts.mounted ?? true },
    toolbar: undefined as unknown as ReturnType<typeof useToolStatus>,
    t,
    start: (k: string, p: string, target?: string) => store.start(runKey(k as never, p), target),
    end: (k: string, p: string) => store.end(runKey(k as never, p)),
  };
  let actions!: ReturnType<typeof useVersionActions>;
  const C = () => {
    o.toolbar = useToolStatus(setMsg, flash);
    actions = useVersionActions(o);
    return null;
  };
  renderToStaticMarkup(createElement(C));
  return { qc, flash, toolbar: () => o.toolbar, last: () => setMsg.mock.calls.at(-1)?.[0], actions: () => actions };
}

/** 열린 편집기(등록부의 'review') — 닫기·실패·초안 이어받기를 본다 */
export function editor() {
  const token = nextDialogToken();
  const controls = { token, setError: vi.fn(), close: vi.fn(), adopt: vi.fn() };
  return { token, controls, off: registerWriteDialog('P1', 'review', controls) };
}

/** 따로 그린 도구 줄 상태(배너 자리) */
export function statusOf() {
  const setMsg = vi.fn();
  let status!: ReturnType<typeof useToolStatus>;
  const C = () => {
    status = useToolStatus(setMsg, vi.fn());
    return null;
  };
  renderToStaticMarkup(createElement(C));
  return { status, last: () => setMsg.mock.calls.at(-1)?.[0] };
}

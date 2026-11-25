import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, vi } from 'vitest';
import type { useAttachmentActions as UseAttachmentActions } from '../apps/web/src/components/policy-detail/useAttachmentActions';
import { quiet } from './policyRefreshKit';

/**
 * T-227 — 첨부 올리기·지우기 뒤 목록 다시 받기 시험(policyDetailLeftovers·policyAttachmentLeave)이 같이 쓰는 준비. api 모의는 시험
 * 파일마다 건다(vi.mock 은 파일 단위) — 그래서 훅·진행 저장소·인증 범위는 모의를 건 뒤 불러와 넘긴다
 */
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
// t 는 키를 그대로 돌려준다 — 됐다는 말 + 규정 정보 저장과 같은 덧붙임(화면을 새로 고쳐 확인)
export const UPLOADED = 'policyDetail.files.uploaded policyDetail.result.refreshFailed';
export const DELETED = 'policyDetail.files.deleted policyDetail.result.refreshFailed';
export const notices = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.flat().filter((m) => m === UPLOADED || m === DELETED);

export type Setup = {
  listFails?: boolean;
  watched?: boolean;
  endScope?: boolean;
  modalOpen?: boolean;
  earlierError?: boolean;
  retry?: number;
  retryDelay?: number;
  /** 목록 값이 없는 채로 시작한다(첫 목록 받기가 화면을 붙일 때 나간다) */
  noData?: boolean;
  /** 목록 받기마다 차례로 쓸 응답 */
  lists?: (() => Promise<unknown>)[];
};
type Deps = { useAttachmentActions: typeof UseAttachmentActions; running: () => readonly string[]; endAuthScope: () => void };

/** 규정 A 의 첨부 동작과 그 목록을 보는 화면을 차린다 */
export function attachmentSetup(d: Deps) {
  return async (o: Setup) => {
    const client = quiet();
    if (!o.noData) client.setQueryData(['files', 'A'], [{ id: 'f-1' }]);
    if (o.earlierError) await client.prefetchQuery({ queryKey: ['files', 'A'], queryFn: () => Promise.reject(new Error('earlier')) });
    const list = vi.fn(() => {
      if (o.endScope) d.endAuthScope();
      const next = o.lists?.shift();
      if (next) return next();
      return o.listFails ? Promise.reject(new Error('down')) : Promise.resolve([]);
    });
    // 첨부 목록 — 규정 상세가 떠 있는 동안 화면이 본다(머리말의 첨부 수·첨부 창). 떠났으면 보는 화면이 없다. 받기 함수는 앱처럼 감싼다
    // (받기 문맥을 넘기지 않게 — policyRefreshKit.screen 주석)
    const observer = new QueryObserver(client, { queryKey: ['files', 'A'], queryFn: () => list(), staleTime: Infinity, retry: o.retry ?? false, retryDelay: o.retryDelay ?? 5 });
    const unsubscribe = o.watched === false ? () => undefined : observer.subscribe(() => undefined);
    const setError = vi.fn();
    const report = vi.fn();
    const shown = { id: 'A', mounted: true };
    const actions = capture(() => d.useAttachmentActions({ id: 'A', label: 'A-01', modalOpen: o.modalOpen ?? true, shown, report, setError, t }), client);
    const finished = async () => {
      await vi.waitFor(() => expect(d.running()).toEqual([]));
      unsubscribe();
    };
    return { client, observer, unsubscribe, list, setError, report, actions, finished };
  };
}

/** 다음에 그 규정을 보는 화면 — 앱처럼 staleTime 이 있어도 무효로 표시된 목록이면 붙을 때 다시 받는다(진행 중이면 합류한다) */
export const revisit = (s: { client: QueryClient; list: () => Promise<unknown> }) =>
  new QueryObserver(s.client, { queryKey: ['files', 'A'], queryFn: () => s.list(), staleTime: Infinity }).subscribe(() => undefined);

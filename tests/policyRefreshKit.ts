import { QueryClient, QueryObserver } from '@tanstack/react-query';

/**
 * T-227 시험들이 같이 쓰는 도구 — 끝난 뒤 다시 받기(policyRefreshOverlap·policyRefreshFirstFetch)와 첨부 목록 다시 받기
 * (attachmentKit·policyDetailLeftovers·policyAttachmentLeave)
 */
export const quiet = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
export const deferred = () => {
  let resolve: (v: unknown) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
};
export const never = () => new Promise(() => undefined);
export const flush = () => new Promise((r) => setTimeout(r, 0));
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 정한 시간 안에 끝나지 않으면 'hang' — 붙잡힌 받기가 시험 시간 초과 대신 바로 드러나게 */
export const within = (p: Promise<unknown>, ms = 300) => Promise.race([p, new Promise((r) => setTimeout(() => r('hang'), ms))]);
export const always = () => true;
export const KEY = ['policy', 'A'];
export const refetch = (client: QueryClient) => void client.refetchQueries({ queryKey: KEY, exact: true });
export const before = { chapters: ['before'] };
export const ours = { chapters: ['ours'] };
export const newest = { chapters: ['newest'] };

/**
 * 화면 조회 — 재시도 1번(앱 기본값과 같은 수), 대기는 짧게. 받기 함수는 앱처럼 화살표로 감싸 받기 문맥(signal)을 넘기지 않는다 —
 * TanStack 은 화면이 내려갈 때 signal 을 읽은 받기와 값 없이 멈춘 첫 받기는 되돌려 끊고, 그 밖에는 남은 재시도만 거두므로
 * (query.js removeObserver) 그 길을 앱과 같게 둔다
 */
export const screen = (client: QueryClient, queryFn: () => Promise<unknown>, extra: { staleTime?: number; retryDelay?: number } = {}) =>
  new QueryObserver(client, { queryKey: KEY, queryFn: () => queryFn(), retry: 1, retryDelay: 20, ...extra });

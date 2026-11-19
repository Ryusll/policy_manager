import type { LawSearchItem, LawSearchResult } from '../api/lawgokr';
import { apiErrorMessage } from './apiError';

/**
 * 법제처 법령 검색 화면(법령 등록 창의 '더 보기', 규정 가져오기의 '법제처에서 가져오기' 탭)이 쓰는 계산 (T-210, SRS LAW-28).
 *
 * 화면 밖 순수 함수로 둔 이유: "결과가 한 쪽을 넘는데 다음 쪽을 못 본다"가 이번 결함이었다 — 멈추는 조건과 잇는 규칙,
 * 실패했을 때 무엇을 하라고 할지를 시험으로 묶어 둔다.
 */

/** 한 번에 청하는 건수 — 서버(법제처) 상한. 흔한 검색은 한 번에 다 온다("상법" 56건) */
export const LAW_SEARCH_PAGE_SIZE = 100;

/** 검색어 길이 상한 — 서버(`lawgokr-search-rank.ts` 의 LAW_SEARCH_QUERY_MAX)와 같은 값. 입력 칸이 그보다 받지 않는다 */
export const LAW_SEARCH_QUERY_MAX = 200;

/** 다음에 받을 쪽 번호. 더 없으면 undefined */
export function nextSearchPage(last: LawSearchResult): number | undefined {
  // 빈 쪽이 왔으면 총건수와 상관없이 끝이다(받는 사이 결과가 줄었거나, 줄 세운 목록의 끝을 넘겼다)
  if (last.items.length === 0) return undefined;
  return last.page * last.display < last.total ? last.page + 1 : undefined;
}

const failureOf = (err: unknown) => (err as { response?: { status?: number; data?: { code?: unknown } } } | null)?.response;
/** 요청이 틀린 실패 — 다시 보내도 같다. 408(시간 초과)·429(요청이 잠시 많음)는 잠시 뒤면 풀리므로 빼 둔다 */
const isRequestError = (status: number | undefined) => !!status && status >= 400 && status < 500 && status !== 408 && status !== 429;

/**
 * 검색 실패 줄에 무엇을 보일지 — 사용자가 할 일은 실패의 갈래마다 다르다.
 * - 법제처 연결이 막혔다(code `LAWGOKR_*`, 또는 503): 서버 문구는 운영자용(인증값·서버 IP 확인)이라 고객용 문구로 바꾸고 문의하게 한다
 * - 요청이 틀렸다(4xx): 서버 문구가 고칠 것을 말한다 — 다시 누르라고 하지 않는다(다시 보내도 같다)
 * - 그 밖(502·연결 끊김): 서버 문구 뒤에 다시 누르라고 한다 — 다음 쪽만 실패했으면 '더 보기'를
 */
export function searchFailureView(err: unknown, nextPageFailed: boolean): { messageKey: string | null; hintKey: string | null } {
  const res = failureOf(err);
  const code = res?.data?.code;
  // 503 도 함께 본다 — code 를 붙이기 전 서버와 섞여 도는 동안에도 같은 안내가 나가게
  if (code === 'LAWGOKR_AUTH' || code === 'LAWGOKR_NOT_CONFIGURED' || res?.status === 503) {
    return { messageKey: 'lawSearch.blocked', hintKey: 'lawSearch.contact' };
  }
  // 요청이 잠시 많았다(429) — 서버 문구는 기술 문구라 고객용 문구로, 잠시 뒤 다시 누르게 한다
  if (res?.status === 429) return { messageKey: 'lawSearch.busy', hintKey: 'lawSearch.retry' };
  if (isRequestError(res?.status)) return { messageKey: null, hintKey: null };
  return { messageKey: null, hintKey: nextPageFailed ? 'lawSearch.moreRetry' : 'lawSearch.retry' };
}

/** 검색 실패 줄의 글. 문구는 `t` 로 */
export function searchFailureText(err: unknown, nextPageFailed: boolean, t: (key: string) => string): string {
  const { messageKey, hintKey } = searchFailureView(err, nextPageFailed);
  const message = messageKey ? t(messageKey) : apiErrorMessage(err, t('lawSearch.failed'));
  return hintKey ? `${message} ${t(hintKey)}` : message;
}

/**
 * 검색 재시도 — 요청이 틀린 실패(4xx)는 다시 보내도 같으니 보내지 않는다. 그 밖은 앱 기본값처럼 한 번.
 * 오류 인자를 `Error` 로 두는 것은 쿼리의 오류 타입 추론을 지키려고다(`unknown` 이면 쿼리 오류도 `unknown` 이 된다)
 */
export function retrySearch(failureCount: number, err: Error): boolean {
  const status = failureOf(err)?.status;
  // 429 는 곧바로 다시 보내도 또 막힌다 — 안내대로 잠시 뒤 사용자가 다시 누른다
  if (isRequestError(status) || status === 429) return false;
  return failureCount < 1;
}

/** 받은 쪽들을 한 목록으로 잇는다. 쪽 사이에 겹친 법령(MST)은 먼저 온 것만 남긴다 */
export function mergeSearchPages(pages: LawSearchResult[] | undefined): {
  items: LawSearchItem[];
  total: number;
  /** true 맞는 순 · false 결과가 많아 가나다순 · undefined 해당 없음 */
  ranked: boolean | undefined;
} {
  const seen = new Set<string>();
  const items: LawSearchItem[] = [];
  for (const item of (pages ?? []).flatMap((page) => page.items)) {
    if (seen.has(item.mst)) continue;
    seen.add(item.mst);
    items.push(item);
  }
  return { items, total: pages?.[0]?.total ?? 0, ranked: pages?.[0]?.ranked };
}

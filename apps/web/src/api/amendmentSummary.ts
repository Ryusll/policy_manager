import type { QueryClient } from '@tanstack/react-query';
import client from './client';

/**
 * 대시보드 법령 개정 배너(T-158) — `GET /amendments/summary`. 관리자·편집자만 부른다(열람자는 403). 메뉴 배지는 목록의 건수(pendingCount).
 * 쿼리 키가 'amendments' 로 시작해, 승인·반려·검토 요청이 개정 후보 목록을 무효화할 때 함께 다시 읽힌다.
 */
export type AmendmentSummaryLine = {
  lawId: string;
  /** 줄에 보일 이름 — 약칭이 있으면 약칭 */
  lawName: string;
  lawFullName: string;
  version: { lawType: string | null; promulgationNo: string | null; revisionType: string | null } | null;
  /** 법령 시행일(YYYY-MM-DD) */
  effectiveDate: string;
  /** 우리 조문 수 — 확정 연결이 닿는 조문과 그 줄의 처리 대기 후보 조문의 합집합 */
  articles: number;
  /** 처리 대기 후보 수 */
  pending: number;
};

export type AmendmentSummary = {
  /** 처리 대기 후보 모두 — 개정 검토 기본 목록의 건수 */
  pending: number;
  /** 법령 시행일이 오늘이거나 지났는데 처리하지 않은 후보 */
  overdue: number;
  /** 법령 시행일이 없는 처리 대기 후보 */
  undated: number;
  upcoming: AmendmentSummaryLine[];
  /** 보인 줄 밖에 남은 시행 예정 개정 수 */
  more: number;
};

export const AMENDMENT_SUMMARY_KEY = ['amendments', 'summary'] as const;
/** 메뉴 배지 — 개정 검토 기본 목록의 건수만(요약 전체는 대시보드에서만 계산한다) */
export const AMENDMENT_PENDING_KEY = ['amendments', 'pending-count'] as const;

export const amendmentSummaryApi = {
  get: () => client.get<AmendmentSummary>('/amendments/summary').then((r) => r.data),
  /** 처리 대기 후보 수 = 개정 검토 화면 기본 목록(state=open)의 total — 같은 조회라 숫자가 갈라지지 않는다 */
  pendingCount: () => client.get<{ total: number }>('/amendments', { params: { state: 'open', page: 1, limit: 1 } }).then((r) => r.data.total),
};

/**
 * 후보가 생기거나 바뀔 수 있는 동작 뒤에 — 연결 확정(창 안 변경으로 후보가 생긴다, T-149)·연결 수정·삭제·후보 만들기.
 * 'amendments' 로 시작하는 쿼리(목록·배너·배지)를 함께 다시 읽게 한다
 */
export function invalidateAmendmentCounts(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: ['amendments'] });
}

/**
 * 목록(기본 조건)이나 배너가 처리 대기 수를 새로 받으면 배지도 같은 값으로 — 동기화 자동 생성·다른 사람의 처리처럼 이 화면 밖의 변화가
 * 배지에 늦게 오지 않게. 배지가 더 새 값이면 두지 않는다(화면이 열리며 캐시의 옛 값을 다시 넣지 않게), 시각은 원래 값의 것으로
 */
export function syncPendingBadge(qc: QueryClient, total: number, updatedAt: number) {
  const badge = qc.getQueryState(AMENDMENT_PENDING_KEY);
  if (badge && badge.dataUpdatedAt >= updatedAt) return;
  qc.setQueryData(AMENDMENT_PENDING_KEY, total, { updatedAt });
}

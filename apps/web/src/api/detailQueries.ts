import { lawsApi } from './laws';
import { amendmentsApi } from './amendments';

/*
 * 상세 화면의 조회 — 상세 화면과 경로 표시(components/Breadcrumbs, T-212)가 같은 키·같은 함수로 읽는다.
 * 경로 표시는 이 결과를 읽기만 한다(enabled: false). 키가 갈라지면 요청도 오류도 없이 경로 표시가 '상세'로 남으니
 * 두 곳 모두 이 함수를 쓴다(tests/routeSections.test.ts 가 원문으로 확인한다).
 */

/** 법령 상세(`/laws/:id`) */
export const lawDetailQuery = (id: string) => ({ queryKey: ['laws', id] as const, queryFn: () => lawsApi.get(id) });

/** 개정 후보 상세(`/amendments/:id`) */
export const amendmentDetailQuery = (id: string) => ({
  queryKey: ['amendment', id] as const,
  queryFn: () => amendmentsApi.get(id),
});

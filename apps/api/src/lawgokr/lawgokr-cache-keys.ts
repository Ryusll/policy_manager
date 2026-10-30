import { EFFECTIVE_NOTES_VERSION } from '../common/effective-notes';

/**
 * 법제처 응답 캐시 키 — 서비스와 시험이 같은 함수를 쓴다(통합 시험은 이 키로 가짜 응답을 캐시에 심어 법제처 없이 돈다, T-151).
 */

/**
 * 법령 본문 매핑 결과. v2 — 트리 노드에 조별 시행일 표기가 붙었다(T-144). 표기 읽기 규칙의 판(`n1`)도 넣는다 —
 * 규칙을 고쳐 판을 올리면 옛 규칙으로 매핑한 캐시(최대 하루)를 읽어 새 판 번호로 찍는 일이 없게.
 * v3 — 법령ID 가 빠진 본문은 캐시하지 않는다(T-151). v2 에 들어 있던 그런 값을 배포 뒤 하루 동안 읽어 등록이 502 를 되풀이하지 않게
 */
export const lawDetailCacheKey = (mst: string) => `lawgokr:law:v3:n${EFFECTIVE_NOTES_VERSION}:${mst}`;

/** 현행 법령 목록 검색(`target=law`) */
export const lawSearchCacheKey = (o: { scope: number; sort: string; display: number; page: number; query: string }) =>
  `lawgokr:search:${o.scope}:${o.sort}:${o.display}:${o.page}:${o.query}`;

/**
 * 판 목록 한 쪽 — 시행일법령 목록(`target=eflaw`)을 **법령ID 로**(`LID`) 공포일 내림차순 100건씩. 날짜를 넣지 않아 시험이 키를
 * 계산할 수 있다. 법령명이 아니라 법령ID 로 받으므로 제명이 바뀐 판도 빠지지 않는다(T-151 검토)
 */
export const VERSION_LIST_PAGE_SIZE = 100;
// v3 — nw=1,2,3 을 붙였다. v2 에 든 '현행만 준' 목록(최대 캐시 기간)을 배포 뒤에 읽어 판 반영이 실패하지 않게
export const lawVersionListCacheKey = (lawId: string, page: number) =>
  `lawgokr:eflaw:v3:lid:${lawId}:ddes:${VERSION_LIST_PAGE_SIZE}:${page}`;

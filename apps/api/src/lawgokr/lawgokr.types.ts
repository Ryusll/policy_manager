/**
 * 법제처 국가법령정보 공동활용(open.law.go.kr) DRF API 응답 타입.
 *
 * 필드명이 전부 한글인 것은 오타가 아니라 실제 응답 그대로다. 규격 출처:
 * - 목록: https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsNwListGuide
 * - 본문: https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsNwInfoGuide
 *
 * 실제 응답에서 확인된 "문서에 없는" 사실들 — 매퍼가 이걸 전제로 짜여 있다:
 * - `항`은 1건이면 객체, 여러 건이면 배열로 온다. `호`·`목`도 같은 규칙을 따른다.
 * - `조문단위`에는 조문뿐 아니라 편/장/절 제목 행도 섞여 있다(`조문여부: '전문'`).
 * - 편/장/절 행의 `조문번호`는 그 장의 첫 조 번호이지 장 번호가 아니다. 장 번호는
 *   `조문내용`("제1장 총칙 <개정 2009.2.6>")을 파싱해야 나온다.
 * - `조문내용`·`항내용`·`호내용`·`목내용`은 자기 번호를 접두어로 포함하고 있고,
 *   앞쪽에 정렬용 공백이 여러 칸 붙어 온다.
 */

/** 한 건이면 객체, 여러 건이면 배열 — 응답 전반에 걸친 패턴 */
export type OneOrMany<T> = T | T[];

/** 값이 문자열일 수도, `{ content, ...코드 }` 객체일 수도 있는 필드(소관부처·법종구분 등) */
export type LawGoKrTextOrNode = string | { content?: string; [key: string]: unknown };

export interface LawGoKrMok {
  목번호?: string;
  목내용?: string;
}

export interface LawGoKrHo {
  호번호?: string;
  호가지번호?: string;
  호내용?: string;
  목?: OneOrMany<LawGoKrMok>;
}

export interface LawGoKrHang {
  항번호?: string;
  항내용?: string;
  항제개정유형?: string;
  항제개정일자문자열?: string;
  호?: OneOrMany<LawGoKrHo>;
}

export interface LawGoKrJoUnit {
  조문번호?: string;
  조문가지번호?: string;
  /** '조문' = 실제 조, '전문' = 편/장/절 제목 행 */
  조문여부?: string;
  조문제목?: string;
  조문내용?: string;
  조문시행일자?: string;
  조문변경여부?: string;
  조문참고자료?: string;
  조문키?: string;
  항?: OneOrMany<LawGoKrHang>;
}

export interface LawGoKrBasicInfo {
  법령명_한글?: string;
  법령명_한자?: string;
  법령명약칭?: string;
  법령ID?: string;
  공포일자?: string;
  공포번호?: string;
  시행일자?: string;
  제개정구분?: string;
  소관부처?: LawGoKrTextOrNode;
  법종구분?: LawGoKrTextOrNode;
  [key: string]: unknown;
}

/** `lawService.do?target=law&type=JSON` 응답 본체 */
export interface LawGoKrLawDetail {
  법령키?: string;
  기본정보?: LawGoKrBasicInfo;
  조문?: { 조문단위?: OneOrMany<LawGoKrJoUnit> };
  /** 줄 단위 문자열의 2중 배열로 온다 */
  개정문?: { 개정문내용?: string[][] };
  제개정이유?: { 제개정이유내용?: string[][] };
}

export interface LawGoKrLawServiceResponse {
  법령?: LawGoKrLawDetail;
}

/** `lawSearch.do?target=law&type=JSON` 목록 항목 */
export interface LawGoKrSearchItem {
  id?: string;
  법령일련번호?: string;
  법령ID?: string;
  법령명한글?: string;
  법령약칭명?: string;
  법령구분명?: string;
  현행연혁코드?: string;
  공포일자?: string;
  공포번호?: string;
  제개정구분명?: string;
  소관부처명?: string;
  시행일자?: string;
  법령상세링크?: string;
}

export interface LawGoKrSearchResponse {
  LawSearch?: {
    totalCnt?: string | number;
    page?: string | number;
    law?: OneOrMany<LawGoKrSearchItem>;
  };
}

// ─────────────────────────────────────────────────────────────
// 우리 쪽으로 정규화한 형태 (컨트롤러가 프론트에 내보내는 계약)
// ─────────────────────────────────────────────────────────────

/** 검색 결과 1건. `mst`가 본문 조회 키다. */
export interface LawSearchResultItem {
  /** 법령일련번호(MST) — 본문 조회에 쓰는 값 */
  mst: string;
  /** 법령ID — MST와 다르다. 이력 추적용 */
  lawId: string;
  title: string;
  shortTitle: string | null;
  /** '법률' · '대통령령' · '부령' 등 */
  lawType: string | null;
  /** '제정' · '일부개정' 등 */
  revisionType: string | null;
  ministry: string | null;
  /** YYYY-MM-DD */
  promulgationDate: string | null;
  promulgationNo: string | null;
  /** YYYY-MM-DD */
  effectiveDate: string | null;
  /** '현행' · '연혁' */
  status: string | null;
}

export interface LawSearchResult {
  total: number;
  page: number;
  display: number;
  items: LawSearchResultItem[];
}

/** 본문 조회 결과의 메타(법령 서지사항) */
export interface LawDetailMeta {
  mst: string;
  lawId: string | null;
  title: string;
  shortTitle: string | null;
  lawType: string | null;
  revisionType: string | null;
  ministry: string | null;
  promulgationDate: string | null;
  promulgationNo: string | null;
  effectiveDate: string | null;
  /** 제개정이유 본문. 우리 `PolicyRevisionReason`에 그대로 넣을 수 있는 평문 */
  revisionReason: string | null;
  /** 개정문 본문 */
  amendmentText: string | null;
  /** 국가법령정보센터 원문 링크 */
  sourceUrl: string;
}

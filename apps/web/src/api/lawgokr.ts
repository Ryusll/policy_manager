import client from './client';

/**
 * 법제처 국가법령정보 공동활용 OPEN API 프록시 (T-53) 클라이언트.
 *
 * 인증값(OC)은 서버에만 있고 브라우저로 내려오지 않는다. 이 화면은 서버 프록시만 호출한다.
 */

/** 검색 결과 1건. `mst`가 본문 조회·세션 생성 키다(법령ID와 다르다). */
export type LawSearchItem = {
  mst: string;
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
};

export type LawSearchResult = {
  /** 전체 건수 — 줄 세운 결과(`ranked: true`)면 줄 세운 건수, 그 밖에는 법제처 총건수 */
  total: number;
  page: number;
  display: number;
  items: LawSearchItem[];
  /**
   * 법령명 검색에만 실린다(T-210, LAW-28). true — 검색어와 맞는 순으로 줄 세웠다.
   * false — 결과가 너무 많아 법제처 순서(가나다) 그대로다. 이때는 검색어를 좁히라고 알린다.
   */
  ranked?: boolean;
};

/** 법제처 세션의 `extractMeta`에 실려 오는 서지사항 */
export type LawGoKrSessionMeta = {
  source?: string;
  mst?: string;
  lawId?: string | null;
  title?: string;
  lawType?: string | null;
  revisionType?: string | null;
  ministry?: string | null;
  promulgationDate?: string | null;
  effectiveDate?: string | null;
  sourceUrl?: string;
  revisionReason?: string | null;
};

export const lawGoKrApi = {
  /** 인증값 설정 여부만 돌려준다(값은 노출하지 않는다) */
  status: (): Promise<{ configured: boolean }> =>
    client.get('/lawgokr/status').then((r) => r.data),

  search: (params: {
    q: string;
    page?: number;
    display?: number;
    scope?: 'title' | 'fulltext';
  }): Promise<LawSearchResult> => client.get('/lawgokr/search', { params }).then((r) => r.data),
};

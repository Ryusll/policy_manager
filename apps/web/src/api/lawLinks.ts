import client from './client';

/**
 * 법령 관계 정보 (T-101). 테넌트별 — `LawLink`가 tenantId를 갖는다(ADR-0020).
 */
export type LawRelationType = 'delegation' | 'application' | 'citation' | 'obligation' | 'reference';
export type ConfirmState = 'suggested' | 'confirmed' | 'rejected';

export const RELATION_TYPE_LABEL: Record<LawRelationType, string> = {
  delegation: '위임',
  application: '준용',
  citation: '인용',
  obligation: '의무',
  reference: '참고',
};

/** 근거 문구의 출처 버전(T-177) — 연결할 때(근거 문구를 고칠 때) 근거 문구를 담고 있던 버전. 본문은 싣지 않는다 */
export type EvidenceVersionSummary = {
  id: string;
  versionNum: number;
  status: 'draft' | 'review' | 'published' | 'archived';
  /** YYYY-MM-DD */
  effectiveDate: string | null;
};

export type LawLink = {
  id: string;
  tenantId: string;
  lawArticleId: string;
  articleId: string;
  relationType: LawRelationType;
  scope: string | null;
  evidenceText: string | null;
  /** 근거 문구를 본문에 담고 있던 버전(T-177) — 서버가 찾아 남긴다. 어느 버전 본문에도 없었으면 null */
  evidenceVersionId: string | null;
  /** 근거 문구를 본문에서 찾았는가(T-177) — 출처 버전이 그 뒤 지워져도 남는다. 본문 밖 문구(메모 인용·직접 쓴 설명)는 false */
  evidenceFromBody: boolean;
  /** 목록 조회에만 실린다 */
  evidenceVersion?: EvidenceVersionSummary | null;
  /**
   * 조문의 오늘 시행 버전(오늘 폐지 상태면 null)과, 근거 문구가 그 본문에 있는가 — 없으면(false) 화면이 알린다(T-177). 본문에서 찾은
   * 근거가 아니면(본문 밖·짧은 문구) null. 목록 조회에만 실린다
   */
  articleCurrentVersion?: { id: string; versionNum: number; hasEvidence: boolean | null } | null;
  confidence: number | null;
  confirmState: ConfirmState;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** byArticle 조회에만 실린다 */
  lawArticle?: {
    id: string;
    label: string;
    title: string | null;
    /** 법령에서 사라진 조항(T-124) — 걸어 둔 연결은 남는다 */
    deletedAt?: string | null;
    law: { id: string; lawName: string };
  };
  /** byLawArticle 조회에만 실린다 */
  article?: { id: string; title: string; number: number; clauseNumber: number | null; itemNumber: number | null };
};

export const lawLinksApi = {
  byArticle: (articleId: string): Promise<LawLink[]> =>
    client.get('/law-links', { params: { articleId } }).then((r) => r.data),
  byLawArticle: (lawArticleId: string): Promise<LawLink[]> =>
    client.get('/law-links', { params: { lawArticleId } }).then((r) => r.data),
  create: (dto: {
    lawArticleId: string;
    articleId: string;
    relationType: LawRelationType;
    scope?: string;
    evidenceText?: string;
  }): Promise<LawLink> => client.post('/law-links', dto).then((r) => r.data),
  update: (
    id: string,
    dto: Partial<{
      relationType: LawRelationType;
      scope: string;
      evidenceText: string;
      confirmState: 'confirmed' | 'rejected';
    }>,
  ): Promise<LawLink> => client.patch(`/law-links/${id}`, dto).then((r) => r.data),
  remove: (id: string): Promise<{ ok: true }> => client.delete(`/law-links/${id}`).then((r) => r.data),
  suggest: (articleId: string): Promise<{ created: LawLink[]; scanned: number }> =>
    client.post('/law-links/suggest', { articleId }).then((r) => r.data),
};

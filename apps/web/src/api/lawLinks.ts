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

export type LawLink = {
  id: string;
  tenantId: string;
  lawArticleId: string;
  articleId: string;
  relationType: LawRelationType;
  scope: string | null;
  evidenceText: string | null;
  confidence: number | null;
  confirmState: ConfirmState;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** byArticle 조회에만 실린다 */
  lawArticle?: { id: string; label: string; title: string | null; law: { id: string; lawName: string } };
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

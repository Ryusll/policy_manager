import client from './client';

/**
 * 법령 (T-100). 테넌트 공용 — 등록된 법령은 모든 회사가 같이 본다(ADR-0020).
 */
export type Law = {
  id: string;
  sourceId: string;
  externalId: string;
  externalLawId: string | null;
  lawName: string;
  lawNo: string | null;
  lawType: string | null;
  ministry: string | null;
  promulgatedDate: string | null;
  effectiveDate: string | null;
  versionKey: string | null;
  lastCheckedAt: string | null;
  sourceUrl: string | null;
  articleCount: number;
  source?: { code: string; name: string };
};

export type LawArticle = {
  id: string;
  lawId: string;
  nodeKey: string;
  articleNo: number;
  clauseNo: number | null;
  itemNo: number | null;
  label: string;
  title: string | null;
  content: string;
  versionKey: string;
  effectiveDate: string | null;
  sortOrder: number;
};

export const lawsApi = {
  list: (): Promise<Law[]> => client.get('/laws').then((r) => r.data),
  get: (id: string): Promise<Law> => client.get(`/laws/${id}`).then((r) => r.data),
  articles: (id: string): Promise<LawArticle[]> => client.get(`/laws/${id}/articles`).then((r) => r.data),
  register: (mst: string, sourceCode?: string): Promise<Law> =>
    client.post('/laws', { mst, ...(sourceCode ? { sourceCode } : {}) }).then((r) => r.data),
  remove: (id: string): Promise<{ ok: true }> => client.delete(`/laws/${id}`).then((r) => r.data),
};

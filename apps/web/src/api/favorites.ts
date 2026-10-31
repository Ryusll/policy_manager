import client from './client';

/** 즐겨찾기 (T-80). 조문 즐겨찾기는 규정 정보도 함께 온다. */
export type Favorite = {
  id: string;
  policyId: string;
  articleId: string | null;
  createdAt: string;
  policy: { id: string; code: string; title: string; isActive: boolean };
  article: {
    id: string;
    number: number;
    clauseNumber: number | null;
    itemNumber: number | null;
    title: string;
  } | null;
};

export const favoritesApi = {
  list: (): Promise<Favorite[]> => client.get('/favorites').then((r) => r.data),
  lookup: (policyId: string, articleId?: string | null): Promise<{ id: string } | null> =>
    client
      .get('/favorites/lookup', { params: { policyId, ...(articleId ? { articleId } : {}) } })
      .then((r) => r.data),
  add: (policyId: string, articleId?: string | null): Promise<{ id: string }> =>
    client.post('/favorites', { policyId, ...(articleId ? { articleId } : {}) }).then((r) => r.data),
  remove: (id: string): Promise<void> => client.delete('/favorites/' + id).then(() => undefined),
};

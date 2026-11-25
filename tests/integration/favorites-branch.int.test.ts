import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * T-211 즐겨찾기 목록(GET /favorites)의 조문에 가지 번호가 온다.
 * 예전에는 가지 번호를 읽지 않아, 제3조의2 즐겨찾기가 '제3조(정의)'로 보이고 다른 조(#제3조)로 이동했다.
 */
describe('T-211 즐겨찾기 목록의 가지 조문', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('fav-branch');
    const set = await createPolicyWithArticle(t.token, `FAV-${Date.now().toString(36)}`, '즐겨찾기규정');
    const branch = await api(`/policies/${set.policy.id}/chapters/${set.chapter.id}/articles`, {
      method: 'POST',
      token: t.token,
      json: { number: 3, branchNumber: 2, title: '정의', content: '가지 조문 본문' },
    });
    expect(branch.status, JSON.stringify(branch.body)).toBeLessThan(300);
    for (const articleId of [set.article.id, branch.body.id]) {
      const r = await api('/favorites', { method: 'POST', token: t.token, json: { policyId: set.policy.id, articleId } });
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    }
  }, 60_000);

  it('조문마다 가지 번호가 온다 — 가지 조문이 아니면 null', async () => {
    const r = await api('/favorites', { token: t.token });
    expect(r.status).toBe(200);
    const rows = (r.body as any[])
      .map((f) => [f.article?.number, f.article?.branchNumber, f.article?.title])
      .sort((a, b) => a[0] - b[0]);
    expect(rows).toEqual([
      [1, null, '목적'],
      [3, 2, '정의'],
    ]);
  });
});

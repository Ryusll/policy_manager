import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * T-211 통합검색 자동완성(GET /search/suggest)의 조문 행 — 항·목 행에 번호를 실어 화면이 '제2조 ② 부제'로 적게 한다.
 * 예전 응답에는 항·목 번호가 없어, 항의 부제가 조 제목처럼 '제2조(지급 기준)'으로 보였다.
 */
describe('T-211 검색 자동완성의 조문 행', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let other: Awaited<ReturnType<typeof createTenant>>;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('suggest');
    other = await createTenant('suggest-other');
    const set = await createPolicyWithArticle(t.token, `SUG-${Date.now().toString(36)}`, '자동완성규정');
    const add = async (json: Record<string, unknown>) => {
      const r = await api(`/policies/${set.policy.id}/chapters/${set.chapter.id}/articles`, { method: 'POST', token: t.token, json });
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    };
    // 항을 먼저 만들고 조 머리 행을 뒤에 만든다 — 응답은 만든 순서와 상관없이 조 → 항 순이어야 한다
    await add({ number: 2, clauseNumber: 2, title: '지급 기준', content: '기준은 따로 정한다.' });
    await add({ number: 2, title: '지급', content: '수당을 지급한다.' });
  }, 60_000);

  it('조 머리 행은 항·목 번호가 null, 항 행은 번호가 온다 — 조 → 항 순', async () => {
    const r = await api(`/search/suggest?q=${encodeURIComponent('지급')}`, { token: t.token });
    expect(r.status).toBe(200);
    expect(r.body.articles.map((a: any) => [a.number, a.branchNumber, a.clauseNumber, a.itemNumber, a.title])).toEqual([
      [2, null, null, null, '지급'],
      [2, null, 2, null, '지급 기준'],
    ]);
  });

  it('다른 회사의 조문은 나오지 않는다', async () => {
    const r = await api(`/search/suggest?q=${encodeURIComponent('지급')}`, { token: other.token });
    expect(r.status).toBe(200);
    expect(r.body.articles).toEqual([]);
  });
});

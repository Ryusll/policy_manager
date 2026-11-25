import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';

/**
 * T-132 ⑤ 대시보드 "제·개정 예고"의 시행 예정 조문 개정 — GET /policies/scheduled-changes.
 * 예고는 규정 시행일만 봐서, 조문 개정을 미래 시행일로 승인해도 나오지 않았다.
 */
describe('T-132 ⑤ 시행 예정 개정 목록', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let policyId = '';

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('sched');
    const set = await createPolicyWithArticle(t.token, `SCH-${Date.now().toString(36)}`, '예고규정');
    policyId = set.policy.id;
    const add = async (number: number, title: string) =>
      (await api(`/policies/${policyId}/chapters/${set.chapter.id}/articles`, { method: 'POST', token: t.token, json: { number, title, content: `${title} 본문` } })).body;
    const a2 = await add(2, '수당');
    const a3 = await add(3, '휴가');
    await api(`/policies/${policyId}/publish-drafts`, { method: 'POST', token: t.token, json: { changeNote: '제정', effectiveDate: '2024-01-01' } });
    for (const [a, date] of [[a2, '2099-02-01'], [a3, '2099-02-01'], [set.article, '2099-05-01']] as const) {
      const d = await api(`/articles/${a.id}/versions`, { method: 'POST', token: t.token, json: { content: `${a.title} 개정` } });
      await api(`/versions/${d.body.id}/submit`, { method: 'POST', token: t.token });
      const r = await api(`/versions/${d.body.id}/approve`, { method: 'POST', token: t.token, json: { changeNote: '개정', effectiveDate: date } });
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    }
  }, 60_000);

  it('규정·시행일별로 묶어 가까운 순 — 열람자도 본다, 다른 회사 것은 없다', async () => {
    const expected = [
      expect.objectContaining({ policyId, title: '예고규정', effectiveDate: '2099-02-01', articleCount: 2, firstArticle: '제2조(수당)' }),
      expect.objectContaining({ policyId, effectiveDate: '2099-05-01', articleCount: 1 }),
    ];
    const r = await api('/policies/scheduled-changes', { token: t.token });
    expect(r.status).toBe(200);
    expect(r.body).toEqual(expected);
    const email = `viewer-${t.slug}@example.test`;
    await api('/users', { method: 'POST', token: t.token, json: { email, password: t.password, name: 'v', role: 'viewer' } });
    const viewer = (await login(email, t.password, t.slug)).body.accessToken;
    expect((await api('/policies/scheduled-changes', { token: viewer })).body).toEqual(expected);
    const other = await createTenant('sched-other');
    expect((await api('/policies/scheduled-changes', { token: other.token })).body).toEqual([]);
  });

  it('limit 으로 자른다', async () => {
    const r = await api('/policies/scheduled-changes?limit=1', { token: t.token });
    expect(r.body).toHaveLength(1);
    expect(r.body[0].effectiveDate).toBe('2099-02-01');
  });
});

/**
 * T-211 시행 예정 목록의 첫 조문 표기 — 조 머리 행이면 '제N조(제목)', 항 행이면 위치까지 '제N조제M항(부제)'.
 * 예전에는 항·목 번호를 읽지 않아 항의 부제가 조 제목 자리에 들어갔고('제4조(특례)'), 같은 날 묶음에서 어느 행이
 * 첫 줄이 될지도 조 번호만 봐서 정해지지 않았다.
 */
describe('T-211 시행 예정 목록의 첫 조문 표기', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let policyId = '';

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('sched-hang');
    const set = await createPolicyWithArticle(t.token, `SCH2-${Date.now().toString(36)}`, '항규정');
    policyId = set.policy.id;
    const add = async (json: Record<string, unknown>) =>
      (await api(`/policies/${policyId}/chapters/${set.chapter.id}/articles`, { method: 'POST', token: t.token, json })).body;
    const root4 = await add({ number: 4, title: '요건', content: '요건 본문' });
    const hang2 = await add({ number: 4, clauseNumber: 2, title: '특례', content: '특례 본문' });
    const hang3 = await add({ number: 4, clauseNumber: 3, title: '', content: '셋째 항 본문' });
    const hang4 = await add({ number: 4, clauseNumber: 4, title: '', content: '넷째 항 본문' });
    await api(`/policies/${policyId}/publish-drafts`, { method: 'POST', token: t.token, json: { changeNote: '제정', effectiveDate: '2024-01-01' } });
    // 2099-09-01 은 항(제3항)을 먼저 승인하고 조 머리 행을 뒤에 승인한다 — 승인 순서와 상관없이 조 머리 행이 첫 줄이어야 한다
    for (const [a, date] of [[hang2, '2099-07-01'], [hang4, '2099-08-01'], [hang3, '2099-09-01'], [root4, '2099-09-01']] as const) {
      const d = await api(`/articles/${a.id}/versions`, { method: 'POST', token: t.token, json: { content: `${a.title || a.id} 개정` } });
      expect(d.status, JSON.stringify(d.body)).toBeLessThan(300);
      await api(`/versions/${d.body.id}/submit`, { method: 'POST', token: t.token });
      const r = await api(`/versions/${d.body.id}/approve`, { method: 'POST', token: t.token, json: { changeNote: '개정', effectiveDate: date } });
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    }
  }, 60_000);

  it("항 행만이면 '제N조제M항(부제)'·부제가 없으면 '제N조제M항', 조 머리 행이 함께면 조 머리가 첫 줄", async () => {
    const r = await api('/policies/scheduled-changes', { token: t.token });
    expect(r.status).toBe(200);
    expect(r.body.map((g: any) => [g.effectiveDate, g.articleCount, g.firstArticle])).toEqual([
      ['2099-07-01', 1, '제4조제2항(특례)'],
      ['2099-08-01', 1, '제4조제4항'],
      ['2099-09-01', 2, '제4조(요건)'],
    ]);
  });
});

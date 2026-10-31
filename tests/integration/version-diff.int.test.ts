import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * T-134 버전 비교(GET /versions/diff).
 *
 * 같은 컨트롤러의 GET /versions/:id 가 먼저 선언돼 있어 "diff" 가 버전 id 로 잡혔고, 분절 보기의 버전 비교가
 * 처음부터 늘 404("Version not found")였다.
 */
describe('T-134 버전 비교', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let v1 = '';
  let v2 = '';

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('vdiff');
    const set = await createPolicyWithArticle(t.token, `VDF-${Date.now().toString(36)}`, '비교규정');
    const pub = await api(`/policies/${set.policy.id}/publish-drafts`, {
      method: 'POST',
      token: t.token,
      json: { changeNote: '제정', effectiveDate: '2024-01-01' },
    });
    expect(pub.status, JSON.stringify(pub.body)).toBeLessThan(300);
    const draft = await api(`/articles/${set.article.id}/versions`, {
      method: 'POST',
      token: t.token,
      json: { content: '수당은 월 20만원을 지급한다.' },
    });
    expect(draft.status, JSON.stringify(draft.body)).toBeLessThan(300);
    const list = (await api(`/articles/${set.article.id}/versions`, { token: t.token })).body;
    v2 = draft.body.id;
    v1 = list.find((v: any) => v.id !== v2).id;
  }, 60_000);

  it('두 버전의 낱말 단위 차이를 돌려준다(예전에는 늘 404)', async () => {
    const r = await api(`/versions/diff?v1=${v1}&v2=${v2}`, { token: t.token });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.v1.id).toBe(v1);
    expect(r.body.v2.id).toBe(v2);
    expect(r.body.changes.some((c: any) => c.added && c.value.includes('20만원'))).toBe(true);
  });

  it('버전을 빼먹으면 아무 버전이나 고르지 않고 400', async () => {
    expect((await api(`/versions/diff?v1=${v1}`, { token: t.token })).status).toBe(400);
    expect((await api(`/versions/diff`, { token: t.token })).status).toBe(400);
  });

  it('다른 회사의 버전은 404', async () => {
    const other = await createTenant('vdiff-other');
    expect((await api(`/versions/diff?v1=${v1}&v2=${v2}`, { token: other.token })).status).toBe(404);
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';

/**
 * T-138 열람자에게 초안·검토 중 본문을 주지 않는다.
 *
 * 규정 상세는 T-117 부터 열람자에게 초안(`pendingVersion`)을 보내지 않았는데, 버전 API(목록·한 건·비교)는 역할을 보지 않고
 * 초안 본문까지 그대로 줬다. 열람자에게는 발행 이력(시행본·이전 버전·시행 예정)만 준다.
 */
describe('T-138 버전 API 의 초안 — 편집 권한자에게만', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let viewer = '';
  let articleId = '';
  let issued = '';
  let draft = '';

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('vdraft');
    const set = await createPolicyWithArticle(t.token, `VDR-${Date.now().toString(36)}`, '초안규정');
    articleId = set.article.id;
    await api(`/policies/${set.policy.id}/publish-drafts`, {
      method: 'POST',
      token: t.token,
      json: { changeNote: '제정', effectiveDate: '2024-01-01' },
    });
    const d = await api(`/articles/${articleId}/versions`, { method: 'POST', token: t.token, json: { content: '아직 승인 전인 비밀 초안 문구' } });
    expect(d.status, JSON.stringify(d.body)).toBeLessThan(300);
    draft = d.body.id;
    issued = (await api(`/articles/${articleId}/versions`, { token: t.token })).body.find((v: any) => v.status === 'published').id;
    const email = `viewer-${t.slug}@example.test`;
    await api('/users', { method: 'POST', token: t.token, json: { email, password: t.password, name: 'v', role: 'viewer' } });
    viewer = (await login(email, t.password, t.slug)).body.accessToken;
  }, 60_000);

  it('버전 목록 — 열람자는 발행 이력만, 편집 권한자는 초안까지', async () => {
    const forViewer = (await api(`/articles/${articleId}/versions`, { token: viewer })).body;
    expect(forViewer.map((v: any) => v.status)).toEqual(['published']);
    expect(JSON.stringify(forViewer)).not.toContain('비밀 초안');
    const forAdmin = (await api(`/articles/${articleId}/versions`, { token: t.token })).body;
    expect(forAdmin.map((v: any) => v.status)).toEqual(['draft', 'published']);
  });

  it('한 건·비교 — 열람자가 초안 id 로 물으면 404, 발행본은 그대로', async () => {
    expect((await api(`/versions/${draft}`, { token: viewer })).status).toBe(404);
    expect((await api(`/versions/${issued}`, { token: viewer })).status).toBe(200);
    expect((await api(`/versions/diff?v1=${issued}&v2=${draft}`, { token: viewer })).status).toBe(404);
    const forAdmin = await api(`/versions/diff?v1=${issued}&v2=${draft}`, { token: t.token });
    expect(forAdmin.status).toBe(200);
    expect(JSON.stringify(forAdmin.body)).toContain('비밀 초안');
  });
});

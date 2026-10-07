import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * 시행 전 초안 표시·한꺼번에 시행.
 *
 * 조·항을 손으로 넣으면 내용은 초안으로만 저장되고, 상세 화면은 시행본만 보여 줘서
 * "넣었는데 안 나온다"는 제보가 나왔다(대표 피드백, 2026-10-07). 고친 동작:
 * - 편집 권한자에게만 시행본 없는 조문의 최신 초안을 `pendingVersion`으로 준다.
 * - 관리자는 "한 번도 시행된 적 없는" 조문의 초안을 한꺼번에 시행할 수 있다.
 *   이미 시행 중인 조문의 개정 초안은 건드리지 않는다(그건 조문별 검토를 탄다).
 */
describe('시행 전 초안 — 표시와 한꺼번에 시행', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let policyId: string;
  let chapterId: string;
  const ids: Record<string, string> = {};

  const detail = async (token: string) => (await api(`/policies/${policyId}`, { token })).body;
  const articleOf = (policy: any, key: string) =>
    policy.chapters.flatMap((c: any) => c.articles).find((a: any) => a.id === ids[key]);
  const userToken = async (role: 'editor' | 'viewer') => {
    const email = `${role}-${t.slug}@example.test`;
    await api('/users', { method: 'POST', token: t.token, json: { email, password: t.password, name: role, role } });
    const r = await api('/auth/login', { method: 'POST', json: { email, password: t.password, tenantSlug: t.slug } });
    return r.body.accessToken as string;
  };

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('pub-drafts');
    // 제1조(목적) — 내용과 함께 추가 → 초안
    const set = await createPolicyWithArticle(t.token, `PD-${Date.now().toString(36)}`);
    policyId = set.policy.id;
    chapterId = set.chapter.id;
    ids.jo1 = set.article.id;

    const add = async (json: Record<string, unknown>) =>
      (await api(`/policies/${policyId}/chapters/${chapterId}/articles`, { method: 'POST', token: t.token, json })).body;
    // 제2조(적용범위) 제목만 + ① 항 초안
    ids.jo2 = (await add({ number: 2, title: '적용범위' })).id;
    ids.jo2h1 = (await add({ number: 2, clauseNumber: 1, title: '', content: '이사회에 관한 사항은 이 규정에 따른다.' })).id;
    // 제3조 — 이미 시행 중이고, 개정 초안이 하나 더 있다
    ids.jo3 = (await add({ number: 3, title: '권한', content: '시행 중인 원래 문구' })).id;
    const v1 = (await api(`/articles/${ids.jo3}/versions`, { token: t.token })).body[0];
    await api(`/versions/${v1.id}/submit`, { method: 'POST', token: t.token });
    await api(`/versions/${v1.id}/approve`, { method: 'POST', token: t.token, json: { changeNote: '제정' } });
    await api(`/articles/${ids.jo3}/versions`, { method: 'POST', token: t.token, json: { content: '검토 전 개정 문구' } });
  });

  it('관리자에게는 시행본 없는 조문의 초안 내용이 같이 온다', async () => {
    const p = await detail(t.token);
    expect(articleOf(p, 'jo1').versions).toEqual([]);
    expect(articleOf(p, 'jo1').pendingVersion.content).toBe('이 규정은 통합테스트를 목적으로 한다.');
    expect(articleOf(p, 'jo2h1').pendingVersion.status).toBe('draft');
    // 제목만 있는 조 머리는 버전 자체가 없다
    expect(articleOf(p, 'jo2').pendingVersion).toBeNull();
  });

  it('열람자에게는 시행되지 않은 문구를 보내지 않는다', async () => {
    const p = await detail(await userToken('viewer'));
    expect(articleOf(p, 'jo1').pendingVersion).toBeUndefined();
    expect(articleOf(p, 'jo1').versions).toEqual([]);
  });

  it('목차의 의견 점은 처리 안 된 의견이 있을 때만 — 의견 수가 같이 온다', async () => {
    expect(articleOf(await detail(t.token), 'jo1')._count.comments).toBe(0);
    const c = await api(`/articles/${ids.jo1}/comments`, { method: 'POST', token: t.token, json: { content: '확인 필요' } });
    expect(articleOf(await detail(t.token), 'jo1')._count.comments).toBe(1);
    await api(`/comments/${c.body.id}`, { method: 'PATCH', token: t.token, json: { isResolved: true } });
    expect(articleOf(await detail(t.token), 'jo1')._count.comments).toBe(0);
  });

  it('편집자는 한꺼번에 시행할 수 없다 (시행 승인은 관리자 권한)', async () => {
    const { status } = await api(`/policies/${policyId}/publish-drafts`, {
      method: 'POST',
      token: await userToken('editor'),
      json: { changeNote: '제정' },
    });
    expect(status).toBe(403);
  });

  it('사유 없이는 시행하지 않는다', async () => {
    const { status } = await api(`/policies/${policyId}/publish-drafts`, { method: 'POST', token: t.token, json: {} });
    expect(status).toBe(400);
  });

  it('시행된 적 없는 조문만 시행하고, 시행 중인 조문의 개정 초안은 그대로 둔다', async () => {
    const { status, body } = await api(`/policies/${policyId}/publish-drafts`, {
      method: 'POST',
      token: t.token,
      json: { changeNote: '제정', effectiveDate: '2024-07-26' },
    });
    expect(status).toBe(200);
    expect(body).toEqual({ published: 2 }); // 제1조, 제2조 ①

    const p = await detail(t.token);
    expect(articleOf(p, 'jo1').versions[0]).toMatchObject({
      status: 'published',
      content: '이 규정은 통합테스트를 목적으로 한다.',
      changeNote: '제정',
    });
    expect(String(articleOf(p, 'jo1').versions[0].effectiveDate)).toMatch(/^2024-07-26/);
    expect(articleOf(p, 'jo2h1').versions[0].status).toBe('published');
    // 제3조: 시행본은 원래 문구 그대로, 개정 초안은 여전히 초안
    expect(articleOf(p, 'jo3').versions[0].content).toBe('시행 중인 원래 문구');
    expect(articleOf(p, 'jo3').pendingVersion).toMatchObject({ status: 'draft', content: '검토 전 개정 문구' });
  });

  it('다시 부르면 시행할 것이 없다', async () => {
    const { body } = await api(`/policies/${policyId}/publish-drafts`, {
      method: 'POST',
      token: t.token,
      json: { changeNote: '제정' },
    });
    expect(body).toEqual({ published: 0 });
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';

/**
 * T-132 ① 일반 승인의 순서 — 그 조문에 더 늦게 시행되는 발행 이력이 있으면 그보다 이른 날로 승인하지 못한다.
 *
 * 개정 후보·재파싱 묶음 승인은 이미 막았는데 일반 승인만 남아 있었다. 막지 않으면 시행 예정 버전이 archived 로 내려가지만
 * 날짜 규칙(그날 시행 중 = 시행일이 가장 늦은 발행 이력)상 그날 다시 현재가 되어, 이번 개정은 그날까지만 시행되고 사라진다.
 */
describe('T-132 ① 일반 승인의 순서', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let policyId = '';
  let articleId = '';
  const approveNew = async (content: string, effectiveDate: string) => {
    const d = await api(`/articles/${articleId}/versions`, { method: 'POST', token: t.token, json: { content } });
    expect(d.status, JSON.stringify(d.body)).toBeLessThan(300);
    await api(`/versions/${d.body.id}/submit`, { method: 'POST', token: t.token });
    return { id: d.body.id as string, res: await api(`/versions/${d.body.id}/approve`, { method: 'POST', token: t.token, json: { changeNote: '개정', effectiveDate } }) };
  };

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('order');
    const set = await createPolicyWithArticle(t.token, `ORD-${Date.now().toString(36)}`, '순서규정');
    policyId = set.policy.id;
    articleId = set.article.id;
    await api(`/policies/${policyId}/publish-drafts`, { method: 'POST', token: t.token, json: { changeNote: '제정', effectiveDate: '2024-01-01' } });
    const first = await approveNew('6월부터 시행할 개정', '2099-06-01');
    expect(first.res.status, JSON.stringify(first.res.body)).toBeLessThan(300);
  }, 60_000);

  it('시행 예정 버전보다 이른 날로는 승인하지 못하고 409 — 그 버전은 그대로 시행 예정', async () => {
    const early = await approveNew('1월부터 시행하려던 개정', '2099-01-01');
    expect(early.res.status).toBe(409);
    expect(String(early.res.body.message)).toContain('2099-06-01');
    // 검토 중으로 남는다(발행되지 않았다)
    const versions = (await api(`/articles/${articleId}/versions`, { token: t.token })).body;
    expect(versions.find((v: any) => v.id === early.id).status).toBe('review');
    const detail = (await api(`/policies/${policyId}`, { token: t.token })).body;
    const a = detail.chapters.flatMap((c: any) => c.articles).find((x: any) => x.id === articleId);
    expect(a.scheduledVersions.map((v: any) => String(v.effectiveDate).slice(0, 10))).toEqual(['2099-06-01']);
    // 같은 날이나 그 뒤면 된다(같은 날은 나중 버전이 이긴다)
    const same = await api(`/versions/${early.id}/approve`, { method: 'POST', token: t.token, json: { changeNote: '같은 날로', effectiveDate: '2099-06-01' } });
    expect(same.status, JSON.stringify(same.body)).toBeLessThan(300);
  });
});

/**
 * T-132 ④ 미래 시행일로 승인한 개정의 알림 — "개정 시행"이 아니라 "시행 예정"(개정 후보 승인 알림과 같은 표기).
 * 예전에는 일반 승인·한꺼번에 시행·재파싱 묶음 승인이 시행일과 상관없이 늘 [개정 시행]이라, 받는 사람이 지금 바뀐 줄 알았다.
 */
describe('T-132 ④ 승인 알림의 시행일', () => {
  it('오늘 시행은 [개정 시행], 미래 시행은 [개정 발행 · 날짜 시행 예정]과 시행일 줄', async () => {
    const t = await createTenant('notify');
    const set = await createPolicyWithArticle(t.token, `NTF-${Date.now().toString(36)}`, '알림규정');
    const email = `viewer-${t.slug}@example.test`;
    const viewerUser = (await api('/users', { method: 'POST', token: t.token, json: { email, password: t.password, name: 'v', role: 'viewer' } })).body;
    const viewer = (await login(email, t.password, t.slug)).body.accessToken;
    const put = await api(`/policies/${set.policy.id}`, {
      method: 'PUT',
      token: t.token,
      json: { revisionNotify: { enabled: true, userIds: [viewerUser.id], groupIds: [] } },
    });
    expect(put.status, JSON.stringify(put.body)).toBeLessThan(300);
    await api(`/policies/${set.policy.id}/publish-drafts`, { method: 'POST', token: t.token, json: { changeNote: '제정', effectiveDate: '2024-01-01' } });
    const notes = async () =>
      ((await api('/notifications', { token: viewer })).body as any[]).filter((n) => n.kind === 'policy_revision');
    // 한꺼번에 시행(과거 시행일) — 시행일 줄은 있고 "시행 예정"은 아니다
    const first = await notes();
    expect(first[0].title).toBe('[개정 시행] 알림규정');
    expect(first[0].body).toContain('시행일: 2024-01-01');

    const approve = async (content: string, effectiveDate: string) => {
      const d = await api(`/articles/${set.article.id}/versions`, { method: 'POST', token: t.token, json: { content } });
      await api(`/versions/${d.body.id}/submit`, { method: 'POST', token: t.token });
      const r = await api(`/versions/${d.body.id}/approve`, { method: 'POST', token: t.token, json: { changeNote: '개정', effectiveDate } });
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    };
    await approve('미래 문구', '2099-06-01');
    const after = await notes();
    expect(after.map((n) => n.title)).toContain('[개정 발행 · 2099-06-01 시행 예정] 알림규정');
    const future = after.find((n) => n.title.includes('시행 예정'));
    expect(future.body).toContain('시행일: 2099-06-01 — 그때까지는 지금 본문이 시행 중입니다');
  });
});


import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * T-132 ⑥ 변수 연결의 "현재"와 "시행 예정" (T-109 담당 결정).
 *
 * 변수 화면·연결 만들기·풀기가 "현재"를 `status = published` 로 골라, 미래 시행일로 개정을 승인하면
 * ① 시행 예정 본문의 연결을 지금 것으로 셌고 ② 오늘 시행 중인(archived) 본문에는 잇지 못했고 ③ 그 연결을 풀지도 못했다.
 * 승인 때 연결은 새 버전에 복사되고 옛 버전의 연결은 남는다(버전별 연결) — 조회만 오늘 시행본·시행 예정본으로 나눈다.
 */
describe('T-132 ⑥ 변수 연결 — 오늘 시행본과 시행 예정본', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let variableId = '';
  let articleId = '';
  let v1 = '';
  let v2 = '';
  const TEXT = '관리팀이 맡는다.';
  const post = (path: string, json: unknown) => api(path, { method: 'POST', token: t.token, json });
  const approveNew = async (aid: string, content: string, effectiveDate: string) => {
    const d = await post(`/articles/${aid}/versions`, { content });
    expect(d.status, JSON.stringify(d.body)).toBeLessThan(300);
    await api(`/versions/${d.body.id}/submit`, { method: 'POST', token: t.token });
    const r = await post(`/versions/${d.body.id}/approve`, { changeNote: '개정', effectiveDate });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    return d.body.id as string;
  };

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('vphase');
    const set = await createPolicyWithArticle(t.token, `VPH-${Date.now().toString(36)}`, '변수규정');
    articleId = set.article.id;
    // 첫 본문을 TEXT 로 맞춰 시행(createPolicyWithArticle 의 기본 본문 대신)
    const base = (await api(`/articles/${articleId}/versions`, { token: t.token })).body[0];
    await api(`/versions/${base.id}`, { method: 'PUT', token: t.token, json: { content: TEXT } });
    await post(`/policies/${set.policy.id}/publish-drafts`, { changeNote: '제정', effectiveDate: '2024-01-01' });
    v1 = (await api(`/articles/${articleId}/versions`, { token: t.token })).body.find((v: any) => v.status === 'published').id;
    const variable = await post('/variables', { key: 'DEPT', label: '담당 부서', value: '관리팀' });
    expect(variable.status, JSON.stringify(variable.body)).toBeLessThan(300);
    variableId = variable.body.id;
    const bound = await post(`/versions/${v1}/variable-bindings`, { variableId, start: 0, end: 3, text: '관리팀' });
    expect(bound.status, JSON.stringify(bound.body)).toBe(201);
    // 미래 시행 개정 — 승인하면 v1 은 archived 로 내려가지만 오늘은 v1 이 시행 중, 연결은 v2 에 복사된다
    v2 = await approveNew(articleId, `${TEXT} 다만 긴급하면 본부장이 맡는다.`, '2099-01-01');
  }, 60_000);

  it('목록은 오늘 시행본과 시행 예정본의 연결 수를 따로 센다', async () => {
    const row = (await api('/variables', { token: t.token })).body.find((x: any) => x.id === variableId);
    expect(row).toMatchObject({ bindingCount: 1, scheduledBindingCount: 1 });
  });

  it('상세는 오늘 시행 중인 연결과 시행 예정 연결을 나누고 어느 버전인지 싣는다', async () => {
    const d = (await api(`/variables/${variableId}`, { token: t.token })).body;
    expect(d.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.bindings).toEqual([expect.objectContaining({ versionId: v1, versionNum: 1, phase: 'in_force', text: '관리팀' })]);
    expect(d.scheduledBindings).toEqual([
      expect.objectContaining({ versionId: v2, versionNum: 2, phase: 'scheduled', effectiveDate: '2099-01-01' }),
    ]);
  });

  it('오늘 시행 중인(archived) 본문의 연결을 풀 수 있고, 시행 예정본의 연결은 그대로', async () => {
    const d = (await api(`/variables/${variableId}`, { token: t.token })).body;
    const released = await api(`/variable-bindings/${d.bindings[0].id}`, { method: 'DELETE', token: t.token });
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    const after = (await api(`/variables/${variableId}`, { token: t.token })).body;
    expect(after.bindings).toEqual([]);
    expect(after.scheduledBindings).toHaveLength(1);
  });

  it('오늘 시행 중인(archived) 본문과 시행 예정본 모두에 이을 수 있다', async () => {
    expect((await post(`/versions/${v1}/variable-bindings`, { variableId, start: 0, end: 3, text: '관리팀' })).status).toBe(201);
    const extra = `${TEXT} 다만 긴급하면 본부장이 맡는다.`.indexOf('본부장');
    expect((await post(`/versions/${v2}/variable-bindings`, { variableId, start: extra, end: extra + 3, text: '본부장' })).status).toBe(201);
    const row = (await api('/variables', { token: t.token })).body.find((x: any) => x.id === variableId);
    expect(row).toMatchObject({ bindingCount: 1, scheduledBindingCount: 2 });
  });

  it('시행 중도 시행 예정도 아닌 버전(오늘로 대체된 옛 본문)에는 잇지 못한다 — 409', async () => {
    const other = await createPolicyWithArticle(t.token, `VPH2-${Date.now().toString(36)}`, '다른규정');
    await post(`/policies/${other.policy.id}/publish-drafts`, { changeNote: '제정', effectiveDate: '2024-01-01' });
    const old = (await api(`/articles/${other.article.id}/versions`, { token: t.token })).body.find((v: any) => v.status === 'published');
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await approveNew(other.article.id, `${old.content} 덧붙임`, today);
    const r = await post(`/versions/${old.id}/variable-bindings`, { variableId, start: 0, end: 1, text: old.content.slice(0, 1) });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
  });
});

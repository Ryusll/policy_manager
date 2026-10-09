import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * T-127 "현재"는 오늘 시점의 시행본이다.
 *
 * 예전에는 "현재" 화면·검색이 `published` 를 그대로 보여 줘, 미래 시행일로 승인한 개정이 시행일 전부터
 * 지금 본문처럼 보였다(승인하면 이전 시행본은 곧바로 내려간다). 이제 현재 = 오늘(한국 날짜) 시점 조회이고,
 * 시행일 없이 들어간 예전 시행본은 그대로 현재다. 규칙은 `common/as-of.ts` 의 currentVersion* 하나다.
 *
 * 시행일 없는 예전 시행본은 지금 API 로는 만들 수 없어(T-123) DB 에서 직접 시행일을 지운다.
 */
function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

describe('T-127 현재 = 오늘 시점의 시행본', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let policyId = '';
  const ids: Record<string, string> = {};
  const search = async (q: string) => (await api(`/search?q=${encodeURIComponent(q)}`, { token: t.token })).body;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('current');
    const set = await createPolicyWithArticle(t.token, `CUR-${Date.now().toString(36)}`, '현재판정규정');
    policyId = set.policy.id;
    const add = async (json: Record<string, unknown>) =>
      (await api(`/policies/${policyId}/chapters/${set.chapter.id}/articles`, { method: 'POST', token: t.token, json })).body;
    ids.allowance = (await add({ number: 2, title: '수당', content: '현재 문구 알파 수당은 10만원이다.' })).id;
    ids.repealed = (await add({ number: 3, title: '폐지 조문', content: '폐지될 감마 규정이다.' })).id;
    ids.legacy = (await add({ number: 4, title: '예전 조문', content: '예전 델타 문구이다.' })).id;
    const pub = await api(`/policies/${policyId}/publish-drafts`, {
      method: 'POST',
      token: t.token,
      json: { changeNote: '제정', effectiveDate: '2024-01-01' },
    });
    expect(pub.body.published).toBe(4);

    // 제2조 — 미래 시행일로 개정 승인(승인하는 순간 이전 시행본은 archived 로 내려간다)
    const draft = await api(`/articles/${ids.allowance}/versions`, {
      method: 'POST',
      token: t.token,
      json: { content: '미래 문구 베타 수당은 20만원이다.' },
    });
    expect(draft.status, JSON.stringify(draft.body)).toBeLessThan(300);
    await api(`/versions/${draft.body.id}/submit`, { method: 'POST', token: t.token });
    const approved = await api(`/versions/${draft.body.id}/approve`, {
      method: 'POST',
      token: t.token,
      json: { changeNote: '수당 인상', effectiveDate: '2099-01-01' },
    });
    expect(approved.status, JSON.stringify(approved.body)).toBeLessThan(300);

    // 제3조 — 오늘 폐지
    const v3 = (await api(`/articles/${ids.repealed}/versions`, { token: t.token })).body.find(
      (v: any) => v.status === 'published',
    );
    expect((await api(`/versions/${v3.id}/archive`, { method: 'POST', token: t.token })).status).toBeLessThan(300);

    // 제4조 — 시행일 없이 들어간 예전 시행본(T-123 보정 전 데이터)
    sql(`UPDATE article_versions SET effective_date = NULL WHERE article_id = '${ids.legacy}';`);
  }, 120_000);

  describe('검색', () => {
    it('시행일 전인 개정 문구는 찾지 않고, 지금 시행 중인 이전 본문을 찾는다', async () => {
      expect((await search('베타 수당')).pagination.total).toBe(0);
      const now = await search('알파 수당');
      expect(now.pagination.total).toBe(1);
      expect(now.versions[0].article.id).toBe(ids.allowance);
      expect(now.versions[0].content).toContain('알파');
    });

    it('폐지된 조문은 찾지 않는다', async () => {
      expect((await search('감마 규정')).pagination.total).toBe(0);
    });

    it('시행일 없는 예전 시행본은 현재 본문으로 찾는다', async () => {
      const r = await search('델타 문구');
      expect(r.pagination.total).toBe(1);
      expect(r.versions[0].article.id).toBe(ids.legacy);
    });

    it('LIKE 경로가 실제로 돈다(예전에는 늘 실패해 폴백만 돌았다)', async () => {
      expect((await search('알파')).searchEngine).toBe('pg_bigm_ready');
    });
  });

  describe('규정 질문(모의 AI 일 때)', () => {
    it('근거는 지금 시행 중인 본문 — 시행일 전인 개정 문구는 근거가 되지 않는다', async (ctx) => {
      const st = await api('/ask/status', { token: t.token });
      if (st.body.provider !== 'mock') ctx.skip();
      const { body } = await api('/ask', { method: 'POST', token: t.token, json: { question: '수당 알파' } });
      const text = JSON.stringify(body);
      expect(text).not.toContain('베타 수당은 20만원');
      expect(body.consulted.map((c: any) => c.label)).toContain('제2조(수당)');
      const beta = await api('/ask', { method: 'POST', token: t.token, json: { question: '베타' } });
      expect(beta.body.reason).toBe('no_candidates');
    });
  });
});

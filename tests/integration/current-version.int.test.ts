import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { api, createTenant, createPolicyWithArticle, enableAsk, login, waitForApi } from './helpers';

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

  /** 한국 날짜 오늘 — 서버의 "현재" 기준일 */
  const kstToday = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const detail = async (token = t.token) => (await api(`/policies/${policyId}`, { token })).body;
  const articleOf = (p: any, id: string) => p.chapters.flatMap((c: any) => c.articles).find((a: any) => a.id === id);

  describe('규정 상세 — 현재와 시행 예정', () => {
    it('시행일 전인 개정은 시행 예정으로 따로 싣고, 지금 본문은 이전 시행본(archived 라도)이다', async () => {
      const a = articleOf(await detail(), ids.allowance);
      expect(a.currentState).toBe('in_force');
      expect(a.versions).toHaveLength(1);
      expect(a.versions[0]).toMatchObject({ versionNum: 1, status: 'archived', phase: 'in_force' });
      expect(a.versions[0].content).toContain('알파');
      expect(a.scheduledVersions).toHaveLength(1);
      expect(a.scheduledVersions[0]).toMatchObject({ versionNum: 2, status: 'published', phase: 'scheduled', changeNote: '수당 인상' });
      expect(a.scheduledVersions[0].content).toContain('베타');
      expect(String(a.scheduledVersions[0].effectiveDate)).toMatch(/^2099-01-01/);
      // 연혁 탭의 날짜 3종(T-111)과 같은 모양
      expect(a.scheduledVersions[0]).toHaveProperty('lawChange', null);
      expect(a.scheduledVersions[0]).toHaveProperty('publishedAt');
      expect('changeEvent' in a.scheduledVersions[0]).toBe(false);
    });

    it('오늘 폐지한 조문은 본문 없이 폐지 상태와 폐지일', async () => {
      const a = articleOf(await detail(), ids.repealed);
      expect(a).toMatchObject({ currentState: 'repealed', repealedOn: kstToday(), versions: [], scheduledVersions: [] });
    });

    it('시행일 없는 예전 시행본은 그대로 현재 본문', async () => {
      const a = articleOf(await detail(), ids.legacy);
      expect(a.currentState).toBe('in_force');
      expect(a.versions[0]).toMatchObject({ effectiveDate: null });
      expect(a.versions[0].content).toContain('델타');
    });

    it('규정 요약 — 기준일과 시행 예정', async () => {
      const p = await detail();
      // 본문만 바꾸는 미래 개정은 구조 변경이 아니다 — 구조 편집을 막지 않는다
      expect(p.current).toMatchObject({
        date: kstToday(),
        scheduledCount: 1,
        nextScheduledDate: '2099-01-01',
        scheduledArticles: [],
        structureChanges: 0,
      });
    });

    it('열람자에게도 시행 예정 본문을 보인다(승인된 문구) — 초안은 보이지 않는다', async () => {
      const email = `viewer-${t.slug}@example.test`;
      await api('/users', { method: 'POST', token: t.token, json: { email, password: t.password, name: 'v', role: 'viewer' } });
      const viewer = (await login(email, t.password, t.slug)).body.accessToken;
      const a = articleOf(await detail(viewer), ids.allowance);
      expect(a.scheduledVersions[0].content).toContain('베타');
      expect(a.pendingVersion).toBeUndefined();
    });

    it('미래 시행일로 넣은 새 조문은 본문 없이 시행 예정 상태로 제자리에 보인다', async () => {
      const p0 = await detail();
      const chapterId = p0.chapters[0].id;
      const fresh = (await api(`/policies/${policyId}/chapters/${chapterId}/articles`, {
        method: 'POST',
        token: t.token,
        json: { number: 5, title: '신설', content: '다음 해부터 새로 생기는 엡실론 조문이다.' },
      })).body;
      const pub = await api(`/policies/${policyId}/publish-drafts`, {
        method: 'POST',
        token: t.token,
        json: { changeNote: '신설', effectiveDate: '2099-03-01' },
      });
      expect(pub.body.published).toBe(1);
      const p = await detail();
      const a = articleOf(p, fresh.id);
      expect(a).toMatchObject({ number: 5, currentState: 'scheduled', versions: [] });
      expect(a.scheduledVersions[0].content).toContain('엡실론');
      expect(p.current.scheduledArticles).toEqual([]); // 자리가 겹치지 않으면 본문 목록에 그대로 있다
      expect(p.current.scheduledCount).toBe(2);
      expect((await search('엡실론')).pagination.total).toBe(0);
    });
  });

  describe('비교표 — 지금 본문끼리', () => {
    it('규정 간 비교와 3단비교에 시행일 전인 개정 문구가 들어가지 않는다', async () => {
      const other = await createPolicyWithArticle(t.token, `CUR2-${Date.now().toString(36)}`, '하위규정');
      const linked = await api(`/policies/${other.policy.id}`, { method: 'PUT', token: t.token, json: { parentId: policyId } });
      expect(linked.status, JSON.stringify(linked.body)).toBeLessThan(300);
      const otherPub = await api(`/policies/${other.policy.id}/publish-drafts`, {
        method: 'POST',
        token: t.token,
        json: { changeNote: '제정', effectiveDate: '2024-01-01' },
      });
      expect(otherPub.status, JSON.stringify(otherPub.body)).toBeLessThan(300);
      const cmp = await api(`/policies/${policyId}/compare-with?targetId=${other.policy.id}`, { token: t.token });
      expect(cmp.status).toBe(200);
      expect(cmp.body.date).toBe(kstToday());
      expect(JSON.stringify(cmp.body)).toContain('알파');
      expect(JSON.stringify(cmp.body)).not.toContain('베타');
      const three = await api(`/policies/${policyId}/three-way`, { token: t.token });
      expect(three.status).toBe(200);
      expect(three.body.levels.map((l: any) => l.id)).toContain(other.policy.id);
      expect(three.body.date).toBe(kstToday());
      expect(JSON.stringify(three.body)).toContain('알파');
      expect(JSON.stringify(three.body)).not.toContain('베타');
      expect(JSON.stringify(three.body)).not.toContain('엡실론');
    });
  });

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
      await enableAsk(t.token); // 회사마다 꺼진 채 시작한다(T-146)
      const { body } = await api('/ask', { method: 'POST', token: t.token, json: { question: '수당 알파' } });
      const text = JSON.stringify(body);
      expect(text).not.toContain('베타 수당은 20만원');
      expect(body.consulted.map((c: any) => c.label)).toContain('제2조(수당)');
      const beta = await api('/ask', { method: 'POST', token: t.token, json: { question: '베타' } });
      expect(beta.body.reason).toBe('no_candidates');
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';

function sql(query: string): string {
  return execSync(`docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`, {
    encoding: 'utf8',
    input: query,
  }).trim();
}
const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * T-132 ②③ 시행 예정 개정의 관리 — 시행 예정 철회와 미래 날짜 폐지(폐지 예정·취소).
 *
 * ② 승인했지만 시행일 전인 개정을 거둘 방법이 없었다(같은 날 다른 판을 승인해 덮는 수밖에). 가장 늦은 시행 예정 버전을
 *   초안으로 되돌리고, 지금 본문이 그대로 시행되게 한다.
 * ③ 폐지는 오늘로만 할 수 있었다(T-126). 미래 날짜로 정하면 그날까지는 지금 본문이 시행 중이고, 그 전에는 취소할 수 있다.
 *   폐지 예정이 있는 동안 그 전 시행일의 승인은 막는다 — 새 버전이 폐지 예정을 덮어 폐지가 조용히 사라진다.
 */
describe('T-132 ②③ 시행 예정 철회와 폐지 예정', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let policyId = '';
  let chapterId = '';
  const kstToday = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const post = (path: string, json?: unknown, token = t.token) => api(path, { method: 'POST', token, json });
  const versionsOf = async (articleId: string) => (await api(`/articles/${articleId}/versions`, { token: t.token })).body as any[];
  const detailArticle = async (articleId: string) =>
    (await api(`/policies/${policyId}`, { token: t.token })).body.chapters.flatMap((c: any) => c.articles).find((a: any) => a.id === articleId);
  const newArticle = async (number: number, content: string) =>
    (await post(`/policies/${policyId}/chapters/${chapterId}/articles`, { number, title: `조${number}`, content })).body;
  const approveNew = async (articleId: string, content: string, effectiveDate: string) => {
    const d = await post(`/articles/${articleId}/versions`, { content });
    expect(d.status, JSON.stringify(d.body)).toBeLessThan(300);
    await post(`/versions/${d.body.id}/submit`);
    return { id: d.body.id as string, res: await post(`/versions/${d.body.id}/approve`, { changeNote: '개정', effectiveDate }) };
  };

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('sched-manage');
    const set = await createPolicyWithArticle(t.token, `SMG-${Date.now().toString(36)}`, '관리규정');
    policyId = set.policy.id;
    chapterId = set.chapter.id;
  }, 60_000);

  describe('③ 폐지 예정', () => {
    let articleId = '';
    let v1 = '';

    beforeAll(async () => {
      articleId = (await newArticle(2, '폐지 예정을 볼 조문이다.')).id;
      await post(`/policies/${policyId}/publish-drafts`, { changeNote: '제정', effectiveDate: '2024-01-01' });
      v1 = (await versionsOf(articleId)).find((v) => v.status === 'published').id;
    }, 60_000);

    it('지난 날짜로는 폐지하지 않는다(소급 없음)', async () => {
      const r = await post(`/versions/${v1}/archive`, { repealedOn: '2024-06-01' });
      expect(r.status).toBe(400);
      expect(String(r.body.message)).toContain('소급');
    });

    it('미래 날짜로 폐지하면 그날까지는 시행 중 — 상세에 폐지 예정, 그날부터 시점 조회에서 빠진다', async () => {
      const r = await post(`/versions/${v1}/archive`, { repealedOn: '2099-01-01' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(String(r.body.repealedOn)).toMatch(/^2099-01-01/);
      const a = await detailArticle(articleId);
      expect(a).toMatchObject({ currentState: 'in_force', repealScheduledOn: '2099-01-01' });
      expect(a.versions[0].content).toContain('폐지 예정을 볼');
      const p = (await api(`/policies/${policyId}`, { token: t.token })).body;
      expect(p.current.repealScheduledCount).toBe(1);
      const before = (await api(`/policies/${policyId}/as-of?date=2098-12-31`, { token: t.token })).body;
      expect(JSON.stringify(before)).toContain('폐지 예정을 볼');
      const after = (await api(`/policies/${policyId}/as-of?date=2099-01-01`, { token: t.token })).body;
      expect(JSON.stringify(after.chapters)).not.toContain('폐지 예정을 볼');
      const sched = (await api('/policies/scheduled-changes', { token: t.token })).body;
      expect(sched).toEqual(expect.arrayContaining([expect.objectContaining({ policyId, effectiveDate: '2099-01-01', repealCount: 1 })]));
    });

    it('폐지 예정이 있는 동안 그 전 시행일로는 승인하지 않는다 — 폐지가 조용히 사라지지 않게', async () => {
      const { res } = await approveNew(articleId, '폐지 전에 고치려던 문구', '2098-06-01');
      expect(res.status).toBe(400);
      expect(String(res.body.message)).toContain('폐지될 예정');
    });

    it('폐지 예정은 취소할 수 있고, 다시 시행 중인 게시본이 된다 — 두 번은 안 된다', async () => {
      const r = await post(`/versions/${v1}/cancel-repeal`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const v = (await versionsOf(articleId)).find((x) => x.id === v1);
      expect(v).toMatchObject({ status: 'published', repealedOn: null });
      expect(await detailArticle(articleId)).toMatchObject({ currentState: 'in_force', repealScheduledOn: null });
      expect((await post(`/versions/${v1}/cancel-repeal`)).status).toBe(400);
    });

    it('오늘 폐지한 것(이미 폐지됨)은 취소하지 않는다 — 새 버전으로 다시 시행', async () => {
      const other = await newArticle(3, '오늘 폐지할 조문이다.');
      await post(`/policies/${policyId}/publish-drafts`, { changeNote: '제정', effectiveDate: '2024-01-01' });
      const ov = (await versionsOf(other.id)).find((v) => v.status === 'published').id;
      expect((await post(`/versions/${ov}/archive`)).status).toBe(200);
      const r = await post(`/versions/${ov}/cancel-repeal`);
      expect(r.status).toBe(400);
      expect(String(r.body.message)).toContain(`${kstToday()}에 폐지됐습니다`);
    });
  });

  describe('② 시행 예정 철회', () => {
    let articleId = '';
    let v1 = '';
    let v2 = '';
    let v3 = '';
    let viewer = '';
    let variableId = '';

    beforeAll(async () => {
      articleId = (await newArticle(5, '관리팀이 맡는다.')).id;
      await post(`/policies/${policyId}/publish-drafts`, { changeNote: '제정', effectiveDate: '2024-01-01' });
      v1 = (await versionsOf(articleId)).find((v) => v.status === 'published').id;
      // 알림 받는 사람(열람자)과 변수 연결 — 승인 때 시행 예정 버전에 복사된다
      const email = `viewer-${t.slug}@example.test`;
      const viewerUser = (await post('/users', { email, password: t.password, name: 'v', role: 'viewer' })).body;
      viewer = (await login(email, t.password, t.slug)).body.accessToken;
      await api(`/policies/${policyId}`, { method: 'PUT', token: t.token, json: { revisionNotify: { enabled: true, userIds: [viewerUser.id], groupIds: [] } } });
      variableId = (await post('/variables', { key: 'TEAM', label: '담당 팀', value: '관리팀' })).body.id;
      expect((await post(`/versions/${v1}/variable-bindings`, { variableId, start: 0, end: 3, text: '관리팀' })).status).toBe(201);
      const a2 = await approveNew(articleId, '관리팀이 맡는다. 3월부터 덧붙인다.', '2099-03-01');
      expect(a2.res.status, JSON.stringify(a2.res.body)).toBeLessThan(300);
      v2 = a2.id;
      const a3 = await approveNew(articleId, '관리팀이 맡는다. 3월부터 덧붙인다. 6월부터 더 덧붙인다.', '2099-06-01');
      expect(a3.res.status, JSON.stringify(a3.res.body)).toBeLessThan(300);
      v3 = a3.id;
    }, 60_000);

    it('관리자만, 사유가 있어야 한다', async () => {
      expect((await post(`/versions/${v3}/withdraw`, { reason: '왜' }, viewer)).status).toBe(403);
      expect((await post(`/versions/${v3}/withdraw`, { reason: '' })).status).toBe(400);
    });

    it('가장 늦은 시행 예정 버전만 — 앞 판은 409, 이미 시행된 판은 400', async () => {
      const r = await post(`/versions/${v2}/withdraw`, { reason: '앞 판' });
      expect(r.status).toBe(409);
      expect(String(r.body.message)).toContain('v3');
      expect((await post(`/versions/${v1}/withdraw`, { reason: '시행된 판' })).status).toBe(400);
    });

    it('철회하면 초안으로 돌아가고, 앞 시행 예정 판이 다시 게시본이 된다 — 승인 때 옮겨 온 변수 연결은 거둔다, 알림', async () => {
      const r = await post(`/versions/${v3}/withdraw`, { reason: '6월 개정 재검토' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ restoredVersionId: v2, withdrawnEffectiveDate: '2099-06-01' });
      const vs = await versionsOf(articleId);
      expect(vs.find((v) => v.id === v3)).toMatchObject({ status: 'draft', effectiveDate: null, approvedAt: null, publishedAt: null });
      expect(vs.find((v) => v.id === v3).reviewNote).toContain('6월 개정 재검토');
      expect(vs.find((v) => v.id === v2).status).toBe('published');
      const a = await detailArticle(articleId);
      expect(a.scheduledVersions.map((v: any) => v.id)).toEqual([v2]);
      const variable = (await api(`/variables/${variableId}`, { token: t.token })).body;
      expect(variable.scheduledBindings.map((b: any) => b.versionId)).toEqual([v2]);
      const notes = ((await api('/notifications', { token: viewer })).body as any[]).map((n) => n.title);
      expect(notes).toEqual(expect.arrayContaining([expect.stringContaining('[개정 철회 · 2099-06-01')]));
    });

    it('남은 시행 예정 판도 철회하면 지금 본문이 다시 게시본 — 시행 예정이 없다', async () => {
      const r = await post(`/versions/${v2}/withdraw`, { reason: '3월 개정도 보류' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.restoredVersionId).toBe(v1);
      const a = await detailArticle(articleId);
      expect(a).toMatchObject({ currentState: 'in_force', scheduledVersions: [] });
      expect(a.versions[0].id).toBe(v1);
      expect((await versionsOf(articleId)).find((v) => v.id === v1).status).toBe('published');
      const sched = (await api('/policies/scheduled-changes', { token: t.token })).body as any[];
      expect(sched.some((g) => g.policyId === policyId && g.articleCount > 0)).toBe(false);
    });

    it('철회한 초안은 다시 검토·승인할 수 있다', async () => {
      expect((await post(`/versions/${v2}/submit`)).status).toBeLessThan(300);
      const ok = await post(`/versions/${v2}/approve`, { changeNote: '다시 승인', effectiveDate: '2099-04-01' });
      expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300);
      const a = await detailArticle(articleId);
      expect(a.scheduledVersions.map((v: any) => String(v.effectiveDate).slice(0, 10))).toEqual(['2099-04-01']);
      // 철회 때 거둔 연결 대신 다시 승인하며 옮겨 온 연결 하나만 — 거두지 않았으면 둘이 겹친다
      const bindings = (await api(`/versions/${v2}/variable-bindings`, { token: t.token })).body as any[];
      expect(bindings.map((b) => b.text)).toEqual(['관리팀']);
    });
  });

  describe('③ 폐지 예정 — 개정 후보 승인도 그 전 시행일로는 막는다', () => {
    const sourceId = randomUUID();
    const lawId = randomUUID();
    const lawArt = randomUUID();
    const ev = randomUUID();
    const E = day(30); // 법령 시행일 = 승인하려는 사내 시행일
    const D = day(60); // 폐지 예정일
    let articleId = '';
    let candidateId = '';

    beforeAll(async () => {
      sql(`
        INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
        INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, updated_at)
          VALUES ('${lawId}', '${sourceId}', '900132', '990132', '폐지예정시험법', '${E}', now());
        INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, label, content, version_key, sort_order, updated_at)
          VALUES ('${lawArt}', '${lawId}', '60/1/', 60, 1, '제60조제1항', '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.', 'v1:p2', 1, now());
        INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, before_version_key, after_version_key, law_effective_date, received_via, amendments_processed_at)
          VALUES ('${ev}', '${lawId}', '${lawArt}', '60/1/', 'modified', '사용자는 근로자에게 15일의 유급휴가를 주어야 한다.', '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.', 'v1:p1', 'v1:p2', '${E}', 'poll', now());
      `);
      articleId = (await newArticle(9, '직원에게는 매년 15일의 연차휴가를 준다.')).id;
      await post(`/policies/${policyId}/publish-drafts`, { changeNote: '제정', effectiveDate: '2020-01-01' });
      const link = await post('/law-links', { lawArticleId: lawArt, articleId, relationType: 'delegation', evidenceText: '연차휴가 일수' });
      expect(link.status, JSON.stringify(link.body)).toBe(201);
      const g = await post('/amendments/generate', { changeEventId: ev });
      expect(g.status, JSON.stringify(g.body)).toBe(200);
      candidateId = g.body.created.find((c: any) => c.articleId === articleId).id;
      const c = (await api(`/amendments/${candidateId}`, { token: t.token })).body;
      const review = await post(`/amendments/${candidateId}/review`, { expectedRevision: c.revision, expectedLockVersion: c.lockVersion });
      expect(review.status, JSON.stringify(review.body)).toBe(200);
    }, 120_000);

    afterAll(() => {
      sql(`
        DELETE FROM amendment_candidates WHERE change_event_id = '${ev}';
        UPDATE article_versions SET change_event_id = NULL WHERE change_event_id = '${ev}';
        DELETE FROM laws WHERE id='${lawId}'; DELETE FROM law_sources WHERE id='${sourceId}';
      `);
    });

    it('폐지 예정일 전 시행일로 후보를 승인하면 409 repealed — 버전은 그대로', async () => {
      const v = (await versionsOf(articleId)).find((x) => x.status === 'published');
      expect((await post(`/versions/${v.id}/archive`, { repealedOn: D })).status).toBe(200);
      const c = (await api(`/amendments/${candidateId}`, { token: t.token })).body;
      const r = await post(`/amendments/${candidateId}/approve`, {
        effectiveDate: E,
        changeNote: '법령 반영',
        expectedRevision: c.revision,
        expectedLockVersion: c.lockVersion,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(r.body.reason).toBe('repealed');
      expect(String(r.body.message)).toContain('폐지될 예정');
      expect((await versionsOf(articleId)).map((x) => x.status)).toEqual(['archived']);
    });
  });
});


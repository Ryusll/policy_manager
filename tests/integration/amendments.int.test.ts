import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';

/**
 * 개정 후보 생성 (T-106).
 *
 * 법제처 없이 돈다 — 법령·조항·변경 이벤트를 DB 에 직접 심는다(T-105 와 같은 방식).
 *
 * 막고 싶은 사고:
 * 1. **후보가 발행 버전을 바꾼다** — 후보는 초안일 뿐, 승인(T-108) 전에는 시행 본문이 그대로여야 한다.
 * 2. **다른 회사의 조문에 후보가 생기거나 보인다** — 법령·이벤트는 공용이고 경계는 연결(LawLink)뿐이다.
 * 3. **같은 후보가 여러 번 생긴다** — 자동 생성과 버튼이 겹치거나 다시 눌러도 하나여야 하고, 감사
 *    기록·알림도 두 번 남지 않아야 한다.
 * 4. **고칠 근거가 없는데 그럴듯하게 고친다** — 대응 문구가 없거나 참고 관계면 본문을 건드리지 않는다.
 * 5. **기준 본문을 못 찾은 이유가 묻힌다** — 시행일 미기록(T-123 이전 가져오기)과 미시행을 가른다.
 * 6. **개정의 원천이 사라진다** — 후보가 있는 법령은 추적 해제를 막는다.
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

/** 한국 날짜 — 서버의 "오늘"(todayDateOnly)이 한국 날짜다(T-126). UTC 로 만들면 한국 시간 0~9시에 하루 어긋난다 */
const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const PW = 'IntegrationTest!234';

const LAW_BEFORE = '사용자는 근로자에게 15일의 유급휴가를 주어야 한다. <개정 2012.2.1>';
const LAW_AFTER = '사용자는 근로자에게 20일의 유급휴가를 주어야 한다. <개정 2012.2.1, 2027.1.1>';

describe('T-106 개정 후보 생성', () => {
  const sourceId = randomUUID();
  const lawId = randomUUID();
  const artA = randomUUID(); // 제60조제1항 — 기준값이 바뀐 조항
  const artB = randomUUID(); // 제61조 — 연혁 표기만 바뀐 조항
  const evA = randomUUID();
  const evNoop = randomUUID();
  const evGone = randomUUID();
  const lawEffective = day(30);

  let t1: Awaited<ReturnType<typeof createTenant>>;
  let t2: Awaited<ReturnType<typeof createTenant>>;
  let viewerToken = '';
  let platformToken = '';
  const art: Record<'x' | 'y' | 'u' | 'm' | 'r' | 'w', string> = { x: '', y: '', u: '', m: '', r: '', w: '' };
  const ver = { x: randomUUID(), u: randomUUID(), m: randomUUID(), r: randomUUID(), w: randomUUID() };
  const links: Array<{ token: string; id: string }> = [];
  const candidateOf: Record<string, string> = {};

  const generate = (token: string, json: Record<string, unknown>) =>
    api('/amendments/generate', { method: 'POST', token, json });

  beforeAll(async () => {
    await waitForApi();
    t1 = await createTenant('amend-1');
    t2 = await createTenant('amend-2');

    const viewerEmail = `viewer-${t1.slug}@example.test`;
    await api('/users', { method: 'POST', token: t1.token, json: { email: viewerEmail, password: PW, name: '열람', role: 'viewer' } });
    viewerToken = (await login(viewerEmail, PW, t1.slug)).body.accessToken;

    const platform = await createTenant('amend-pf');
    sql(`UPDATE users SET platform_role='global_admin' WHERE id='${platform.user.id}';`);
    platformToken = platform.token;

    // 공용 법령 데이터. 확인 시각을 가장 오래된 값으로 둬 동기화(limit 1)가 이 법령을 고르게 한다 —
    // 가짜 법령이라 동기화 자체는 실패하지만, 끝에 붙은 개정 후보 자동 생성은 그대로 돈다
    sql(`
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, last_checked_at, updated_at)
        VALUES ('${lawId}', '${sourceId}', '900002', '990002', '개정후보시험법', '${lawEffective}', '1970-01-01', now());
      INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, label, content, version_key, sort_order, updated_at) VALUES
        ('${artA}', '${lawId}', '60/1/', 60, 1, '제60조제1항', '${LAW_AFTER}', 'v1:a2', 1, now()),
        ('${artB}', '${lawId}', '61//', 61, NULL, '제61조', '휴가는 나누어 쓸 수 있다. <개정 2012.2.1, 2027.1.1>', 'v1:b2', 2, now());
      INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, before_version_key, after_version_key, promulgated_date, law_effective_date, received_via, amendments_processed_at) VALUES
        ('${evA}', '${lawId}', '${artA}', '60/1/', 'modified', '${LAW_BEFORE}', '${LAW_AFTER}', 'v1:a1', 'v1:a2', '${day(-5)}', '${lawEffective}', 'poll', NULL),
        ('${evNoop}', '${lawId}', '${artB}', '61//', 'modified', '휴가는 나누어 쓸 수 있다. <개정 2012.2.1>', '휴가는 나누어 쓸 수 있다. <개정 2012.2.1, 2027.1.1>', 'v1:b1', 'v1:b2', NULL, NULL, 'poll', now()),
        ('${evGone}', '${lawId}', NULL, '62//', 'deleted', '대체휴가 옛 본문', NULL, 'v1:c1', NULL, NULL, NULL, 'poll', now());
    `);

    // 회사 1: 조문 다섯
    const { policy, chapter, article } = await createPolicyWithArticle(t1.token, `AMD-${Date.now().toString(36)}`, '취업규칙');
    art.x = article.id;
    const addArticle = async (number: number, title: string) =>
      (await api(`/policies/${policy.id}/chapters/${chapter.id}/articles`, {
        method: 'POST', token: t1.token, json: { number, title, content: `${title} 본문` },
      })).body.id as string;
    art.y = await addArticle(2, '초안뿐');
    art.u = await addArticle(3, '시행일 없는 시행본');
    art.m = await addArticle(4, '대응 문구 없음');
    art.r = await addArticle(5, '참고 관계');

    // X·M·R 은 시행 중, U 는 시행일 없이 시행된 본문(T-123 이전 가져오기와 같은 모양), Y 는 초안뿐
    sql(`
      DELETE FROM article_versions WHERE article_id IN ('${art.x}', '${art.u}', '${art.m}', '${art.r}');
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at) VALUES
        ('${ver.x}', '${art.x}', 1, '직원에게는 매년 15일의 연차휴가를 준다.', 'published', '2020-01-01', now()),
        ('${ver.u}', '${art.u}', 1, '휴가는 15일로 한다.', 'published', NULL, now()),
        ('${ver.m}', '${art.m}', 1, '연차휴가는 근로기준법에 따른다.', 'published', '2020-01-01', now()),
        ('${ver.r}', '${art.r}', 1, '직원 휴가는 15일을 참고해 정한다.', 'published', '2020-01-01', now());
    `);

    const link = async (token: string, lawArticleId: string, articleId: string, relationType = 'delegation') => {
      const res = await api('/law-links', { method: 'POST', token, json: { lawArticleId, articleId, relationType, evidenceText: '연차휴가 일수' } });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      links.push({ token, id: res.body.id });
    };
    for (const a of [art.x, art.y, art.u, art.m]) await link(t1.token, artA, a);
    await link(t1.token, artA, art.r, 'reference');
    await link(t1.token, artB, art.x);

    // 회사 2: 같은 법령조항에 자기 시행 조문 하나
    const other = await createPolicyWithArticle(t2.token, `AMD2-${Date.now().toString(36)}`, '다른 회사 규정');
    art.w = other.article.id;
    sql(`
      DELETE FROM article_versions WHERE article_id = '${art.w}';
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at)
        VALUES ('${ver.w}', '${art.w}', 1, '휴가는 15일로 한다.', 'published', '2020-01-01', now());
    `);
    await link(t2.token, artA, art.w);
  }, 120_000);

  afterAll(() => {
    // 후보가 이벤트를 Restrict 로 잡고 있다 — 먼저 지워야 법령(→ 이벤트·조항·연결)을 지울 수 있다
    sql(`
      DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      DELETE FROM laws WHERE id='${lawId}'; DELETE FROM law_sources WHERE id='${sourceId}';
    `);
  });

  describe('권한·입력', () => {
    it('토큰이 없으면 401, 열람자는 403 — 개정 초안은 확정 전 내부 문서다', async () => {
      expect((await api('/amendments/generate', { method: 'POST', json: { changeEventId: evA } })).status).toBe(401);
      expect((await generate(viewerToken, { changeEventId: evA })).status).toBe(403);
      expect((await api(`/amendments/${randomUUID()}`, { token: viewerToken })).status).toBe(403);
    });

    it('이벤트 id·기준일 형식이 틀리면 400, 없는 이벤트는 404', async () => {
      expect((await generate(t1.token, { changeEventId: 'abc' })).status).toBe(400);
      expect((await generate(t1.token, { changeEventId: evA, asOf: '2027/01/01' })).status).toBe(400);
      expect((await generate(t1.token, { changeEventId: evA, asOf: '2027-02-30' })).status).toBe(400);
      expect((await generate(t1.token, { changeEventId: randomUUID() })).status).toBe(404);
    });
  });

  describe('생성', () => {
    it('영향 조문마다 작성 상태의 후보를 만들고, 기준 본문이 없는 조문은 이유를 가른다', async () => {
      const { status, body } = await generate(t1.token, { changeEventId: evA });
      expect(status, JSON.stringify(body)).toBe(200);
      expect(body.asOf).toBe(lawEffective); // 시행 전 개정 — 기준일은 법령 시행일
      expect(body.created.map((c: any) => c.articleId).sort()).toEqual([art.x, art.m, art.r].sort());
      expect(body.existing).toEqual([]);
      const skipped = Object.fromEntries(body.skipped.map((s: any) => [s.articleId, s.reason]));
      expect(skipped).toEqual({ [art.y]: 'not_in_force', [art.u]: 'effective_date_missing' });
      // 다른 회사 조문에는 만들지 않는다
      expect(JSON.stringify(body)).not.toContain(art.w);
      for (const c of body.created) candidateOf[c.articleId] = c.id;
    });

    it('기준값 규칙 — 우리 조문의 같은 값만 고치고, 근거·비교·원천을 함께 남긴다', async () => {
      const { status, body } = await api(`/amendments/${candidateOf[art.x]}`, { token: t1.token });
      expect(status).toBe(200);
      expect(body.candidateContent).toBe('직원에게는 매년 20일의 연차휴가를 준다.');
      expect(body.baseVersion).toMatchObject({ id: ver.x, content: '직원에게는 매년 15일의 연차휴가를 준다.' });
      expect(body).toMatchObject({ reviewState: 'draft', confidence: 'high', reviewFlags: [], asOf: lawEffective, createdBy: t1.user.id });
      expect(body.diff.unexplained).toBe(0);
      expect(body.diff.changes).toEqual([
        expect.objectContaining({ kind: 'replace', base: expect.objectContaining({ text: '15' }), candidate: expect.objectContaining({ text: '20' }), rationaleRefs: [0] }),
      ]);
      expect(body.rationale.law).toMatchObject({ lawName: '개정후보시험법', label: '제60조제1항', beforeVersionKey: 'v1:a1', afterVersionKey: 'v1:a2' });
      expect(body.rationale.link).toMatchObject({ relationType: 'delegation', evidenceText: '연차휴가 일수', confirmState: 'confirmed' });
      expect(body.rationale.path.map((p: any) => p.label)).toEqual(['개정후보시험법 제60조제1항', 'delegation', '취업규칙 제1조']);
      expect(body.rationale.applications[0]).toMatchObject({ ruleId: 'VALUE_CHANGE', templateId: 'INLINE_REPLACE' });
      expect(body.generationMeta).toMatchObject({
        engine: 'rule/1',
        trigger: 'user',
        rules: [{ id: 'VALUE_CHANGE', version: 1 }],
        templates: [{ id: 'INLINE_REPLACE', version: 1 }],
        source: { changeEventId: evA, baseVersionId: ver.x, articleId: art.x, beforeVersionKey: 'v1:a1', afterVersionKey: 'v1:a2' },
      });
      expect(body.event).toMatchObject({ id: evA, lawId, lawEffectiveDate: lawEffective });
    });

    it('후보는 발행 본문을 바꾸지 않는다 — 시행 본문·버전 수 그대로', () => {
      expect(sql(`SELECT count(*) || '|' || max(content) FROM article_versions WHERE article_id='${art.x}';`)).toBe(
        '1|직원에게는 매년 15일의 연차휴가를 준다.',
      );
    });

    it('대응 문구가 없거나 참고 관계면 본문은 그대로 — 사람이 직접 고쳐야 한다고 표시한다', async () => {
      const m = (await api(`/amendments/${candidateOf[art.m]}`, { token: t1.token })).body;
      expect(m.candidateContent).toBe('연차휴가는 근로기준법에 따른다.');
      expect(m.reviewFlags).toEqual(expect.arrayContaining(['manual_draft_required', 'unmapped_law_change']));
      expect(m.confidence).toBe('low');
      expect(m.rationale.unmapped).toEqual([expect.objectContaining({ reason: 'no_correspondence' })]);

      const r = (await api(`/amendments/${candidateOf[art.r]}`, { token: t1.token })).body;
      expect(r.candidateContent).toBe('직원 휴가는 15일을 참고해 정한다.');
      expect(r.reviewFlags).toEqual(expect.arrayContaining(['relation_review_only', 'manual_draft_required']));
    });

    it('다시 만들면 새로 만들지 않고 있던 후보를 돌려준다 — 감사 기록도 한 번뿐', async () => {
      const again = await generate(t1.token, { changeEventId: evA });
      expect(again.status).toBe(200);
      expect(again.body.created).toEqual([]);
      expect(again.body.existing.map((c: any) => c.id).sort()).toEqual(Object.values(candidateOf).sort());
      expect(sql(`SELECT count(*) FROM amendment_candidates WHERE tenant_id='${t1.user.tenantId}';`)).toBe('3');

      const logs = await api('/audit-logs?action=amendment.generate', { token: t1.token });
      expect(logs.body.total).toBe(1);
      const detail = await api(`/audit-logs/${logs.body.rows[0].id}`, { token: t1.token });
      expect(detail.body.details).toMatchObject({ trigger: 'user', ruleset: 'rule/1', beforeVersionKey: 'v1:a1', afterVersionKey: 'v1:a2' });
      expect(detail.body.details.candidates).toHaveLength(3);
    });

    it('지정한 기준일에 시행 중인 본문이 없으면 만들지 않는다', async () => {
      const { body } = await generate(t1.token, { changeEventId: evA, asOf: '2019-12-31' });
      expect(body.asOf).toBe('2019-12-31');
      expect(body.created).toEqual([]);
      expect(body.skipped.find((s: any) => s.articleId === art.x)?.reason).toBe('not_in_force');
    });

    it('연혁 표기만 바뀐 개정, 법령에서 사라진 조문은 후보가 없다', async () => {
      const noop = await generate(t1.token, { changeEventId: evNoop });
      expect(noop.body).toMatchObject({ noSubstantiveChange: true, created: [] });
      const gone = await generate(t1.token, { changeEventId: evGone });
      expect(gone.body.created).toEqual([]);
      expect(gone.body.unresolvable).toMatch(/사라져/);
    });
  });

  describe('회사 경계', () => {
    it('다른 회사의 후보는 404 — 있는지조차 알 수 없다', async () => {
      expect((await api(`/amendments/${candidateOf[art.x]}`, { token: t2.token })).status).toBe(404);
      expect((await api(`/amendments/${randomUUID()}`, { token: t1.token })).status).toBe(404);
    });

    it('영향 화면은 조문마다 우리 회사 후보를 붙이고, 기준 본문이 없는 이유를 보여 준다', async () => {
      const { body } = await api(`/law-changes/${evA}/impact`, { token: t1.token });
      const byArticle = Object.fromEntries(body.impacted.map((i: any) => [i.article.id, i]));
      expect(byArticle[art.x].candidate).toMatchObject({ id: candidateOf[art.x], isCurrentBase: true, confidence: 'high' });
      expect(byArticle[art.x].candidate.diff.parts.some((p: any) => p.op === 'insert' && p.text === '20')).toBe(true);
      expect(byArticle[art.y]).toMatchObject({ candidate: null, skipReason: 'not_in_force' });
      expect(byArticle[art.u]).toMatchObject({ candidate: null, skipReason: 'effective_date_missing' });

      const other = await api(`/law-changes/${evA}/impact`, { token: t2.token });
      expect(other.body.impacted).toHaveLength(1);
      expect(other.body.impacted[0].candidate).toBeNull(); // 회사 2 는 아직 만들지 않았다
    });
  });

  describe('자동 생성 — 법령 동기화가 끝날 때', () => {
    it('처리하지 않은 이벤트로 회사마다 후보를 만들고 검토 권한자에게 한 번 알린다', async () => {
      const run = await api('/platform-admin/law-sync/run', { method: 'POST', token: platformToken, json: { limit: 1 } });
      expect(run.status, JSON.stringify(run.body)).toBeLessThan(300);
      expect(run.body.amendments).toMatchObject({ failed: 0 });
      expect(run.body.amendments.created).toBeGreaterThanOrEqual(1);

      // 회사 2 에 후보가 생겼다(만든 사람 없음 = 자동). 회사 1 은 이미 있어 늘지 않는다
      expect(sql(`SELECT count(*) || '|' || coalesce(max(created_by), 'system') FROM amendment_candidates WHERE tenant_id='${t2.user.tenantId}';`)).toBe('1|system');
      expect(sql(`SELECT count(*) FROM amendment_candidates WHERE tenant_id='${t1.user.tenantId}';`)).toBe('3');
      expect(sql(`SELECT amendments_processed_at IS NOT NULL FROM law_change_events WHERE id='${evA}';`)).toBe('t');

      const notes = (await api('/notifications', { token: t2.token })).body.filter((n: any) => n.kind === 'law_amendment');
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ title: '[법령 개정] 개정후보시험법 제60조제1항', link: `/laws/${lawId}?change=${evA}` });
      expect(notes[0].body).toContain('우리 조문 1곳에 개정 후보를 만들었습니다.');
      // 회사 1 은 새로 만든 것이 없어 알림도 없다
      const t1Notes = (await api('/notifications', { token: t1.token })).body.filter((n: any) => n.kind === 'law_amendment');
      expect(t1Notes).toEqual([]);

      const logs = await api('/audit-logs?action=amendment.generate', { token: t2.token });
      const detail = await api(`/audit-logs/${logs.body.rows[0].id}`, { token: t2.token });
      expect(detail.body.details.trigger).toBe('system');
    });

    it('다시 돌아도 같은 후보·알림이 또 생기지 않는다', async () => {
      sql(`UPDATE law_change_events SET amendments_processed_at = NULL WHERE id='${evA}'; UPDATE laws SET last_checked_at='1970-01-01' WHERE id='${lawId}';`);
      const run = await api('/platform-admin/law-sync/run', { method: 'POST', token: platformToken, json: { limit: 1 } });
      expect(run.status).toBeLessThan(300);
      expect(sql(`SELECT count(*) FROM amendment_candidates WHERE change_event_id='${evA}';`)).toBe('4');
      const notes = (await api('/notifications', { token: t2.token })).body.filter((n: any) => n.kind === 'law_amendment');
      expect(notes).toHaveLength(1);
    });
  });

  describe('개정 원천 보존', () => {
    it('연결을 지워도 후보와 그때의 근거는 남고, 후보가 있는 법령은 추적 해제를 막는다', async () => {
      for (const l of links) expect((await api(`/law-links/${l.id}`, { method: 'DELETE', token: l.token })).status).toBeLessThan(300);
      const kept = (await api(`/amendments/${candidateOf[art.x]}`, { token: t1.token })).body;
      expect(kept.lawLinkId).toBeNull();
      expect(kept.rationale.link).toMatchObject({ relationType: 'delegation', evidenceText: '연차휴가 일수' });

      const del = await api(`/laws/${lawId}`, { method: 'DELETE', token: t1.token });
      expect(del.status).toBe(409);
      expect(del.body.message).toMatch(/개정 후보/);
      expect(sql(`SELECT count(*) FROM laws WHERE id='${lawId}';`)).toBe('1');
    });
  });
});

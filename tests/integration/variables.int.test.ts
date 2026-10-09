import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';

/**
 * 변수 값·유효기간과 본문 위치 연결 (T-109 ①, 특허 청구항 5·9, 도 9).
 *
 * 막고 싶은 사고:
 * 1. 같은 날 값이 둘이거나 기간을 모르는 값으로 조용히 아무 값이나 고른다
 * 2. 발행 본문에 `{{KEY}}` 가 그대로 나가거나, 값이 바뀐 뒤 검토 때와 다른 문구가 발행된다
 * 3. 문구를 고친 뒤에도 연결이 엉뚱한 자리를 가리킨다(같은 문구가 여러 번 나올 때 특히)
 * 4. 새 버전을 발행하면 연결이 사라지거나, 옛 위치 그대로 남는다
 * 5. 다른 회사 변수·연결을 보거나 고친다
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

/** 한국 날짜 — 서버의 "오늘"과 같은 날 */
const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const PW = 'IntegrationTest!234';
const A_TEXT = '업무는 운영팀이 정한다. 다만 긴급한 경우 운영팀의 장이 정한다.';
const D_TEXT = '직원에게는 매년 15일의 연차휴가를 주고, 운영팀이 관리한다.';
const F_TEXT = '직원에게는 매년 15일의 연차휴가를 주고, {{DEPT}}이 관리한다.';

describe('T-109 변수 값·유효기간과 본문 위치 연결', () => {
  const sourceId = randomUUID();
  const lawId = randomUUID();
  const lawArt = randomUUID();
  const ev = randomUUID();
  const E = day(30);
  const today = day(0);

  let t1: Awaited<ReturnType<typeof createTenant>>;
  let t2: Awaited<ReturnType<typeof createTenant>>;
  let editorToken = '';
  let viewerToken = '';
  let policyId = '';
  let policy2Id = '';
  const art = {} as Record<'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h', string>;
  const ver = {} as Record<'a1' | 'd1' | 'f1' | 'g1' | 'h1', string>;
  let policy3Id = '';
  const vars = {} as Record<'dept' | 'later' | 'empty' | 'over', string>;
  const vals = {} as Record<'ops' | 'mgmt', string>;
  let candF = '';

  const post = (path: string, json?: Record<string, unknown>, token = t1.token) =>
    api(path, { method: 'POST', token, json: json ?? {} });
  const put = (path: string, json: Record<string, unknown>, token = t1.token) => api(path, { method: 'PUT', token, json });
  const content = (id: string) => sql(`SELECT content FROM article_versions WHERE id='${id}';`);
  const bindingsOf = (versionId: string) =>
    sql(`SELECT coalesce(string_agg(b.origin || ':' || b.state || ':' || b.start || '-' || b."end" || ':' || b.text || ':' ||
           (substr(v.content, b.start + 1, b."end" - b.start) = b.text), ',' ORDER BY b.start, b.created_at), '') FROM variable_bindings b
           JOIN article_versions v ON v.id = b.version_id WHERE b.version_id='${versionId}' AND b.state <> 'released';`);
  const draftOf = async (articleId: string, text: string) => {
    const r = await post(`/articles/${articleId}/versions`, { content: text, changeNote: '개정' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  const submit = (id: string) => post(`/versions/${id}/submit`);
  const approve = (id: string, effectiveDate: string) => post(`/versions/${id}/approve`, { changeNote: '개정', effectiveDate });

  beforeAll(async () => {
    await waitForApi();
    t1 = await createTenant('vars-1');
    t2 = await createTenant('vars-2');
    const member = async (role: 'editor' | 'viewer') => {
      const email = `${role}-${t1.slug}@example.test`;
      await api('/users', { method: 'POST', token: t1.token, json: { email, password: PW, name: role, role } });
      return (await login(email, PW, t1.slug)).body.accessToken as string;
    };
    editorToken = await member('editor');
    viewerToken = await member('viewer');

    const p1 = await createPolicyWithArticle(t1.token, `VAR-${Date.now().toString(36)}`, '업무분장규정');
    policyId = p1.policy.id;
    art.a = p1.article.id;
    for (const [n, k] of (['b', 'd', 'f', 'h'] as const).entries()) {
      art[k] = (await post(`/policies/${policyId}/chapters/${p1.chapter.id}/articles`, { number: n + 2, title: `조문 ${k}`, content: '본문' })).body.id;
    }
    const p2 = await createPolicyWithArticle(t1.token, `VAR2-${Date.now().toString(36)}`, '복무규정');
    policy2Id = p2.policy.id;
    art.c = p2.article.id;
    art.e = (await post(`/policies/${policy2Id}/chapters/${p2.chapter.id}/articles`, { number: 2, title: '새 조문', content: '표식 없는 새 조문' })).body.id;
    const p3 = await createPolicyWithArticle(t1.token, `VAR3-${Date.now().toString(36)}`, '재시행규정');
    policy3Id = p3.policy.id;
    art.g = p3.article.id;

    for (const k of ['a1', 'd1', 'f1', 'g1', 'h1'] as const) ver[k] = randomUUID();
    sql(`
      DELETE FROM article_versions WHERE article_id IN ('${art.a}', '${art.b}', '${art.d}', '${art.f}', '${art.g}', '${art.h}');
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at) VALUES
        ('${ver.a1}', '${art.a}', 1, '${A_TEXT}', 'published', '2025-03-01', now()),
        ('${ver.d1}', '${art.d}', 1, '${D_TEXT}', 'published', '2020-01-01', now()),
        ('${ver.f1}', '${art.f}', 1, '${F_TEXT}', 'published', '2020-01-01', now()),
        ('${ver.g1}', '${art.g}', 1, '업무는 운영팀이 정한다.', 'published', '2025-03-01', now()),
        ('${ver.h1}', '${art.h}', 1, '운영팀이 맡는다.', 'published', '2025-03-01', now());
      UPDATE article_versions SET content = '{{DEPT}}이 맡는다.' WHERE article_id = '${art.c}';
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, updated_at)
        VALUES ('${lawId}', '${sourceId}', '900109', '990109', '변수시험법', '${E}', now());
      INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, label, content, version_key, sort_order, updated_at)
        VALUES ('${lawArt}', '${lawId}', '60/1/', 60, 1, '제60조제1항', '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.', 'v1:p2', 1, now());
      INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, before_version_key, after_version_key, law_effective_date, received_via, amendments_processed_at)
        VALUES ('${ev}', '${lawId}', '${lawArt}', '60/1/', 'modified', '사용자는 근로자에게 15일의 유급휴가를 주어야 한다.', '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.', 'v1:p1', 'v1:p2', '${E}', 'poll', now());
    `);
    for (const k of ['d', 'f'] as const) {
      const link = await post('/law-links', { lawArticleId: lawArt, articleId: art[k], relationType: 'delegation', evidenceText: '연차휴가 일수' });
      expect(link.status, JSON.stringify(link.body)).toBe(201);
    }
  });

  afterAll(() => {
    // 심은 법령을 남기면 법령 동기화가 그것부터 확인하려 든다
    sql(`
      DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      UPDATE article_versions SET change_event_id = NULL WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      DELETE FROM laws WHERE id='${lawId}'; DELETE FROM law_sources WHERE id='${sourceId}';
    `);
  });

  describe('값과 유효기간', () => {
    it('등록하며 첫 값과 시작일을 넣고, 값을 기간별로 더한다 — 오늘 쓸 값', async () => {
      const r = await post('/variables', { key: 'DEPT', label: '담당 부서', value: '운영팀', validFrom: '2025-01-01' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      vars.dept = r.body.id;
      const ops = (await api(`/variables/${vars.dept}`, { token: t1.token })).body.values[0];
      vals.ops = ops.id;
      expect(ops).toMatchObject({ value: '운영팀', validFrom: '2025-01-01', validTo: null, periodConfirmed: true });
      // 운영팀은 2026-07-01 까지(그날 미포함), 관리팀은 그날부터
      expect((await put(`/variables/${vars.dept}/values/${vals.ops}`, { validTo: '2026-07-01' })).status).toBe(200);
      const add = await post(`/variables/${vars.dept}/values`, { value: '관리팀', validFrom: '2026-07-01' }, editorToken);
      expect(add.status, JSON.stringify(add.body)).toBe(201);
      expect(add.body.changedOverlaps).toBe(false);
      vals.mgmt = add.body.values.find((v: any) => v.value === '관리팀').id;
      const list = (await api('/variables', { token: t1.token })).body;
      expect(list.find((v: any) => v.id === vars.dept)).toMatchObject({ current: { value: '관리팀' }, needsReview: false });
    });

    it('기간이 겹치면 저장은 하되 검토 필요로 — 그 날짜엔 아무 값도 고르지 않는다', async () => {
      const r = await post('/variables', { key: 'OVER', label: '겹침' });
      vars.over = r.body.id;
      await post(`/variables/${vars.over}/values`, { value: '가', validFrom: '2025-01-01' });
      const b = await post(`/variables/${vars.over}/values`, { value: '나', validFrom: '2026-01-01' });
      expect(b.body.changedOverlaps).toBe(true);
      const v = (await api(`/variables/${vars.over}`, { token: t1.token })).body;
      expect(v).toMatchObject({ needsReview: true, current: null, currentReason: 'ambiguous' });
      expect(v.values.every((x: any) => x.overlapping)).toBe(true);
    });

    it('기간 미확정 값(옛 기본값)은 고르지 않다가, 기간을 확정하면 쓴다', async () => {
      const r = await post('/variables', { key: 'LATER', label: '옛 기본값' });
      vars.later = r.body.id;
      const id = randomUUID();
      sql(`INSERT INTO variable_values (id, tenant_id, variable_id, value, period_confirmed, updated_at)
           SELECT '${id}', tenant_id, id, '총무팀', false, now() FROM variables WHERE id='${vars.later}';`);
      expect((await api(`/variables/${vars.later}`, { token: t1.token })).body).toMatchObject({ current: null, currentReason: 'unconfirmed', needsReview: true });
      expect((await put(`/variables/${vars.later}/values/${id}`, { confirmPeriod: true })).status).toBe(200);
      expect((await api(`/variables/${vars.later}`, { token: t1.token })).body).toMatchObject({ current: { value: '총무팀' }, needsReview: false });
    });

    it('입력 검증 — 종료일이 시작일보다 앞서거나 같으면, 날짜 형식이 틀리면 400', async () => {
      expect((await post(`/variables/${vars.dept}/values`, { value: 'x', validFrom: '2026-01-01', validTo: '2026-01-01' })).status).toBe(400);
      expect((await post(`/variables/${vars.dept}/values`, { value: 'x', validFrom: '2026/01/01' })).status).toBe(400);
      expect((await post(`/variables/${vars.dept}/values`, { value: '  ' })).status).toBe(400);
    });

    it('권한 — 열람자는 고칠 수 없고, 다른 회사는 404', async () => {
      expect((await post(`/variables/${vars.dept}/values`, { value: 'x' }, viewerToken)).status).toBe(403);
      expect((await api('/variables', { token: viewerToken })).status).toBe(200);
      expect((await api(`/variables/${vars.dept}`, { token: t2.token })).status).toBe(404);
      expect((await post(`/variables/${vars.dept}/values`, { value: 'x' }, t2.token)).status).toBe(404);
      expect((await put(`/variables/${vars.dept}/values/${vals.ops}`, { value: 'x' }, t2.token)).status).toBe(404);
    });
  });

  describe('문구를 골라 잇기', () => {
    const second = A_TEXT.lastIndexOf('운영팀');

    it('같은 문구 중 두 번째 자리를 잇는다 — 순번·문맥, 그 시행일 값이면 직전 적용값으로', async () => {
      const r = await post(`/versions/${ver.a1}/variable-bindings`, { variableId: vars.dept, start: second, end: second + 3, text: '운영팀' }, editorToken);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toMatchObject({ origin: 'manual', state: 'active', occurrence: 1, valueId: vals.ops, contextAfter: '의 장이 정한다.' });
      const v = (await api(`/variables/${vars.dept}`, { token: t1.token })).body;
      expect(v.bindings).toEqual([expect.objectContaining({ text: '운영팀', occurrence: 1, versionNum: 1, article: expect.objectContaining({ label: '제1조' }) })]);
      expect((await api('/variables', { token: t1.token })).body.find((x: any) => x.id === vars.dept).bindingCount).toBe(1);
    });

    it('본문과 다른 문구·겹치는 구간·앞뒤 공백·초안 버전은 거부', async () => {
      const first = A_TEXT.indexOf('운영팀');
      expect((await post(`/versions/${ver.a1}/variable-bindings`, { variableId: vars.dept, start: first, end: first + 3, text: '관리팀' })).status).toBe(409);
      expect((await post(`/versions/${ver.a1}/variable-bindings`, { variableId: vars.dept, start: second + 1, end: second + 4, text: A_TEXT.slice(second + 1, second + 4) })).status).toBe(409);
      expect((await post(`/versions/${ver.a1}/variable-bindings`, { variableId: vars.dept, start: first - 1, end: first + 3, text: ` 운영팀` })).status).toBe(400);
      const draft = await draftOf(art.b, '초안 운영팀');
      expect((await post(`/versions/${draft}/variable-bindings`, { variableId: vars.dept, start: 3, end: 6, text: '운영팀' })).status).toBe(409);
      sql(`DELETE FROM article_versions WHERE id='${draft}';`);
    });

    it('권한·회사 — 열람자 403, 다른 회사 404(버전도 변수도)', async () => {
      const first = A_TEXT.indexOf('운영팀');
      const body = { variableId: vars.dept, start: first, end: first + 3, text: '운영팀' };
      expect((await post(`/versions/${ver.a1}/variable-bindings`, body, viewerToken)).status).toBe(403);
      expect((await post(`/versions/${ver.a1}/variable-bindings`, body, t2.token)).status).toBe(404);
      const otherVar = (await post('/variables', { key: 'DEPT', label: '부서' }, t2.token)).body.id;
      expect(otherVar).toBeTruthy();
      expect((await post(`/versions/${ver.a1}/variable-bindings`, { ...body, variableId: otherVar })).status).toBe(404);
      expect((await api(`/versions/${ver.a1}/variable-bindings`, { token: t2.token })).status).toBe(404);
    });
  });

  describe('검토 요청 때 표식을 값으로', () => {
    let b2 = '';

    it('등록된 변수의 표식만 오늘 값으로 바꾸고 그 자리를 잇는다(같은 표식 두 번)', async () => {
      b2 = await draftOf(art.b, '{{DEPT}}이 정하고 {{DEPT}}의 장이 맡는다. {{NOPE}}는 그대로.');
      const r = await submit(b2);
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
      expect(content(b2)).toBe('관리팀이 정하고 관리팀의 장이 맡는다. {{NOPE}}는 그대로.');
      expect(bindingsOf(b2)).toBe('marker:active:0-3:관리팀:true,marker:active:9-12:관리팀:true');
      expect(sql(`SELECT details->'variables'->0->>'value' FROM audit_logs WHERE entity_id='${b2}' AND action='version.submit_review';`)).toBe('관리팀');
    });

    it('값을 고를 수 없는 표식이 있으면 아무것도 바꾸지 않고 400 — 값 없음·겹침', async () => {
      const r1 = await post('/variables', { key: 'EMPTY', label: '빈 변수' });
      vars.empty = r1.body.id;
      const d1 = await draftOf(art.b, '{{DEPT}}과 {{EMPTY}}');
      const res = await submit(d1);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('{{EMPTY}}(빈 변수) — 그 날짜에 맞는 값이 없음');
      expect(content(d1)).toBe('{{DEPT}}과 {{EMPTY}}');
      expect(sql(`SELECT status FROM article_versions WHERE id='${d1}';`)).toBe('draft');
      const d2 = await draftOf(art.b, '{{OVER}}');
      expect((await submit(d2)).body.message).toContain('기간 겹침');
      sql(`DELETE FROM article_versions WHERE id IN ('${d1}', '${d2}');`);
    });

    it('승인 때 그 시행일 값이 검토 요청 때와 다르면 400, 같은 날이면 발행', async () => {
      // 오늘은 관리팀이지만 30일 뒤부터는 지원팀
      expect((await put(`/variables/${vars.dept}/values/${vals.mgmt}`, { validTo: day(30) })).status).toBe(200);
      expect((await post(`/variables/${vars.dept}/values`, { value: '지원팀', validFrom: day(30) })).status).toBe(201);
      const late = await approve(b2, day(31));
      expect(late.status, JSON.stringify(late.body)).toBe(400);
      expect(late.body.message).toContain('담당 부서 "관리팀" → "지원팀"');
      expect(sql(`SELECT status FROM article_versions WHERE id='${b2}';`)).toBe('review');
      const ok = await approve(b2, today);
      expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300);
    });

    it('반려된 초안을 고치면 연결 위치를 옮기고, 그 문구를 고치면 "다시 이어야 함"', async () => {
      const d = await draftOf(art.b, '{{DEPT}}이 맡는다.');
      expect((await submit(d)).status).toBeLessThan(300);
      expect((await post(`/versions/${d}/reject`, { reason: '앞에 문장 추가' })).status).toBeLessThan(300);
      const moved = '이 조의 업무는 관리팀이 맡는다.';
      expect((await put(`/versions/${d}`, { content: moved })).status).toBe(200);
      expect(bindingsOf(d)).toBe(`marker:active:${moved.indexOf('관리팀')}-${moved.indexOf('관리팀') + 3}:관리팀:true`);
      expect((await put(`/versions/${d}`, { content: '이 조의 업무는 총괄팀이 맡는다.' })).status).toBe(200);
      expect(sql(`SELECT state || ':' || review_reason FROM variable_bindings WHERE version_id='${d}';`)).toBe('needs_review:span_changed');
      sql(`DELETE FROM article_versions WHERE id='${d}';`);
    });

    it('표식이 남은 초안은 한꺼번에 시행·일괄 가져오기로 바로 시행하지 않는다', async () => {
      const bulk = await post(`/policies/${policy2Id}/publish-drafts`, { changeNote: '제정', effectiveDate: today });
      expect(bulk.status, JSON.stringify(bulk.body)).toBe(400);
      expect(bulk.body.message).toContain('제1조');
      expect(sql(`SELECT count(*) FROM article_versions WHERE article_id IN ('${art.c}', '${art.e}') AND status = 'published';`)).toBe('0');
      const imp = await post('/admin/import/policies', {
        policies: [{ code: `IMP-${Date.now().toString(36)}`, title: '가져온 규정', effectiveDate: today, articles: [{ number: 1, title: '목적', content: '{{DEPT}}이 정한다.', publish: true }] }],
      });
      expect(imp.status, JSON.stringify(imp.body)).toBe(400);
      expect(imp.body.message).toContain('변수 표식');
    });

    it('예전에 표식을 남긴 채 검토 요청된 버전은 승인하지 않는다', async () => {
      const legacy = randomUUID();
      sql(`INSERT INTO article_versions (id, article_id, version_num, content, status, updated_at)
           SELECT '${legacy}', '${art.b}', max(version_num) + 1, '{{DEPT}}이 정한다.', 'review', now() FROM article_versions WHERE article_id='${art.b}';`);
      const r = await approve(legacy, today);
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.message).toContain('변수 표식');
      expect(sql(`SELECT status FROM article_versions WHERE id='${legacy}';`)).toBe('review');
      sql(`DELETE FROM article_versions WHERE id='${legacy}';`);
    });
  });

  describe('새 버전을 발행하면 연결을 옮긴다', () => {
    it('일반 승인 — 앞에 문장이 붙어도 같은 자리로, 옛 연결은 이력으로 남는다', async () => {
      const v2 = await draftOf(art.a, `제1항 이 규정은 업무분장을 정한다. ${A_TEXT}`);
      expect((await submit(v2)).status).toBeLessThan(300);
      expect((await approve(v2, today)).status).toBeLessThan(300);
      const shifted = `제1항 이 규정은 업무분장을 정한다. ${A_TEXT}`.lastIndexOf('운영팀');
      expect(bindingsOf(v2)).toBe(`inherited:active:${shifted}-${shifted + 3}:운영팀:true`);
      expect(sql(`SELECT count(*) FROM variable_bindings c JOIN variable_bindings p ON p.id = c.parent_id WHERE c.version_id='${v2}' AND p.version_id='${ver.a1}';`)).toBe('1');
      expect(bindingsOf(ver.a1)).toBe(`manual:active:${A_TEXT.lastIndexOf('운영팀')}-${A_TEXT.lastIndexOf('운영팀') + 3}:운영팀:true`);
      // 지금 시행본 기준으로 보이고 센다(제1조는 v2 의 연결 하나 — 내려간 v1 의 연결은 이력이라 빼고, 제2조 시행본의 둘)
      const listed = (await api(`/variables/${vars.dept}`, { token: t1.token })).body.bindings.filter((b: any) => b.articleId === art.a);
      expect(listed).toEqual([expect.objectContaining({ versionNum: 2 })]);
      expect((await api('/variables', { token: t1.token })).body.find((x: any) => x.id === vars.dept).bindingCount).toBe(3);
    });

    it('이은 문구를 바꿔 발행하면 "다시 이어야 함"으로 옮긴다(조용히 지우지 않는다)', async () => {
      const cur = sql(`SELECT id FROM article_versions WHERE article_id='${art.a}' AND status='published';`);
      const v3 = await draftOf(art.a, content(cur).replace(/운영팀의 장/, '총괄팀의 장'));
      expect((await submit(v3)).status).toBeLessThan(300);
      expect((await approve(v3, today)).status).toBeLessThan(300);
      expect(sql(`SELECT origin || ':' || state || ':' || review_reason || ':' || text FROM variable_bindings WHERE version_id='${v3}';`)).toBe('inherited:needs_review:span_changed:운영팀');
      const listed = (await api(`/versions/${v3}/variable-bindings`, { token: t1.token })).body;
      expect(listed).toEqual([expect.objectContaining({ state: 'needs_review', text: '운영팀' })]);
    });

    it('개정 후보 승인 — 후보가 고친 곳과 떨어진 연결은 그대로 옮긴다', async () => {
      const at = D_TEXT.indexOf('운영팀');
      expect((await post(`/versions/${ver.d1}/variable-bindings`, { variableId: vars.dept, start: at, end: at + 3, text: '운영팀' })).status).toBe(201);
      const g = await post('/amendments/generate', { changeEventId: ev });
      expect(g.status, JSON.stringify(g.body)).toBe(200);
      const cand = g.body.created.find((c: any) => c.articleId === art.d).id;
      candF = g.body.created.find((c: any) => c.articleId === art.f).id;
      const lock = async () => {
        const b = (await api(`/amendments/${cand}`, { token: t1.token })).body;
        return { expectedRevision: b.revision, expectedLockVersion: b.lockVersion };
      };
      expect((await post(`/amendments/${cand}/review`, await lock(), editorToken)).status).toBe(200);
      const ok = await post(`/amendments/${cand}/approve`, { effectiveDate: E, changeNote: '법령 개정 반영', ...(await lock()) });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const v2 = ok.body.resultVersion.id;
      expect(content(v2)).toBe('직원에게는 매년 20일의 연차휴가를 주고, 운영팀이 관리한다.');
      expect(bindingsOf(v2)).toBe(`inherited:active:${at}-${at + 3}:운영팀:true`);
    });

    it('개정 후보 승인 — 기준 본문에 표식이 남아 있던 조문은 발행하지 않는다', async () => {
      const lock = async () => {
        const b = (await api(`/amendments/${candF}`, { token: t1.token })).body;
        return { expectedRevision: b.revision, expectedLockVersion: b.lockVersion };
      };
      expect((await post(`/amendments/${candF}/review`, await lock(), editorToken)).status).toBe(200);
      const r = await post(`/amendments/${candF}/approve`, { effectiveDate: E, changeNote: '법령 개정 반영', ...(await lock()) });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.message).toContain('변수 표식');
      expect(sql(`SELECT count(*) FROM article_versions WHERE article_id='${art.f}';`)).toBe('1');
    });

    it('폐지한 조문을 한꺼번에 시행으로 다시 시행해도 폐지한 버전의 연결을 옮긴다', async () => {
      const at = '업무는 운영팀이 정한다.'.indexOf('운영팀');
      expect((await post(`/versions/${ver.g1}/variable-bindings`, { variableId: vars.dept, start: at, end: at + 3, text: '운영팀' })).status).toBe(201);
      expect((await post(`/versions/${ver.g1}/archive`)).status).toBe(200);
      const g2 = await draftOf(art.g, '이 규정의 업무는 운영팀이 정한다.');
      const r = await post(`/policies/${policy3Id}/publish-drafts`, { changeNote: '다시 시행', effectiveDate: today });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const moved = '이 규정의 업무는 운영팀이 정한다.'.indexOf('운영팀');
      expect(bindingsOf(g2)).toBe(`inherited:active:${moved}-${moved + 3}:운영팀:true`);
    });
  });

  describe('연결 풀기', () => {
    it('풀면 목록에서 빠지고 이력으로 남는다 — 다른 회사는 404', async () => {
      const cur = sql(`SELECT id FROM article_versions WHERE article_id='${art.d}' AND status='published';`);
      const id = sql(`SELECT id FROM variable_bindings WHERE version_id='${cur}';`);
      expect((await api(`/variable-bindings/${id}`, { method: 'DELETE', token: t2.token })).status).toBe(404);
      expect((await api(`/variable-bindings/${id}`, { method: 'DELETE', token: editorToken })).status).toBe(200);
      expect(sql(`SELECT state FROM variable_bindings WHERE id='${id}';`)).toBe('released');
      expect((await api(`/versions/${cur}/variable-bindings`, { token: t1.token })).body).toEqual([]);
      expect(sql(`SELECT count(*) FROM audit_logs WHERE action='variable.binding.release' AND details->>'bindingId'='${id}';`)).toBe('1');
    });
  });

  describe('동시 처리', () => {
    it('발행이 옛 시행본을 내리는 사이 그 버전에 이으면 409 — 내려간 버전에 연결이 남지 않는다(조문 잠금)', async () => {
      const v2 = await draftOf(art.h, '운영팀이 맡는다. 다만 긴급하면 본부장이 맡는다.');
      expect((await submit(v2)).status).toBeLessThan(300);
      const fn = `it_slow_publish_${v2.slice(0, 8)}`;
      sql(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
             BEGIN IF NEW.id = '${v2}' AND NEW.status = 'published' THEN PERFORM pg_sleep(1.5); END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
           CREATE TRIGGER ${fn} BEFORE UPDATE ON article_versions FOR EACH ROW EXECUTE FUNCTION ${fn}();`);
      let approved: Awaited<ReturnType<typeof api>>;
      let bound: Awaited<ReturnType<typeof api>>;
      try {
        const approving = approve(v2, today);
        await new Promise((resolve) => setTimeout(resolve, 400));
        [approved, bound] = await Promise.all([
          approving,
          post(`/versions/${ver.h1}/variable-bindings`, { variableId: vars.dept, start: 0, end: 3, text: '운영팀' }),
        ]);
      } finally {
        sql(`DROP TRIGGER IF EXISTS ${fn} ON article_versions; DROP FUNCTION IF EXISTS ${fn}();`);
      }
      expect(approved.status, JSON.stringify(approved.body)).toBeLessThan(300);
      expect(bound.status, JSON.stringify(bound.body)).toBe(409);
      expect(bindingsOf(ver.h1)).toBe('');
    });

    it('승인이 값을 다시 보는 동안 값이 바뀌면 바뀐 값으로 판단한다(변수 잠금)', async () => {
      const d = await draftOf(art.b, '{{LATER}}이 맡는다.');
      expect((await submit(d)).status).toBeLessThan(300);
      const valueId = sql(`SELECT id FROM variable_values WHERE variable_id='${vars.later}';`);
      const fn = `it_slow_value_${valueId.slice(0, 8)}`;
      // 값 고치기가 변수를 잠근 채 오래 머물도록 값 저장을 1.5초 늦추는 테스트용 트리거 — 잠금이 없으면 승인이 옛 값을
      // 보고 통과해, 시행일에 맞지 않는 값이 발행된다
      sql(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
             BEGIN IF NEW.id = '${valueId}' THEN PERFORM pg_sleep(1.5); END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
           CREATE TRIGGER ${fn} BEFORE UPDATE ON variable_values FOR EACH ROW EXECUTE FUNCTION ${fn}();`);
      let edited: Awaited<ReturnType<typeof api>>;
      let approved: Awaited<ReturnType<typeof api>>;
      try {
        const editing = put(`/variables/${vars.later}/values/${valueId}`, { validTo: today });
        await new Promise((resolve) => setTimeout(resolve, 400));
        [edited, approved] = await Promise.all([editing, approve(d, today)]);
      } finally {
        sql(`DROP TRIGGER IF EXISTS ${fn} ON variable_values; DROP FUNCTION IF EXISTS ${fn}();`);
      }
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(approved.status, JSON.stringify(approved.body)).toBe(400);
      expect(sql(`SELECT status FROM article_versions WHERE id='${d}';`)).toBe('review');
    });
  });
});

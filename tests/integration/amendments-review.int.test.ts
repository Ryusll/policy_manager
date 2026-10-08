import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';

/**
 * 개정 후보 검토 — 목록·손질·검토 요청·다시 만들기 (T-107).
 *
 * 법제처 없이 돈다 — 법령·조항·변경 이벤트를 DB 에 직접 심는다(T-105·T-106 과 같은 방식).
 *
 * 막고 싶은 사고:
 * 1. **고친 내용이 사라진다** — 판은 쌓기만 하고, 동시에 고치면 늦은 쪽이 앞사람 것을 덮지 않고 409.
 * 2. **확인하지 않은 판이 검토된다** — 검토 중에 고치면 작성으로 돌아가 새 판으로 다시 요청해야 한다.
 * 3. **사람이 고친 곳이 법령 근거가 있는 것처럼 보인다** — 규칙이 낸 문구가 그대로 남은 곳만 규칙 근거.
 * 4. **"개정 불필요"가 근거 없이 넘어간다** — 본문이 기준 본문과 같으면 이유 없이는 검토 요청 불가.
 * 5. 다른 회사 후보가 목록·상세·손질에 닿는다.
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const PW = 'IntegrationTest!234';

const LAW_BEFORE = '사용자는 근로자에게 15일의 유급휴가를 주어야 한다.';
const LAW_AFTER = '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.';
const X_TEXT = '직원에게는 매년 15일의 연차휴가를 준다. 담당은 운영팀이다.';
const M_TEXT = '연차휴가는 근로기준법에 따른다.';

describe('T-107 개정 후보 검토', () => {
  const sourceId = randomUUID();
  const lawId = randomUUID();
  const lawArt = randomUUID();
  const ev = randomUUID();
  const lawEffective = day(30);

  let t1: Awaited<ReturnType<typeof createTenant>>;
  let t2: Awaited<ReturnType<typeof createTenant>>;
  let viewerToken = '';
  let editorToken = '';
  let editorId = '';
  let inactivePolicyId = '';
  const art = { x: '', m: '', i: '' };
  const ver = { x: randomUUID(), m: randomUUID(), i: randomUUID() };
  const cand: Record<'x' | 'm' | 'i' | 'w', string> = { x: '', m: '', i: '', w: '' };

  const get = (token: string, id: string) => api(`/amendments/${id}`, { token });
  const edit = (token: string, id: string, json: Record<string, unknown>) =>
    api(`/amendments/${id}`, { method: 'PATCH', token, json });
  const review = (token: string, id: string, json: Record<string, unknown>) =>
    api(`/amendments/${id}/review`, { method: 'POST', token, json });
  const lockOf = async (token: string, id: string) => {
    const b = (await get(token, id)).body;
    return { expectedRevision: b.revision, expectedLockVersion: b.lockVersion };
  };

  beforeAll(async () => {
    await waitForApi();
    t1 = await createTenant('amrev-1');
    t2 = await createTenant('amrev-2');

    const viewerEmail = `viewer-${t1.slug}@example.test`;
    await api('/users', { method: 'POST', token: t1.token, json: { email: viewerEmail, password: PW, name: '열람', role: 'viewer' } });
    viewerToken = (await login(viewerEmail, PW, t1.slug)).body.accessToken;
    const editorEmail = `editor-${t1.slug}@example.test`;
    const editor = await api('/users', { method: 'POST', token: t1.token, json: { email: editorEmail, password: PW, name: '편집자', role: 'editor' } });
    editorId = editor.body.id;
    editorToken = (await login(editorEmail, PW, t1.slug)).body.accessToken;

    sql(`
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, updated_at)
        VALUES ('${lawId}', '${sourceId}', '900003', '990003', '검토시험법', '${lawEffective}', now());
      INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, label, content, version_key, sort_order, updated_at)
        VALUES ('${lawArt}', '${lawId}', '60/1/', 60, 1, '제60조제1항', '${LAW_AFTER}', 'v1:r2', 1, now());
      INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, before_version_key, after_version_key, law_effective_date, received_via, amendments_processed_at)
        VALUES ('${ev}', '${lawId}', '${lawArt}', '60/1/', 'modified', '${LAW_BEFORE}', '${LAW_AFTER}', 'v1:r1', 'v1:r2', '${lawEffective}', 'poll', now());
    `);

    // 회사 1: 시행 중 규정에 조문 둘(X: 규칙이 고치는 조문, M: 대응 문구 없는 조문), 비활성 규정에 하나(I)
    const { policy, chapter, article } = await createPolicyWithArticle(t1.token, `AMR-${Date.now().toString(36)}`, '취업규칙');
    art.x = article.id;
    art.m = (await api(`/policies/${policy.id}/chapters/${chapter.id}/articles`, {
      method: 'POST', token: t1.token, json: { number: 2, title: '근거', content: '본문' },
    })).body.id;
    const inactive = await createPolicyWithArticle(t1.token, `AMR-I-${Date.now().toString(36)}`, '쉬는 규정');
    inactivePolicyId = inactive.policy.id;
    art.i = inactive.article.id;
    await api(`/policies/${inactivePolicyId}`, { method: 'PUT', token: t1.token, json: { isActive: false } });
    sql(`
      DELETE FROM article_versions WHERE article_id IN ('${art.x}', '${art.m}', '${art.i}');
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at) VALUES
        ('${ver.x}', '${art.x}', 1, '${X_TEXT}', 'published', '2020-01-01', now()),
        ('${ver.m}', '${art.m}', 1, '${M_TEXT}', 'published', '2020-01-01', now()),
        ('${ver.i}', '${art.i}', 1, '휴가는 15일로 한다.', 'published', '2020-01-01', now());
    `);
    for (const a of [art.x, art.m, art.i]) {
      const r = await api('/law-links', { method: 'POST', token: t1.token, json: { lawArticleId: lawArt, articleId: a, relationType: 'delegation' } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }

    // 회사 2: 같은 조항에 자기 조문 하나
    const other = await createPolicyWithArticle(t2.token, `AMR2-${Date.now().toString(36)}`, '다른 회사 규정');
    sql(`
      DELETE FROM article_versions WHERE article_id = '${other.article.id}';
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at)
        VALUES ('${randomUUID()}', '${other.article.id}', 1, '휴가는 15일로 한다.', 'published', '2020-01-01', now());
    `);
    await api('/law-links', { method: 'POST', token: t2.token, json: { lawArticleId: lawArt, articleId: other.article.id, relationType: 'delegation' } });

    const g1 = await api('/amendments/generate', { method: 'POST', token: t1.token, json: { changeEventId: ev } });
    expect(g1.status, JSON.stringify(g1.body)).toBe(200);
    for (const c of g1.body.created) {
      if (c.articleId === art.x) cand.x = c.id;
      if (c.articleId === art.m) cand.m = c.id;
      if (c.articleId === art.i) cand.i = c.id;
    }
    const g2 = await api('/amendments/generate', { method: 'POST', token: t2.token, json: { changeEventId: ev } });
    cand.w = g2.body.created[0].id;
  }, 120_000);

  afterAll(() => {
    sql(`
      DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      DELETE FROM laws WHERE id='${lawId}'; DELETE FROM law_sources WHERE id='${sourceId}';
    `);
  });

  describe('생성본은 판 1', () => {
    it('후보를 만들면 판 1 이 함께 남는다 — 본문·해시가 후보와 같다', async () => {
      const row = sql(`SELECT revision || '|' || content_hash || '|' || coalesce(note, '') FROM amendment_revisions WHERE candidate_id='${cand.x}';`);
      expect(row).toBe(`1|${sha('직원에게는 매년 20일의 연차휴가를 준다. 담당은 운영팀이다.')}|`);
      const d = (await get(t1.token, cand.x)).body;
      expect(d).toMatchObject({ revision: 1, lockVersion: 0, current: { revision: 1, hasChanges: true, unexplained: 0, edited: false } });
      expect((await get(t1.token, cand.m)).body.current.hasChanges).toBe(false);
    });
  });

  describe('목록', () => {
    it('기본은 처리할 것(작성·검토), 비활성 규정의 후보도 숨기지 않는다', async () => {
      const { status, body } = await api('/amendments', { token: t1.token });
      expect(status).toBe(200);
      expect(body.rows.map((r: any) => r.id).sort()).toEqual([cand.x, cand.m, cand.i].sort());
      const inactive = body.rows.find((r: any) => r.id === cand.i);
      expect(inactive.policy.isActive).toBe(false);
      const x = body.rows.find((r: any) => r.id === cand.x);
      expect(x).toMatchObject({ isCurrentBase: true, reviewState: 'draft', confidence: 'high', createdBy: { name: expect.any(String) } });
      expect(x.event).toMatchObject({ lawName: '검토시험법', label: '제60조제1항', lawEffectiveDate: lawEffective });
    });

    it('규정·시행 여부·상태로 거르고, 다른 회사 후보는 없다', async () => {
      const byPolicy = await api(`/amendments?policyId=${inactivePolicyId}`, { token: t1.token });
      expect(byPolicy.body.rows.map((r: any) => r.id)).toEqual([cand.i]);
      const active = await api('/amendments?policyActive=active', { token: t1.token });
      expect(active.body.rows.map((r: any) => r.id).sort()).toEqual([cand.x, cand.m].sort());
      expect((await api('/amendments?state=approved', { token: t1.token })).body.total).toBe(0);
      expect(JSON.stringify((await api('/amendments?state=all', { token: t1.token })).body)).not.toContain(cand.w);
      expect((await api('/amendments', { token: t2.token })).body.rows.map((r: any) => r.id)).toEqual([cand.w]);
    });

    it('열람자 403, 잘못된 필터 400, 페이지', async () => {
      expect((await api('/amendments', { token: viewerToken })).status).toBe(403);
      expect((await api('/amendments?state=done', { token: t1.token })).status).toBe(400);
      expect((await api('/amendments?policyActive=yes', { token: t1.token })).status).toBe(400);
      const p1 = await api('/amendments?limit=2&page=1', { token: t1.token });
      const p2 = await api('/amendments?limit=2&page=2', { token: t1.token });
      expect(p1.body).toMatchObject({ total: 3, page: 1, limit: 2 });
      expect(p1.body.rows).toHaveLength(2);
      expect(p2.body.rows).toHaveLength(1);
    });
  });

  describe('손질', () => {
    it('수정 사유가 없거나, 바뀐 것이 없거나, 판·잠금이 어긋나면 고치지 않는다', async () => {
      const lock = await lockOf(t1.token, cand.x);
      const content = '직원에게는 매년 20일의 연차휴가를 부여한다. 담당은 운영팀이다.';
      expect((await edit(t1.token, cand.x, { ...lock, candidateContent: content, note: '  ' })).status).toBe(400);
      expect((await edit(t1.token, cand.x, { ...lock, candidateContent: (await get(t1.token, cand.x)).body.candidateContent, note: '그대로' })).status).toBe(400);
      const stale = await edit(t1.token, cand.x, { ...lock, expectedLockVersion: lock.expectedLockVersion + 1, candidateContent: content, note: '다듬음' });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ revision: 1, lockVersion: 0 });
      expect(sql(`SELECT count(*) FROM amendment_revisions WHERE candidate_id='${cand.x}';`)).toBe('1');
    });

    it('고치면 새 판 — 규칙이 낸 문구가 남은 곳만 규칙 근거, 사람이 고친 곳은 근거 없는 변경', async () => {
      const lock = await lockOf(editorToken, cand.x);
      const content = '직원에게는 매년 20일의 연차휴가를 부여한다. 담당은 운영팀이다.';
      const { status, body } = await edit(editorToken, cand.x, { ...lock, candidateContent: content, note: '문체를 우리 규정에 맞춤' });
      expect(status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({ revision: 2, lockVersion: 1, reviewState: 'draft', candidateContent: content });
      expect(body.current).toMatchObject({ revision: 2, hasChanges: true, unexplained: 1, edited: true });
      expect(body.diff.changes.map((c: any) => [c.candidate.text, c.rationaleRefs])).toEqual([
        ['20', [0]],
        ['부여한다', []],
      ]);
      // 생성 때의 신뢰도·검토 표시는 고정 — 사람이 고쳤다고 바뀌지 않는다
      expect(body.confidence).toBe('high');
      expect(body.reviewFlags).toEqual([]);
      // 판은 쌓인다: 판 1 그대로, 판 2 는 고친 사람·사유와 함께
      expect(sql(`SELECT string_agg(revision || ':' || coalesce(edited_by, '-') || ':' || coalesce(note, '-'), ',' ORDER BY revision) FROM amendment_revisions WHERE candidate_id='${cand.x}';`))
        .toBe(`1:-:-,2:${editorId}:문체를 우리 규정에 맞춤`);
    });

    it('이력은 판마다 직전 판 대비 바뀐 곳을 보인다, 감사 기록은 본문 대신 판·해시·사유', async () => {
      const { body } = await api(`/amendments/${cand.x}/history`, { token: t1.token });
      expect(body.revisions.map((r: any) => r.revision)).toEqual([1, 2]);
      expect(body.revisions[0].fromPrevious).toBeNull();
      expect(body.revisions[1]).toMatchObject({ note: '문체를 우리 규정에 맞춤', editedBy: { id: editorId, name: '편집자' } });
      expect(body.revisions[1].fromPrevious.filter((p: any) => p.op !== 'equal')).toEqual([
        { op: 'delete', text: '준다' },
        { op: 'insert', text: '부여한다' },
      ]);
      const logs = await api('/audit-logs?action=amendment.edit', { token: t1.token });
      expect(logs.body.total).toBe(1);
      const d = (await api(`/audit-logs/${logs.body.rows[0].id}`, { token: t1.token })).body.details;
      expect(d).toMatchObject({
        fromRevision: 1,
        toRevision: 2,
        fromHash: sha('직원에게는 매년 20일의 연차휴가를 준다. 담당은 운영팀이다.'),
        toHash: sha('직원에게는 매년 20일의 연차휴가를 부여한다. 담당은 운영팀이다.'),
        note: '문체를 우리 규정에 맞춤',
      });
      expect(JSON.stringify(d)).not.toContain('연차휴가를 부여한다'); // 본문은 판 테이블에만
    });

    it('규칙이 고친 자리를 사람이 다시 고치면 규칙 근거는 끊긴다', async () => {
      const lock = await lockOf(t1.token, cand.x);
      const content = '직원에게는 매년 25일의 연차휴가를 부여한다. 담당은 운영팀이다.';
      const { body } = await edit(t1.token, cand.x, { ...lock, candidateContent: content, note: '회사가 더 준다' });
      expect(body.revision).toBe(3);
      expect(body.diff.changes.every((c: any) => c.rationaleRefs.length === 0)).toBe(true);
      expect(body.current.unexplained).toBe(2);
    });

    it('다른 회사 후보는 404, 열람자는 403', async () => {
      const lock = await lockOf(t2.token, cand.w);
      expect((await edit(t1.token, cand.w, { ...lock, candidateContent: '바꿈', note: '남의 것' })).status).toBe(404);
      expect((await get(t1.token, cand.w)).status).toBe(404);
      expect((await api(`/amendments/${cand.w}/history`, { token: t1.token })).status).toBe(404);
      expect((await edit(viewerToken, cand.x, { expectedRevision: 1, expectedLockVersion: 0, candidateContent: 'x', note: 'x' })).status).toBe(403);
    });
  });

  describe('검토 요청', () => {
    it('본문이 기준 본문과 같으면 이유 없이는 요청할 수 없다 — 이유가 있으면 "개정 불필요" 판단을 검토로 받는다', async () => {
      const lock = await lockOf(t1.token, cand.m);
      expect((await review(t1.token, cand.m, lock)).status).toBe(400);
      const { status, body } = await review(t1.token, cand.m, { ...lock, reason: '우리 규정은 이미 근로기준법을 따른다고만 적었다' });
      expect(status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({ reviewState: 'review', lockVersion: lock.expectedLockVersion + 1 });
      expect(body.reviewRequest).toMatchObject({ revision: 1, reason: '우리 규정은 이미 근로기준법을 따른다고만 적었다' });
      expect((await review(t1.token, cand.m, await lockOf(t1.token, cand.m))).status).toBe(400); // 이미 검토 중
      const logs = await api('/audit-logs?action=amendment.request_review', { token: t1.token });
      const d = (await api(`/audit-logs/${logs.body.rows[0].id}`, { token: t1.token })).body.details;
      expect(d).toMatchObject({ revision: 1, noChange: true, contentHash: sha(M_TEXT), requestId: body.reviewRequest.id });
    });

    it('판·잠금이 어긋난 요청은 409 — 확인하지 않은 판이 검토로 넘어가지 않는다', async () => {
      const lock = await lockOf(t1.token, cand.x);
      expect((await review(t1.token, cand.x, { ...lock, expectedRevision: 1 })).status).toBe(409);
      expect((await get(t1.token, cand.x)).body.reviewState).toBe('draft');
    });

    it('검토 중에 고치면 작성으로 돌아가고 요청 기록은 이력에 남는다 — 새 판으로 다시 요청해야 한다', async () => {
      const r1 = await review(t1.token, cand.x, await lockOf(t1.token, cand.x));
      expect(r1.body).toMatchObject({ reviewState: 'review', reviewRequest: { revision: 3 } });

      const lock = await lockOf(t1.token, cand.x);
      const content = '직원에게는 매년 25일의 연차휴가를 부여한다. 담당은 인사팀이다.';
      const e = await edit(t1.token, cand.x, { ...lock, candidateContent: content, note: '담당 부서 바뀜' });
      expect(e.body).toMatchObject({ revision: 4, reviewState: 'draft', reviewRequest: null });

      const h = (await api(`/amendments/${cand.x}/history`, { token: t1.token })).body;
      expect(h.stateChanges.map((c: any) => `${c.fromState}>${c.toState}@${c.revision}`)).toEqual(['draft>review@3', 'review>draft@4']);
      expect(h.revisions[3]).toMatchObject({ revision: 4, stateBefore: 'review' });

      const r2 = await review(t1.token, cand.x, await lockOf(t1.token, cand.x));
      expect(r2.body.reviewRequest.revision).toBe(4);
    });

    it('승인된 후보는 고칠 수 없다', async () => {
      sql(`UPDATE amendment_candidates SET review_state='approved' WHERE id='${cand.i}';`);
      const lock = await lockOf(t1.token, cand.i);
      expect((await edit(t1.token, cand.i, { ...lock, candidateContent: '휴가는 20일로 한다. 끝.', note: '승인 뒤' })).status).toBe(400);
      expect((await review(t1.token, cand.i, lock)).status).toBe(400);
    });
  });

  describe('기준 본문이 바뀐 후보', () => {
    it('그 사이 조문이 개정되면 표시하고, 다시 만들면 그 조문만 지금 기준 본문으로 새 후보 — 옛 후보는 그대로', async () => {
      const v2 = randomUUID();
      // 같은 이벤트의 다른 조문(X)도 기준 본문이 바뀌었다 — 다시 만들기는 누른 조문(M)만 만들어야 한다
      sql(`INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at) VALUES
           ('${v2}', '${art.m}', 2, '연차휴가는 15일로 한다.', 'published', '${day(-1)}', now()),
           ('${randomUUID()}', '${art.x}', 2, '직원에게는 매년 15일의 연차휴가를 준다.', 'published', '${day(-1)}', now());`);
      const d = (await get(t1.token, cand.m)).body;
      expect(d.isCurrentBase).toBe(false);
      expect(d.currentBase).toMatchObject({ id: v2, versionNum: 2, content: '연차휴가는 15일로 한다.' });
      expect((await api('/amendments', { token: t1.token })).body.rows.find((r: any) => r.id === cand.m).isCurrentBase).toBe(false);

      const before = sql(`SELECT count(*) FROM amendment_candidates WHERE change_event_id='${ev}';`);
      const r = await api(`/amendments/${cand.m}/regenerate`, { method: 'POST', token: t1.token });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ created: true, unchanged: false });
      expect(sql(`SELECT count(*) FROM amendment_candidates WHERE change_event_id='${ev}';`)).toBe(String(Number(before) + 1));
      const fresh = (await get(t1.token, r.body.candidateId)).body;
      expect(fresh).toMatchObject({ baseVersion: { id: v2 }, candidateContent: '연차휴가는 20일로 한다.', isCurrentBase: true, revision: 1 });
      expect(fresh.siblings.map((s: any) => s.id)).toEqual([cand.m]);
      expect((await get(t1.token, cand.m)).body).toMatchObject({ reviewState: 'review', candidateContent: M_TEXT });

      const again = await api(`/amendments/${cand.m}/regenerate`, { method: 'POST', token: t1.token });
      expect(again.body).toMatchObject({ candidateId: r.body.candidateId, created: false });
      const same = await api(`/amendments/${r.body.candidateId}/regenerate`, { method: 'POST', token: t1.token });
      expect(same.body).toMatchObject({ unchanged: true });
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';
import { brief, expect409, sleepTrigger, sql, waitForBlockedBy, waitForSleep } from './race';
import { auditRowHash, lockOf, seedReviewCandidate, simulateLegacyWithdraw } from './amendment-seed';

const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const PW = 'EditorPass!234';

/**
 * T-178 (PAT-21 — 특허 도 12) 개정 후보 반려 정정. 잘못된 반려를 본문 수정 없이 되돌린다 — 원 반려 전환·사유·감사는 그대로 두고, 정정
 * 전환(종류 정정)과 원 반려 감사를 가리키는 정정 감사를 같은 트랜잭션에 쌓는다.
 *
 * 막고 싶은 사고:
 * 1. 반려를 되돌리려면 본문을 일부러 바꿔야 한다(같은 본문 손질은 400) — 기록에 없는 손질이 생긴다
 * 2. 정정이 원 반려 기록을 지우거나 고친다
 * 3. 편집자·다른 회사가 정정하거나, 동시에 두 번 정정돼 기록이 겹친다
 * 4. T-178 전 철회로 반려가 된 후보는 되돌릴 길이 없다
 */
describe('T-178 개정 후보 반려 정정', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let other: Awaited<ReturnType<typeof createTenant>>;
  let editorToken = '';
  let policyId = '';
  let chapterId = '';
  let n = 10;
  const E = day(30);
  const cleanups: (() => void)[] = [];
  const post = (path: string, json?: unknown, token = t.token) => api(path, { method: 'POST', token, json });
  const seed = async (tag: string) => {
    const s = await seedReviewCandidate(t.token, policyId, chapterId, { number: n++, lawEffective: E, tag });
    cleanups.push(s.cleanup);
    return s;
  };
  const reject = async (candidateId: string, reason: string) => {
    const r = await post(`/amendments/${candidateId}/reject`, { reason, ...(await lockOf(t.token, candidateId)) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return sql(`SELECT id FROM audit_logs WHERE action = 'amendment.reject' AND entity_id = '${candidateId}' ORDER BY created_at DESC LIMIT 1;`);
  };
  const correct = async (candidateId: string, reason: string, token = t.token) =>
    post(`/amendments/${candidateId}/correct-rejection`, { reason, ...(await lockOf(t.token, candidateId)) }, token);
  const corrections = (candidateId: string) =>
    sql(`SELECT count(*) FROM audit_logs WHERE action = 'amendment.reject_correct' AND entity_id = '${candidateId}';`);

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('rej-fix');
    other = await createTenant('rej-fix-o');
    const email = `editor-${t.slug}@example.test`;
    expect((await api('/users', { method: 'POST', token: t.token, json: { email, password: PW, name: '편집자', role: 'editor' } })).status).toBe(201);
    editorToken = (await login(email, PW, t.slug)).body.accessToken;
    const set = await createPolicyWithArticle(t.token, `RJF-${Date.now().toString(36)}`, '반려정정규정');
    policyId = set.policy.id;
    chapterId = set.chapter.id;
  }, 90_000);

  afterAll(() => {
    for (const c of cleanups) c();
  });

  it('관리자가 사유와 함께 정정하면 본문은 그대로 작성 상태가 되고, 원 반려 전환·감사는 남는다 — 다시 검토·승인된다 (T-178)', async () => {
    const s = await seed('정정');
    const beforeBody = (await api(`/amendments/${s.candidateId}`, { token: t.token })).body;
    const rejectAuditId = await reject(s.candidateId, '기준일 착오로 반려');
    const rejectHash = auditRowHash(rejectAuditId);
    const notices = () => sql(`SELECT count(*) FROM user_notifications WHERE tenant_id = '${t.user.tenantId}';`);
    const noticesBefore = notices();

    const res = await correct(s.candidateId, '반려 판단 착오 — 다시 검토');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(notices()).toBe(noticesBefore); // 정정은 알리지 않는다
    expect(res.body.reviewState).toBe('draft');
    expect(res.body.revision).toBe(beforeBody.revision);
    expect(res.body.candidateContent).toBe(beforeBody.candidateContent);
    expect(res.body.correction).toMatchObject({ kind: 'reject', reason: '반려 판단 착오 — 다시 검토', by: { id: t.user.id } });
    expect(res.body.decision).toMatchObject({ state: 'rejected', reason: '기준일 착오로 반려' });

    const changes = sql(
      `SELECT string_agg(from_state || '>' || to_state || ':' || kind || ':' || coalesce(reason, ''), ' | ' ORDER BY created_at, id) FROM amendment_state_changes WHERE candidate_id = '${s.candidateId}';`,
    );
    expect(changes).toContain('review>rejected:transition:기준일 착오로 반려');
    expect(changes.endsWith('rejected>draft:correction:반려 판단 착오 — 다시 검토')).toBe(true);

    const audit = JSON.parse(
      sql(`SELECT json_build_object('correctsId', corrects_id, 'userId', user_id, 'details', details) FROM audit_logs WHERE action = 'amendment.reject_correct' AND entity_id = '${s.candidateId}';`),
    );
    expect(audit.correctsId).toBe(rejectAuditId);
    expect(audit.userId).toBe(t.user.id);
    expect(audit.details.reason).toBe('반려 판단 착오 — 다시 검토');
    expect(audit.details.before).toMatchObject({ reviewState: 'rejected', decisionReason: '기준일 착오로 반려', decidedBy: t.user.id });
    expect(audit.details.after).toEqual({ reviewState: 'draft' });
    expect(auditRowHash(rejectAuditId)).toBe(rejectHash);

    const history = (await api(`/amendments/${s.candidateId}/history`, { token: t.token })).body;
    expect(history.stateChanges.at(-1)).toMatchObject({ fromState: 'rejected', toState: 'draft', kind: 'correction' });
    expect(history.stateChanges.filter((c: any) => c.kind === 'transition').length).toBe(history.stateChanges.length - 1);
    expect(history.revisions.length).toBe(1); // 판은 늘지 않는다 — 본문을 바꾸지 않았다

    expect((await post(`/amendments/${s.candidateId}/review`, await lockOf(t.token, s.candidateId))).status).toBe(200);
    const approved = await post(`/amendments/${s.candidateId}/approve`, { effectiveDate: E, changeNote: '정정 뒤 승인', ...(await lockOf(t.token, s.candidateId)) });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.correction).toBeNull(); // 새 결정(승인) 뒤라 정정 표시는 없다
  }, 120_000);

  it('거부: 편집자 403, 사유 없음 400, 잠금이 다르면 409, 다른 회사 404, 반려가 아닌 후보 400 — 아무것도 바뀌지 않는다 (T-178)', async () => {
    const s = await seed('거부');
    await reject(s.candidateId, '반려');
    const lock = await lockOf(t.token, s.candidateId);
    expect((await correct(s.candidateId, '편집자가', editorToken)).status).toBe(403);
    expect((await post(`/amendments/${s.candidateId}/correct-rejection`, { reason: '   ', ...lock })).status).toBe(400);
    expect((await post(`/amendments/${s.candidateId}/correct-rejection`, { ...lock })).status).toBe(400);
    const stale = await post(`/amendments/${s.candidateId}/correct-rejection`, { reason: '옛 화면', ...lock, expectedLockVersion: lock.expectedLockVersion - 1 });
    expect(stale.status, JSON.stringify(stale.body)).toBe(409);
    expect((await post(`/amendments/${s.candidateId}/correct-rejection`, { reason: '남의 회사', ...lock }, other.token)).status).toBe(404);
    expect(sql(`SELECT review_state || '|' || lock_version FROM amendment_candidates WHERE id = '${s.candidateId}';`)).toBe(`rejected|${lock.expectedLockVersion}`);
    expect(corrections(s.candidateId)).toBe('0');

    const inReview = await seed('검토중');
    const notRejected = await correct(inReview.candidateId, '검토 중인 후보');
    expect(notRejected.status).toBe(400);
    expect(notRejected.body.message).toContain('반려된 후보만');
    expect(corrections(inReview.candidateId)).toBe('0');
  }, 120_000);

  it('같은 판·잠금으로 두 번 겹쳐 정정해도 한 번만 된다 — 뒤 요청은 앞 트랜잭션을 기다렸다가 409 (T-178)', async () => {
    const s = await seed('동시');
    await reject(s.candidateId, '반려');
    const lock = await lockOf(t.token, s.candidateId);
    // 앞 요청이 정정 전환을 쓴 뒤 커밋 전에 멈춘다 — 뒤 요청은 사전 확인(커밋된 반려 상태)을 지나 같은 행에서 막힌다
    const drop = sleepTrigger('rejfix', 'amendment_state_changes', 'AFTER', 'INSERT', `NEW.kind = 'correction' AND NEW.candidate_id = '${s.candidateId}'`, 2);
    try {
      const first = post(`/amendments/${s.candidateId}/correct-rejection`, { reason: '정정 1', ...lock });
      await waitForSleep('rejfix');
      const second = post(`/amendments/${s.candidateId}/correct-rejection`, { reason: '정정 2', ...lock });
      await waitForBlockedBy('rejfix');
      const [a, b] = await Promise.all([first, second]);
      expect(a.status, brief(a)).toBe(200);
      expect409(b, '그 사이');
    } finally {
      drop();
    }
    expect(corrections(s.candidateId)).toBe('1');
    expect(sql(`SELECT count(*) FROM amendment_state_changes WHERE candidate_id = '${s.candidateId}' AND kind = 'correction';`)).toBe('1');
  }, 120_000);

  it('T-178 전 철회로 반려가 된 후보(승인 → 반려)도 정정할 수 있고, 정정은 그 철회 기록을 가리킨다 — 다시 검토·승인된다 (T-178)', async () => {
    const s = await seed('옛철회');
    const ok = await post(`/amendments/${s.candidateId}/approve`, { effectiveDate: E, changeNote: '법령 반영', ...(await lockOf(t.token, s.candidateId)) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const versionId = ok.body.resultVersion.id as string;
    const oldAudit = randomUUID();
    // T-178 전 철회가 남긴 모양 — 초안은 원천 후보를 쥐고, 후보는 승인 → 반려(마이그레이션이 종류를 정정으로 채움), 철회 감사는 정정 대상 없이
    sql(`
      UPDATE article_versions SET status = 'draft', approved_by = NULL, approved_at = NULL, published_at = NULL, effective_date = NULL WHERE id = '${versionId}';
      UPDATE article_versions SET status = 'published' WHERE article_id = '${s.articleId}' AND status = 'archived';
      UPDATE amendment_candidates SET review_state = 'rejected', lock_version = lock_version + 1 WHERE id = '${s.candidateId}';
      INSERT INTO amendment_state_changes (id, tenant_id, candidate_id, from_state, to_state, revision, reason, actor_id, kind)
        SELECT '${randomUUID()}', tenant_id, id, 'approved', 'rejected', revision, '승인 철회 — 옛 철회', '${t.user.id}', 'correction' FROM amendment_candidates WHERE id = '${s.candidateId}';
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
        SELECT '${oldAudit}', tenant_id, '${t.user.id}', 'version.withdraw', 'ArticleVersion', '${versionId}', json_build_object('candidateId', id, 'reason', '옛 철회')::jsonb
        FROM amendment_candidates WHERE id = '${s.candidateId}';
    `);
    const res = await correct(s.candidateId, '옛 철회가 반려로 남은 것을 바로잡음');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const fix = JSON.parse(sql(`SELECT json_build_object('correctsId', corrects_id, 'details', details) FROM audit_logs WHERE action = 'amendment.reject_correct' AND entity_id = '${s.candidateId}';`));
    expect(fix.correctsId).toBe(oldAudit);
    // 정정이 옛 초안의 원천 연결을 함께 뗀다 — 그 초안을 나중에 일반 승인으로 발행해도 후보를 쥐지 않는다
    expect(fix.details.detachedVersionIds).toEqual([versionId]);
    expect(sql(`SELECT coalesce(source_candidate_id, '-') || '|' || coalesce(change_event_id, '-') FROM article_versions WHERE id = '${versionId}';`)).toBe('-|-');
    expect(JSON.parse(sql(`SELECT details FROM audit_logs WHERE action = 'version.source_detach' AND entity_id = '${versionId}';`))).toMatchObject({
      candidateId: s.candidateId,
      cause: 'amendment.reject_correct',
      newVersionId: null,
    });

    expect((await post(`/amendments/${s.candidateId}/review`, await lockOf(t.token, s.candidateId))).status).toBe(200);
    const again = await post(`/amendments/${s.candidateId}/approve`, { effectiveDate: E, changeNote: '다시 반영', ...(await lockOf(t.token, s.candidateId)) });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.resultVersion.id).not.toBe(versionId);
    // 이미 정정 때 뗐으니 승인은 뗄 것이 없다
    expect(sql(`SELECT coalesce(details->>'detachedVersionIds', '-') FROM audit_logs WHERE action = 'amendment.approve' AND entity_id = '${s.candidateId}' ORDER BY created_at DESC LIMIT 1;`)).toBe('-');
  }, 120_000);

  it('옛 철회 초안을 일반 승인으로 다시 발행해 그 버전이 후보를 쥐고 있으면 반려 정정은 409 — 되돌려도 다시 승인할 수 없다 (T-178)', async () => {
    const s = await seed('발행본');
    const ok = await post(`/amendments/${s.candidateId}/approve`, { effectiveDate: E, changeNote: '법령 반영', ...(await lockOf(t.token, s.candidateId)) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const versionId = ok.body.resultVersion.id as string;
    sql(`
      UPDATE article_versions SET status = 'draft', approved_by = NULL, approved_at = NULL, published_at = NULL, effective_date = NULL WHERE id = '${versionId}';
      UPDATE article_versions SET status = 'published' WHERE article_id = '${s.articleId}' AND status = 'archived';
      UPDATE amendment_candidates SET review_state = 'rejected', lock_version = lock_version + 1 WHERE id = '${s.candidateId}';
      INSERT INTO amendment_state_changes (id, tenant_id, candidate_id, from_state, to_state, revision, reason, actor_id, kind)
        SELECT '${randomUUID()}', tenant_id, id, 'approved', 'rejected', revision, '승인 철회 — 옛 철회', '${t.user.id}', 'correction' FROM amendment_candidates WHERE id = '${s.candidateId}';
    `);
    // 그 초안을 일반 경로로 다시 발행 — 원천 후보를 쥔 채 published
    expect((await post(`/versions/${versionId}/submit`)).status).toBe(200);
    const again = await post(`/versions/${versionId}/approve`, { changeNote: '일반 승인으로 다시', effectiveDate: E });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(sql(`SELECT status || '|' || source_candidate_id FROM article_versions WHERE id = '${versionId}';`)).toBe(`published|${s.candidateId}`);

    const lock = await lockOf(t.token, s.candidateId);
    const res = await post(`/amendments/${s.candidateId}/correct-rejection`, { reason: '되돌려 보기', ...lock });
    expect409(res, '이 후보로 발행한 버전');
    expect(sql(`SELECT review_state || '|' || lock_version FROM amendment_candidates WHERE id = '${s.candidateId}';`)).toBe(`rejected|${lock.expectedLockVersion}`);
    expect(corrections(s.candidateId)).toBe('0');
    // 화면은 이 후보의 결과(발행본)를 알고 있다 — 반려 정정 패널을 띄우지 않는 근거
    expect((await api(`/amendments/${s.candidateId}`, { token: t.token })).body.resultVersion?.id).toBe(versionId);
  }, 120_000);

  it('옛 철회 초안의 일반 승인과 반려 정정이 겹치면 정정은 조문 잠금을 기다렸다가 409 — 발행본이 쥔 후보를 되돌리지 않는다 (T-178)', async () => {
    const s = await seed('겹침');
    const ok = await post(`/amendments/${s.candidateId}/approve`, { effectiveDate: E, changeNote: '법령 반영', ...(await lockOf(t.token, s.candidateId)) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const versionId = ok.body.resultVersion.id as string;
    sql(`
      UPDATE article_versions SET status = 'draft', approved_by = NULL, approved_at = NULL, published_at = NULL, effective_date = NULL WHERE id = '${versionId}';
      UPDATE article_versions SET status = 'published' WHERE article_id = '${s.articleId}' AND status = 'archived';
      UPDATE amendment_candidates SET review_state = 'rejected', lock_version = lock_version + 1 WHERE id = '${s.candidateId}';
      INSERT INTO amendment_state_changes (id, tenant_id, candidate_id, from_state, to_state, revision, reason, actor_id, kind)
        SELECT '${randomUUID()}', tenant_id, id, 'approved', 'rejected', revision, '승인 철회 — 옛 철회', '${t.user.id}', 'correction' FROM amendment_candidates WHERE id = '${s.candidateId}';
    `);
    expect((await post(`/versions/${versionId}/submit`)).status).toBe(200);
    const lock = await lockOf(t.token, s.candidateId);
    // 일반 승인이 그 초안을 발행한 뒤 커밋 전에 멈춘다(조문 잠금을 쥔 채) — 정정은 사전 확인을 지나 조문 잠금에서 기다린다
    const drop = sleepTrigger('rejfix_issue', 'article_versions', 'AFTER', 'UPDATE', `NEW.id = '${versionId}' AND NEW.status = 'published'`, 2);
    try {
      const approving = post(`/versions/${versionId}/approve`, { changeNote: '일반 승인으로 다시', effectiveDate: E });
      await waitForSleep('rejfix_issue');
      const correcting = post(`/amendments/${s.candidateId}/correct-rejection`, { reason: '겹친 정정', ...lock });
      await waitForBlockedBy('rejfix_issue');
      const [a, b] = await Promise.all([approving, correcting]);
      expect(a.status, brief(a)).toBe(200);
      expect409(b, '이 후보로 발행한 버전');
      expect(b.body.reason).toBe('issued_source');
    } finally {
      drop();
    }
    expect(sql(`SELECT status || '|' || source_candidate_id FROM article_versions WHERE id = '${versionId}';`)).toBe(`published|${s.candidateId}`);
    expect(sql(`SELECT review_state FROM amendment_candidates WHERE id = '${s.candidateId}';`)).toBe('rejected');
    expect(corrections(s.candidateId)).toBe('0');
  }, 120_000);

  it('정정 감사를 쓰지 못하면 정정 전체가 되돌려진다 — 상태·정정 전환·옛 초안 연결 떼기 모두(같은 트랜잭션) (T-178)', async () => {
    const s = await seed('원자성');
    const ok = await post(`/amendments/${s.candidateId}/approve`, { effectiveDate: E, changeNote: '법령 반영', ...(await lockOf(t.token, s.candidateId)) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const versionId = ok.body.resultVersion.id as string;
    simulateLegacyWithdraw({ tenantId: t.user.tenantId, userId: t.user.id, candidateId: s.candidateId, articleId: s.articleId, versionId });
    const before = sql(`SELECT review_state || '|' || lock_version FROM amendment_candidates WHERE id = '${s.candidateId}';`);
    sql(`
      CREATE OR REPLACE FUNCTION t178_fail_fix() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN
        IF NEW.action = 'amendment.reject_correct' AND NEW.entity_id = '${s.candidateId}' THEN RAISE EXCEPTION 't178 correction audit failed'; END IF;
        RETURN NEW;
      END $f$;
      DROP TRIGGER IF EXISTS t178_fail_fix ON audit_logs;
      CREATE TRIGGER t178_fail_fix BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION t178_fail_fix();
    `);
    try {
      expect((await correct(s.candidateId, '감사 실패')).status).toBe(500);
    } finally {
      sql(`DROP TRIGGER IF EXISTS t178_fail_fix ON audit_logs; DROP FUNCTION IF EXISTS t178_fail_fix();`);
    }
    expect(sql(`SELECT review_state || '|' || lock_version FROM amendment_candidates WHERE id = '${s.candidateId}';`)).toBe(before);
    expect(sql(`SELECT count(*) FROM amendment_state_changes WHERE candidate_id = '${s.candidateId}' AND to_state = 'draft' AND kind = 'correction';`)).toBe('0');
    expect(sql(`SELECT source_candidate_id FROM article_versions WHERE id = '${versionId}';`)).toBe(s.candidateId);
    expect(sql(`SELECT count(*) FROM audit_logs WHERE action = 'version.source_detach' AND entity_id = '${versionId}';`)).toBe('0');
  }, 120_000);
});

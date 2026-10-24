import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';
import { sql } from './race';
import { auditRowHash } from './amendment-seed';

const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * T-178 (PAT-21 — 특허 도 12) 일반 승인(version.approve)으로 발행한 버전의 철회 — 철회 정정이 가리키는 원 승인 기록을 고르는 규칙.
 *
 * 막고 싶은 사고:
 * 1. 철회 → 다시 승인 → 다시 철회에서 둘째 철회가 이미 거둔 첫 승인을 가리킨다
 * 2. T-178 전 철회(원 기록을 가리키지 않음) 뒤 감사가 버전을 가리키지 않는 발행(한꺼번에 시행)으로 다시 나간 버전을 철회하면, 이미 거둔
 *    옛 승인을 원 기록으로 짐작해 잇는다 — "원 기록 없음"이어야 한다
 * 3. 승인 감사가 커밋 뒤에 따로 써져 철회가 그 틈에 끼면 원 기록이 비거나 엇갈린다(승인 감사는 발행과 같은 트랜잭션)
 */
describe('T-178 일반 승인 버전의 철회 — 원 승인 기록 고르기', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let n = 20;
  const post = (path: string, json?: unknown) => api(path, { method: 'POST', token: t.token, json });
  const ok = async (path: string, json?: unknown) => {
    const r = await post(path, json);
    expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(200);
    return r.body;
  };
  /** 새 조문 하나 — 처음 판(초안)의 id */
  const newArticle = async (policyId: string, chapterId: string) => {
    const art = await post(`/policies/${policyId}/chapters/${chapterId}/articles`, { number: n++, title: '철회시험', content: '직원은 매년 교육을 받는다.' });
    expect(art.status, JSON.stringify(art.body)).toBeLessThan(300);
    return sql(`SELECT id FROM article_versions WHERE article_id = '${art.body.id}' ORDER BY version_num LIMIT 1;`);
  };
  const approveAudits = (versionId: string) =>
    sql(`SELECT string_agg(id, ',' ORDER BY created_at, id) FROM audit_logs WHERE action = 'version.approve' AND entity_id = '${versionId}';`).split(',');
  const withdrawAudit = (versionId: string) =>
    JSON.parse(
      sql(
        `SELECT json_build_object('correctsId', corrects_id, 'details', details) FROM audit_logs WHERE action = 'version.withdraw' AND entity_id = '${versionId}' ORDER BY created_at DESC, id DESC LIMIT 1;`,
      ),
    );

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('withdraw-chain');
  }, 90_000);

  it('철회 → 다시 승인 → 다시 철회 — 철회마다 바로 앞 승인을 가리키고 그 승인 정보를 남긴다, 원 승인 기록은 그대로 (T-178)', async () => {
    const set = await createPolicyWithArticle(t.token, `WAC-${Date.now().toString(36)}`, '철회사슬규정');
    const v = await newArticle(set.policy.id, set.chapter.id);

    await ok(`/versions/${v}/submit`);
    await ok(`/versions/${v}/approve`, { changeNote: '첫 승인', effectiveDate: day(30) });
    const [first] = approveAudits(v);
    const firstHash = auditRowHash(first);
    await ok(`/versions/${v}/withdraw`, { reason: '보류 1' });
    const w1 = withdrawAudit(v);
    expect(w1.correctsId).toBe(first);
    expect(w1.details.before).toMatchObject({ status: 'published', changeNote: '첫 승인', effectiveDate: day(30), approvedBy: t.user.id, earlyReason: null, sourceCandidateId: null });

    await ok(`/versions/${v}/submit`);
    await ok(`/versions/${v}/approve`, { changeNote: '둘째 승인', effectiveDate: day(40) });
    const audits = approveAudits(v);
    expect(audits.length).toBe(2);
    await ok(`/versions/${v}/withdraw`, { reason: '보류 2' });
    const w2 = withdrawAudit(v);
    expect(w2.correctsId).toBe(audits[1]);
    expect(w2.details.before).toMatchObject({ changeNote: '둘째 승인', effectiveDate: day(40) });
    expect(auditRowHash(first)).toBe(firstHash);
  }, 120_000);

  it('T-178 전 철회 뒤 한꺼번에 시행으로 다시 나간 버전을 철회하면 원 기록을 짐작하지 않는다(없음) (T-178)', async () => {
    const set = await createPolicyWithArticle(t.token, `WAB-${Date.now().toString(36)}`, '일괄시행규정');
    const v = await newArticle(set.policy.id, set.chapter.id);
    await ok(`/versions/${v}/submit`);
    await ok(`/versions/${v}/approve`, { changeNote: '옛 승인', effectiveDate: day(30) });
    // T-178 전 철회가 남긴 모양 — 버전은 초안, 철회 감사는 원 기록을 가리키지 않는다
    sql(`
      UPDATE article_versions SET status = 'draft', approved_by = NULL, approved_at = NULL, published_at = NULL, effective_date = NULL WHERE id = '${v}';
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
        VALUES ('${randomUUID()}', '${t.user.tenantId}', '${t.user.id}', 'version.withdraw', 'ArticleVersion', '${v}', '{"reason": "옛 철회"}'::jsonb);
    `);
    await ok(`/policies/${set.policy.id}/publish-drafts`, { changeNote: '한꺼번에 시행', effectiveDate: day(50) });
    expect(sql(`SELECT status || '|' || effective_date FROM article_versions WHERE id = '${v}';`)).toBe(`published|${day(50)}`);
    await ok(`/versions/${v}/withdraw`, { reason: '일괄 시행 철회' });
    const w = withdrawAudit(v);
    expect(w.correctsId).toBeNull();
    expect(w.details.before).toMatchObject({ status: 'published', changeNote: '한꺼번에 시행', effectiveDate: day(50), earlyReason: null });
  }, 120_000);

  it('승인 감사를 쓰지 못하면 발행도 되돌려진다 — 승인 감사는 발행과 같은 트랜잭션 (T-178)', async () => {
    const set = await createPolicyWithArticle(t.token, `WAT-${Date.now().toString(36)}`, '감사원자성규정');
    const v = await newArticle(set.policy.id, set.chapter.id);
    await ok(`/versions/${v}/submit`);
    // 이 버전의 승인 감사만 실패시킨다
    sql(`
      CREATE OR REPLACE FUNCTION t178_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN
        IF NEW.action = 'version.approve' AND NEW.entity_id = '${v}' THEN RAISE EXCEPTION 't178 audit write failed'; END IF;
        RETURN NEW;
      END $f$;
      DROP TRIGGER IF EXISTS t178_fail_audit ON audit_logs;
      CREATE TRIGGER t178_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION t178_fail_audit();
    `);
    try {
      const r = await post(`/versions/${v}/approve`, { changeNote: '감사 실패', effectiveDate: day(30) });
      expect(r.status).toBe(500);
      expect(sql(`SELECT status || '|' || coalesce(effective_date::text, '-') FROM article_versions WHERE id = '${v}';`)).toBe('review|-');
    } finally {
      sql(`DROP TRIGGER IF EXISTS t178_fail_audit ON audit_logs; DROP FUNCTION IF EXISTS t178_fail_audit();`);
    }
    expect(approveAudits(v)).toEqual(['']);
  }, 120_000);
});

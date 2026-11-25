import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';
import { sql } from './race';
import { lockOf, seedReviewCandidate, simulateLegacyWithdraw } from './amendment-seed';

const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const MIGRATION = join(__dirname, '..', '..', 'apps', 'api', 'prisma', 'migrations', '20261024090000_audit_corrections', 'migration.sql');

/**
 * T-178 마이그레이션의 옛 철회 초안 정리 구간(-- [legacy-detach:start] ~ end)을 그대로 돌려 본다. 공용 개발 DB 에서 다른 세션의 행을 잡지
 * 않게 이 회사로만 좁힌다(규칙은 그대로).
 *
 * 막고 싶은 사고: T-178 전에 철회되고 그때 손질까지 해 작성·검토 상태가 된 후보는 다시 열 때의 판정(reopenRejectedLocked)을 지나지 않는다.
 * 그 사이 원천 후보를 쥔 옛 초안을 일반 승인·한꺼번에 시행으로 먼저 발행하면, 그 후보는 다시 승인할 수 없게 된다
 */
const legacyDetach = (tenantId: string) => {
  const sql0 = readFileSync(MIGRATION, 'utf8');
  const part = sql0.slice(sql0.indexOf('-- [legacy-detach:start]'), sql0.indexOf('-- [legacy-detach:end]'));
  const scoped = part.split(`v."status" IN ('draft', 'review')`).join(`v."status" IN ('draft', 'review') AND c."tenant_id" = '${tenantId}'`);
  expect(scoped.split(`c."tenant_id" = '${tenantId}'`).length - 1).toBe(2); // 감사 INSERT·연결 떼기 두 문장 모두 좁혔다
  sql(scoped);
};

describe('T-178 마이그레이션 — T-178 전 철회 초안의 원천 연결 정리', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let policyId = '';
  let chapterId = '';
  let n = 60;
  const E = day(30);
  const cleanups: (() => void)[] = [];
  const post = (path: string, json?: unknown) => api(path, { method: 'POST', token: t.token, json });
  /** 후보를 승인했다가 T-178 전 방식으로 철회된 모양으로 — 승인으로 발행한 버전 id */
  const legacy = async (tag: string, candidateState: 'rejected' | 'draft') => {
    const s = await seedReviewCandidate(t.token, policyId, chapterId, { number: n++, lawEffective: E, tag });
    cleanups.push(s.cleanup);
    const ok = await post(`/amendments/${s.candidateId}/approve`, { effectiveDate: E, changeNote: '법령 반영', ...(await lockOf(t.token, s.candidateId)) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const versionId = ok.body.resultVersion.id as string;
    simulateLegacyWithdraw({ tenantId: t.user.tenantId, userId: t.user.id, candidateId: s.candidateId, articleId: s.articleId, versionId, candidateState });
    return { ...s, versionId };
  };
  const detachAudits = (versionId: string) =>
    sql(`SELECT count(*) FROM audit_logs WHERE action = 'version.source_detach' AND entity_id = '${versionId}' AND details->>'cause' = 'migration';`);

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('legacy-detach');
    const set = await createPolicyWithArticle(t.token, `LGD-${Date.now().toString(36)}`, '옛철회정리규정');
    policyId = set.policy.id;
    chapterId = set.chapter.id;
  }, 90_000);

  afterAll(() => {
    for (const c of cleanups) c();
  });

  it('발행되지 않은 옛 철회 초안은 연결을 떼고 그 버전 대상 감사를 남긴다 — 발행본은 그대로, 다시 돌려도 같다, 정리된 초안을 발행해도 후보를 쥐지 않는다 (T-178)', async () => {
    // A: T-178 전 철회 뒤 그때 손질까지 해 작성 상태가 된 후보 — 초안이 후보를 쥔다(정리 대상)
    const a = await legacy('정리', 'draft');
    // B: 옛 철회 초안을 일반 승인으로 다시 발행 — 발행본이 후보를 쥔다(정리 대상 아님 — 실제 발행의 원천)
    const b = await legacy('발행본', 'rejected');
    expect((await post(`/versions/${b.versionId}/submit`)).status).toBe(200);
    expect((await post(`/versions/${b.versionId}/approve`, { changeNote: '일반 승인으로 다시', effectiveDate: E })).status).toBe(200);

    legacyDetach(t.user.tenantId);

    expect(sql(`SELECT coalesce(source_candidate_id, '-') || '|' || coalesce(change_event_id, '-') FROM article_versions WHERE id = '${a.versionId}';`)).toBe('-|-');
    const trail = JSON.parse(
      sql(`SELECT json_build_object('userId', user_id, 'tenantId', tenant_id, 'details', details) FROM audit_logs WHERE action = 'version.source_detach' AND entity_id = '${a.versionId}';`),
    );
    expect(trail.userId).toBeNull();
    expect(trail.tenantId).toBe(t.user.tenantId);
    expect(trail.details).toMatchObject({
      candidateId: a.candidateId,
      cause: 'migration',
      newVersionId: null,
      status: 'draft',
      before: { sourceCandidateId: a.candidateId, changeEventId: a.changeEventId },
      after: { sourceCandidateId: null, changeEventId: null },
    });
    expect(sql(`SELECT status || '|' || source_candidate_id FROM article_versions WHERE id = '${b.versionId}';`)).toBe(`published|${b.candidateId}`);
    expect(sql(`SELECT count(*) FROM audit_logs WHERE action = 'version.source_detach' AND entity_id = '${b.versionId}';`)).toBe('0');

    legacyDetach(t.user.tenantId);
    expect(detachAudits(a.versionId)).toBe('1');

    // 정리된 초안을 일반 승인으로 발행해도 후보를 쥐지 않는다 — 후보의 결과로 보이지 않는다
    expect((await post(`/versions/${a.versionId}/submit`)).status).toBe(200);
    expect((await post(`/versions/${a.versionId}/approve`, { changeNote: '옛 초안 발행', effectiveDate: day(40) })).status).toBe(200);
    expect(sql(`SELECT status || '|' || coalesce(source_candidate_id, '-') FROM article_versions WHERE id = '${a.versionId}';`)).toBe('published|-');
    expect((await api(`/amendments/${a.candidateId}`, { token: t.token })).body.resultVersion).toBeNull();
  }, 150_000);
});

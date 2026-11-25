import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';
import { sql } from './race';
import { auditRowHash, lockOf, seedReviewCandidate, simulateLegacyWithdraw } from './amendment-seed';

const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * T-178 (PAT-21 — 특허 도 12) 시행 예정 철회를 정정 기록으로. 철회는 승인 뒤의 정정이다 — 지운 값을 잃지 않고, 원 승인 기록을
 * 가리키는 후속 기록을 남긴다.
 *
 * 막고 싶은 사고:
 * 1. 철회가 버전의 승인자·승인 시각·발행일·시행일을 지우는데 그 값이 어디에도 남지 않는다
 * 2. 승인 철회가 후보를 "반려"로 돌려 반려와 정정이 구분되지 않는다
 * 3. 철회된 초안이 원천 후보 id(유일)를 쥐고 있어, 같은 후보를 다시 승인하면 유일 충돌로 500 이 난다(옛 방식 철회 데이터 포함)
 */
describe('T-178 시행 예정 철회를 정정 기록으로', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  const E = day(30); // 법령 시행일 = 사내 시행일(시행 예정)
  const EARLY = day(20); // 법령 시행일보다 이른 사내 시행일 — 조기 시행 이유는 버전이 아니라 승인 감사에만 있다
  const cleanups: (() => void)[] = [];
  let policyId = '';
  let chapterId = '';
  const post = (path: string, json?: unknown) => api(path, { method: 'POST', token: t.token, json });

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('withdraw-fix');
    const set = await createPolicyWithArticle(t.token, `WDF-${Date.now().toString(36)}`, '정정규정');
    policyId = set.policy.id;
    chapterId = set.chapter.id;
  }, 90_000);

  afterAll(() => {
    for (const c of cleanups) c();
  });

  /** 후보를 시행 예정으로 승인하고 발행된 버전 id 를 돌려준다(법령 시행일보다 이르면 이유와 함께) */
  const approveScheduled = async (candidateId: string, effectiveDate = E, earlyReason?: string) => {
    const r = await post(`/amendments/${candidateId}/approve`, { effectiveDate, changeNote: '법령 반영', earlyReason, ...(await lockOf(t.token, candidateId)) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.resultVersion.id as string;
  };

  describe('후보로 승인한 시행 예정 버전을 철회하면', () => {
    let seed: Awaited<ReturnType<typeof seedReviewCandidate>>;
    let versionId = '';
    let approveAuditId = '';
    let approveAuditHash = '';

    beforeAll(async () => {
      seed = await seedReviewCandidate(t.token, policyId, chapterId, { number: 2, lawEffective: E, tag: '철회' });
      cleanups.push(seed.cleanup);
      versionId = await approveScheduled(seed.candidateId, EARLY, '노사 합의로 앞당김');
      approveAuditId = sql(`SELECT id FROM audit_logs WHERE action = 'amendment.approve' AND entity_id = '${seed.candidateId}';`);
      approveAuditHash = auditRowHash(approveAuditId);
      const w = await post(`/versions/${versionId}/withdraw`, { reason: '시행 보류' });
      expect(w.status, JSON.stringify(w.body)).toBe(200);
    }, 120_000);

    it('버전은 초안이 되고 원천 후보·변경 이벤트 연결을 뗀다, 후보는 반려가 아니라 작성 상태로 — 정정 전환 (T-178)', async () => {
      expect(sql(`SELECT status || '|' || coalesce(source_candidate_id, '-') || '|' || coalesce(change_event_id, '-') FROM article_versions WHERE id = '${versionId}';`)).toBe(
        'draft|-|-',
      );
      const cand = (await api(`/amendments/${seed.candidateId}`, { token: t.token })).body;
      expect(cand.reviewState).toBe('draft');
      expect(cand.resultVersion).toBeNull();
      expect(
        sql(`SELECT from_state || '|' || to_state || '|' || kind || '|' || reason FROM amendment_state_changes WHERE candidate_id = '${seed.candidateId}' ORDER BY created_at DESC, id DESC LIMIT 1;`),
      ).toBe('approved|draft|correction|승인 철회 — 시행 보류');
    });

    it('철회 감사가 원 승인 감사를 가리키고 지운 승인 정보를 남긴다 — 원 승인 감사는 그대로 (T-178)', () => {
      const row = JSON.parse(
        sql(`SELECT json_build_object('correctsId', corrects_id, 'details', details) FROM audit_logs WHERE action = 'version.withdraw' AND entity_id = '${versionId}';`),
      );
      expect(row.correctsId).toBe(approveAuditId);
      expect(row.details.reason).toBe('시행 보류');
      expect(row.details.before).toMatchObject({
        status: 'published',
        approvedBy: t.user.id,
        effectiveDate: EARLY,
        changeNote: '법령 반영',
        earlyReason: '노사 합의로 앞당김',
        sourceCandidateId: seed.candidateId,
        changeEventId: seed.changeEventId,
      });
      expect(row.details.before.approvedAt).toEqual(expect.any(String));
      expect(row.details.before.publishedAt).toEqual(expect.any(String));
      expect(row.details.after).toMatchObject({ status: 'draft', approvedBy: null, effectiveDate: null, sourceCandidateId: null, changeEventId: null });
      expect(auditRowHash(approveAuditId)).toBe(approveAuditHash);
    });

    it('같은 후보를 다시 검토 요청해 승인할 수 있다 — 철회된 초안은 남고 새 버전이 생긴다 (T-178)', async () => {
      const review = await post(`/amendments/${seed.candidateId}/review`, await lockOf(t.token, seed.candidateId));
      expect(review.status, JSON.stringify(review.body)).toBe(200);
      const again = await approveScheduled(seed.candidateId);
      expect(again).not.toBe(versionId);
      expect(sql(`SELECT source_candidate_id FROM article_versions WHERE id = '${again}';`)).toBe(seed.candidateId);
      expect(sql(`SELECT status FROM article_versions WHERE id = '${versionId}';`)).toBe('draft');
    });
  });

  it('T-178 전 철회 뒤 그때 손질까지 해 작성 상태가 된 후보(초안이 원천 후보를 쥠)도 검토 → 승인된다 — 승인이 옛 초안의 연결을 떼고 남긴다 (T-178)', async () => {
    const seed = await seedReviewCandidate(t.token, policyId, chapterId, { number: 3, lawEffective: E, tag: '옛철회' });
    cleanups.push(seed.cleanup);
    const versionId = await approveScheduled(seed.candidateId);
    simulateLegacyWithdraw({ tenantId: t.user.tenantId, userId: t.user.id, candidateId: seed.candidateId, articleId: seed.articleId, versionId, candidateState: 'draft' });
    const cur = (await api(`/amendments/${seed.candidateId}`, { token: t.token })).body;
    expect(cur.resultVersion).toBeNull(); // 원천 후보를 쥔 초안은 승인 결과가 아니다
    expect((await post(`/amendments/${seed.candidateId}/review`, await lockOf(t.token, seed.candidateId))).status).toBe(200);
    const again = await post(`/amendments/${seed.candidateId}/approve`, { effectiveDate: E, changeNote: '다시 반영', ...(await lockOf(t.token, seed.candidateId)) });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    // 옛 초안의 원천 연결은 승인이 떼고(승인 감사 detachedVersionIds), 새 버전이 그 후보의 결과가 된다
    expect(sql(`SELECT coalesce(source_candidate_id, '-') FROM article_versions WHERE id = '${versionId}';`)).toBe('-');
    expect(sql(`SELECT source_candidate_id FROM article_versions WHERE id = '${again.body.resultVersion.id}';`)).toBe(seed.candidateId);
    const detached = JSON.parse(sql(`SELECT details->'detachedVersionIds' FROM audit_logs WHERE action = 'amendment.approve' AND entity_id = '${seed.candidateId}' ORDER BY created_at DESC LIMIT 1;`));
    expect(detached).toEqual([versionId]);
    // 뗀 버전의 기록에도 남는다 — 그 버전을 대상으로, 떼게 한 결정·전·후와 새 버전
    const trail = JSON.parse(sql(`SELECT details FROM audit_logs WHERE action = 'version.source_detach' AND entity_id = '${versionId}';`));
    expect(trail).toMatchObject({
      candidateId: seed.candidateId,
      cause: 'amendment.approve',
      newVersionId: again.body.resultVersion.id,
      status: 'draft',
      before: { sourceCandidateId: seed.candidateId, changeEventId: seed.changeEventId },
      after: { sourceCandidateId: null, changeEventId: null },
    });
  }, 120_000);
});

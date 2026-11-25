import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';
import { expect409, sql } from './race';
import { lockOf, seedReviewCandidate, simulateLegacyWithdraw } from './amendment-seed';

const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * T-178 (PAT-21) 반려된 후보를 손질로 다시 여는 길 — 반려 정정과 같은 판정·떼기를 거친다. T-178 전 철회 초안이 후보를 원천으로 쥐고 있으면
 * 손질이 그 연결을 떼고(그 초안을 나중에 일반 승인으로 발행해도 후보를 쥐지 않게), 이미 발행돼 후보를 쥐고 있으면 409 — 다시 열어도
 * 다시 승인할 수 없다.
 *
 * 막고 싶은 사고: 반려 정정을 막은 상태(발행본이 후보를 쥠)를 손질이 우회해 후보를 되살리거나, 원천 연결이 남은 채 되살아나 그 초안을
 * 일반 승인하는 순간 후보가 승인 409 에 영원히 막힌다
 */
describe('T-178 반려 후보를 손질로 다시 열기', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let policyId = '';
  let chapterId = '';
  let n = 40;
  const E = day(30);
  const cleanups: (() => void)[] = [];
  const post = (path: string, json?: unknown) => api(path, { method: 'POST', token: t.token, json });
  const edit = async (candidateId: string, text: string) => {
    const cur = (await api(`/amendments/${candidateId}`, { token: t.token })).body;
    return api(`/amendments/${candidateId}`, {
      method: 'PATCH',
      token: t.token,
      json: { candidateContent: `${cur.candidateContent} ${text}`, note: '반려 뒤 손질', ...(await lockOf(t.token, candidateId)) },
    });
  };
  /** 후보 하나를 승인했다가 T-178 전 방식으로 철회된 모양으로 — 승인으로 발행한 버전 id */
  const legacy = async (tag: string) => {
    const s = await seedReviewCandidate(t.token, policyId, chapterId, { number: n++, lawEffective: E, tag });
    cleanups.push(s.cleanup);
    const ok = await post(`/amendments/${s.candidateId}/approve`, { effectiveDate: E, changeNote: '법령 반영', ...(await lockOf(t.token, s.candidateId)) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const versionId = ok.body.resultVersion.id as string;
    simulateLegacyWithdraw({ tenantId: t.user.tenantId, userId: t.user.id, candidateId: s.candidateId, articleId: s.articleId, versionId });
    return { ...s, versionId };
  };

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('reopen-edit');
    const set = await createPolicyWithArticle(t.token, `RPE-${Date.now().toString(36)}`, '다시열기규정');
    policyId = set.policy.id;
    chapterId = set.chapter.id;
  }, 90_000);

  afterAll(() => {
    for (const c of cleanups) c();
  });

  it('옛 철회 초안이 후보를 쥔 반려 후보를 손질하면 그 연결을 함께 떼고 남긴다 — 그 뒤 검토·승인된다 (T-178)', async () => {
    const s = await legacy('손질');
    const res = await edit(s.candidateId, '다시 손질.');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.reviewState).toBe('draft');
    expect(sql(`SELECT coalesce(source_candidate_id, '-') || '|' || coalesce(change_event_id, '-') FROM article_versions WHERE id = '${s.versionId}';`)).toBe('-|-');
    expect(JSON.parse(sql(`SELECT details FROM audit_logs WHERE action = 'version.source_detach' AND entity_id = '${s.versionId}';`))).toMatchObject({
      candidateId: s.candidateId,
      cause: 'amendment.edit',
      newVersionId: null,
      before: { sourceCandidateId: s.candidateId, changeEventId: s.changeEventId },
    });
    expect(
      JSON.parse(sql(`SELECT details->'detachedVersionIds' FROM audit_logs WHERE action = 'amendment.edit' AND entity_id = '${s.candidateId}' ORDER BY created_at DESC LIMIT 1;`)),
    ).toEqual([s.versionId]);

    expect((await post(`/amendments/${s.candidateId}/review`, await lockOf(t.token, s.candidateId))).status).toBe(200);
    const again = await post(`/amendments/${s.candidateId}/approve`, { effectiveDate: E, changeNote: '다시 반영', ...(await lockOf(t.token, s.candidateId)) });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    // 이미 손질 때 뗐으니 승인은 뗄 것이 없다
    expect(sql(`SELECT coalesce(details->>'detachedVersionIds', '-') FROM audit_logs WHERE action = 'amendment.approve' AND entity_id = '${s.candidateId}' ORDER BY created_at DESC LIMIT 1;`)).toBe('-');
  }, 120_000);

  it('그 초안이 이미 일반 승인으로 발행돼 후보를 쥐고 있으면 손질도 409 — 판·상태가 그대로다 (T-178)', async () => {
    const s = await legacy('발행본');
    expect((await post(`/versions/${s.versionId}/submit`)).status).toBe(200);
    expect((await post(`/versions/${s.versionId}/approve`, { changeNote: '일반 승인으로 다시', effectiveDate: E })).status).toBe(200);
    const before = sql(`SELECT review_state || '|' || revision || '|' || lock_version FROM amendment_candidates WHERE id = '${s.candidateId}';`);

    const res = await edit(s.candidateId, '되살리기.');
    expect409(res, '이 후보로 발행한 버전');
    expect(res.body.reason).toBe('issued_source');
    expect(res.body.message).toContain('고쳐도 다시 승인할 수 없습니다');
    expect(sql(`SELECT review_state || '|' || revision || '|' || lock_version FROM amendment_candidates WHERE id = '${s.candidateId}';`)).toBe(before);
    expect(sql(`SELECT count(*) FROM amendment_revisions WHERE candidate_id = '${s.candidateId}';`)).toBe('1');
    expect(sql(`SELECT status || '|' || source_candidate_id FROM article_versions WHERE id = '${s.versionId}';`)).toBe(`published|${s.candidateId}`);
  }, 120_000);
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';
import { sql } from './race';
import { lockOf, seedReviewCandidate } from './amendment-seed';

const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * T-178 (PAT-21 — 특허 도 12) 감사 조회 — 한 대상의 기록만 모아 보기(entityType·entityId)와, 원 기록 ↔ 정정 기록 사슬. 원 기록과 정정
 * 기록은 대상이 다를 수 있다(후보 승인 ↔ 버전 철회) — 대상 필터가 아니라 정정 대상 열로 잇는다.
 */
describe('T-178 감사 조회 — 대상 필터와 정정 사슬', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let other: Awaited<ReturnType<typeof createTenant>>;
  const E = day(30);
  const cleanups: (() => void)[] = [];
  const ids = { rejected: '', reject: '', correct: '', approved: '', approve: '', version: '', withdraw: '' };
  const post = (path: string, json?: unknown) => api(path, { method: 'POST', token: t.token, json });
  const auditId = (action: string, entityId: string) =>
    sql(`SELECT id FROM audit_logs WHERE action = '${action}' AND entity_id = '${entityId}' ORDER BY created_at DESC LIMIT 1;`);

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('audit-fix');
    other = await createTenant('audit-fix-o');
    const set = await createPolicyWithArticle(t.token, `ADF-${Date.now().toString(36)}`, '감사정정규정');
    const a = await seedReviewCandidate(t.token, set.policy.id, set.chapter.id, { number: 2, lawEffective: E, tag: '감사반려' });
    const b = await seedReviewCandidate(t.token, set.policy.id, set.chapter.id, { number: 3, lawEffective: E, tag: '감사철회' });
    cleanups.push(a.cleanup, b.cleanup);
    ids.rejected = a.candidateId;
    expect((await post(`/amendments/${a.candidateId}/reject`, { reason: '반려', ...(await lockOf(t.token, a.candidateId)) })).status).toBe(200);
    expect((await post(`/amendments/${a.candidateId}/correct-rejection`, { reason: '반려 정정 사유', ...(await lockOf(t.token, a.candidateId)) })).status).toBe(200);
    ids.reject = auditId('amendment.reject', a.candidateId);
    ids.correct = auditId('amendment.reject_correct', a.candidateId);

    ids.approved = b.candidateId;
    const ok = await post(`/amendments/${b.candidateId}/approve`, { effectiveDate: E, changeNote: '법령 반영', ...(await lockOf(t.token, b.candidateId)) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    ids.version = ok.body.resultVersion.id;
    expect((await post(`/versions/${ids.version}/withdraw`, { reason: '시행 보류' })).status).toBe(200);
    ids.approve = auditId('amendment.approve', b.candidateId);
    ids.withdraw = auditId('version.withdraw', ids.version);
  }, 150_000);

  afterAll(() => {
    for (const c of cleanups) c();
  });

  it('대상으로 거르면 그 후보의 기록만 — 정정 기록은 원 기록을, 원 기록은 정정된 수를 보인다 (T-178)', async () => {
    const res = await api(`/audit-logs?entityType=amendment_candidate&entityId=${ids.rejected}&limit=200`, { token: t.token });
    expect(res.status).toBe(200);
    const rows = res.body.rows as any[];
    expect(rows.length).toBe(res.body.total);
    expect(rows.every((r) => r.entityType === 'amendment_candidate' && r.entityId === ids.rejected)).toBe(true);
    expect(rows.map((r) => r.action).sort()).toEqual(['amendment.reject', 'amendment.reject_correct', 'amendment.request_review']);
    expect(rows.find((r) => r.id === ids.reject)).toMatchObject({ correctsId: null, correctedCount: 1 });
    expect(rows.find((r) => r.id === ids.correct)).toMatchObject({ correctsId: ids.reject, correctedCount: 0 });

    const byId = await api(`/audit-logs?entityId=${ids.rejected}&limit=200`, { token: t.token });
    expect(byId.body.total).toBe(res.body.total);
    const wrongType = await api(`/audit-logs?entityType=ArticleVersion&entityId=${ids.rejected}`, { token: t.token });
    expect(wrongType.body.total).toBe(0);
  });

  it('상세는 원 기록 ↔ 정정 기록을 양쪽에서 잇는다 — 대상이 다른 승인(후보) ↔ 철회(버전)도 (T-178)', async () => {
    const reject = (await api(`/audit-logs/${ids.reject}`, { token: t.token })).body;
    expect(reject.corrects).toBeNull();
    expect(reject.correctedBy).toEqual([
      expect.objectContaining({ id: ids.correct, action: 'amendment.reject_correct', reason: '반려 정정 사유', user: expect.objectContaining({ id: t.user.id }) }),
    ]);
    expect(reject.correctedBy[0].tenantId).toBeUndefined();

    const correct = (await api(`/audit-logs/${ids.correct}`, { token: t.token })).body;
    expect(correct.corrects).toMatchObject({ id: ids.reject, action: 'amendment.reject', entityType: 'amendment_candidate', entityId: ids.rejected });
    expect(correct.correctedBy).toEqual([]);
    expect(correct.correctsId).toBe(ids.reject);

    const withdraw = (await api(`/audit-logs/${ids.withdraw}`, { token: t.token })).body;
    expect(withdraw.corrects).toMatchObject({ id: ids.approve, action: 'amendment.approve', entityType: 'amendment_candidate', entityId: ids.approved });
    expect(withdraw.entityType).toBe('ArticleVersion');
    const approve = (await api(`/audit-logs/${ids.approve}`, { token: t.token })).body;
    expect(approve.correctedBy).toEqual([expect.objectContaining({ id: ids.withdraw, action: 'version.withdraw', reason: '시행 보류', entityId: ids.version })]);
  });

  it('다른 회사의 기록이 원 기록을 가리켜도(앱 경로로는 생기지 않는다) 정정 수·사슬에 세지 않는다 (T-178)', async () => {
    const foreign = randomUUID();
    sql(`INSERT INTO audit_logs (id, tenant_id, action, entity_type, entity_id, corrects_id, details)
      VALUES ('${foreign}', '${other.user.tenantId}', 'amendment.reject_correct', 'amendment_candidate', '${ids.rejected}', '${ids.reject}', '{"reason": "남의 회사"}'::jsonb);`);
    try {
      const list = await api(`/audit-logs?entityType=amendment_candidate&entityId=${ids.rejected}&limit=200`, { token: t.token });
      expect(list.body.rows.find((r: any) => r.id === ids.reject).correctedCount).toBe(1);
      const detail = (await api(`/audit-logs/${ids.reject}`, { token: t.token })).body;
      expect(detail.correctedBy.map((c: any) => c.id)).toEqual([ids.correct]);
    } finally {
      sql(`DELETE FROM audit_logs WHERE id = '${foreign}';`);
    }
  });

  it('다른 회사는 기록도 사슬도 못 보고, 대상 값이 너무 길면 400 (T-178)', async () => {
    expect((await api(`/audit-logs/${ids.correct}`, { token: other.token })).status).toBe(404);
    expect((await api(`/audit-logs?entityId=${ids.rejected}`, { token: other.token })).body.total).toBe(0);
    expect((await api(`/audit-logs?entityId=${'x'.repeat(65)}`, { token: t.token })).status).toBe(400);
    expect((await api(`/audit-logs?entityType=${'x'.repeat(65)}`, { token: t.token })).status).toBe(400);
  });
});

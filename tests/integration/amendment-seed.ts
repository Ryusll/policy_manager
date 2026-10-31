import { expect } from 'vitest';
import { randomUUID } from 'crypto';
import { api } from './helpers';
import { sql } from './race';

/**
 * 개정 후보 하나를 검토 요청 상태까지 심는다(T-178 정정 시험이 함께 쓴다). 법령·조항·변경 이벤트는 SQL 로 심고(법제처 없이),
 * 조문은 2020-01-01 시행본 하나, 확정 연결을 건 뒤 후보를 만들어 검토를 요청한다. 정리 함수를 함께 돌려준다.
 */
export async function seedReviewCandidate(
  token: string,
  policyId: string,
  chapterId: string,
  o: { number: number; lawEffective: string; tag: string },
) {
  const post = (path: string, json?: unknown) => api(path, { method: 'POST', token, json });
  const [sourceId, lawId, lawArt, ev] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  sql(`
    INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
    INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, updated_at)
      VALUES ('${lawId}', '${sourceId}', '9${String(o.number).padStart(5, '0')}', '99${String(o.number).padStart(5, '0')}', '정정시험법${o.tag}', '${o.lawEffective}', now());
    INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, label, content, version_key, sort_order, updated_at)
      VALUES ('${lawArt}', '${lawId}', '60/1/', 60, 1, '제60조제1항', '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.', 'v1:p2', 1, now());
    INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, before_version_key, after_version_key, law_effective_date, received_via, amendments_processed_at)
      VALUES ('${ev}', '${lawId}', '${lawArt}', '60/1/', 'modified', '사용자는 근로자에게 15일의 유급휴가를 주어야 한다.', '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.', 'v1:p1', 'v1:p2', '${o.lawEffective}', 'poll', now());
  `);
  const cleanup = () =>
    sql(`
      DELETE FROM amendment_candidates WHERE change_event_id = '${ev}';
      UPDATE article_versions SET change_event_id = NULL WHERE change_event_id = '${ev}';
      DELETE FROM law_links WHERE law_article_id = '${lawArt}';
      DELETE FROM laws WHERE id = '${lawId}'; DELETE FROM law_sources WHERE id = '${sourceId}';
    `);
  // 중간 단언이 실패해도 심은 법령이 남지 않게(남은 법령은 다른 시험의 동기화 순서를 바꾼다) — 정리하고 다시 던진다
  try {
    const art = await post(`/policies/${policyId}/chapters/${chapterId}/articles`, { number: o.number, title: `조${o.number}`, content: '직원에게는 매년 15일의 연차휴가를 준다.' });
    expect(art.status, JSON.stringify(art.body)).toBeLessThan(300);
    const articleId = art.body.id as string;
    const pub = await post(`/policies/${policyId}/publish-drafts`, { changeNote: '제정', effectiveDate: '2020-01-01' });
    expect(pub.status, JSON.stringify(pub.body)).toBeLessThan(300);
    const link = await post('/law-links', { lawArticleId: lawArt, articleId, relationType: 'delegation', evidenceText: '연차휴가 일수' });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const g = await post('/amendments/generate', { changeEventId: ev });
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    const candidateId = g.body.created.find((c: any) => c.articleId === articleId).id as string;
    const c = (await api(`/amendments/${candidateId}`, { token })).body;
    const review = await post(`/amendments/${candidateId}/review`, { expectedRevision: c.revision, expectedLockVersion: c.lockVersion });
    expect(review.status, JSON.stringify(review.body)).toBe(200);
    return { candidateId, articleId, changeEventId: ev, cleanup };
  } catch (e) {
    // 정리가 실패해도 원래 실패를 가리지 않는다 — 정리 실패는 경고로 남기고 원래 오류를 던진다
    try {
      cleanup();
    } catch (c) {
      console.warn('시드 정리 실패', c);
    }
    throw e;
  }
}

/** 후보의 지금 판·잠금 — 승인·반려·정정 요청에 싣는다 */
export async function lockOf(token: string, candidateId: string) {
  const b = (await api(`/amendments/${candidateId}`, { token })).body;
  return { expectedRevision: b.revision as number, expectedLockVersion: b.lockVersion as number };
}

/** 감사 행 한 줄 전체의 지문 — 원 기록이 그대로인지 본다 */
export const auditRowHash = (id: string) => sql(`SELECT md5(row_to_json(a)::text) FROM audit_logs a WHERE id = '${id}';`);

/**
 * T-178 전 시행 예정 철회가 남긴 모양을 SQL 로 만든다 — 승인으로 발행한 버전은 원천 후보·변경 이벤트를 쥔 채 초안, 기준 본문은 다시
 * 시행본, 후보는 승인 → 반려(마이그레이션이 종류를 정정으로 채운 모양), 철회 감사는 원 기록을 가리키지 않는다. candidateState 'draft' 면
 * 그 뒤 T-178 전에 손질까지 해 작성 상태가 된 후보다. 옛 철회 감사 id 를 돌려준다
 */
export function simulateLegacyWithdraw(o: {
  tenantId: string;
  userId: string;
  candidateId: string;
  articleId: string;
  versionId: string;
  candidateState?: 'rejected' | 'draft';
}) {
  const auditId = randomUUID();
  const state = o.candidateState ?? 'rejected';
  sql(`
    UPDATE article_versions SET status = 'draft', approved_by = NULL, approved_at = NULL, published_at = NULL, effective_date = NULL WHERE id = '${o.versionId}';
    UPDATE article_versions SET status = 'published' WHERE article_id = '${o.articleId}' AND status = 'archived';
    UPDATE amendment_candidates SET review_state = '${state}', lock_version = lock_version + 1 WHERE id = '${o.candidateId}';
    INSERT INTO amendment_state_changes (id, tenant_id, candidate_id, from_state, to_state, revision, reason, actor_id, kind)
      SELECT '${randomUUID()}', tenant_id, id, 'approved', 'rejected', revision, '승인 철회 — 옛 철회', '${o.userId}', 'correction' FROM amendment_candidates WHERE id = '${o.candidateId}';
    INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
      VALUES ('${auditId}', '${o.tenantId}', '${o.userId}', 'version.withdraw', 'ArticleVersion', '${o.versionId}', json_build_object('candidateId', '${o.candidateId}', 'reason', '옛 철회')::jsonb);
    ${
      state === 'draft'
        ? `INSERT INTO amendment_state_changes (id, tenant_id, candidate_id, from_state, to_state, revision, reason, actor_id)
             SELECT '${randomUUID()}', tenant_id, id, 'rejected', 'draft', revision, '반려된 후보를 고쳐 작성 상태로', '${o.userId}' FROM amendment_candidates WHERE id = '${o.candidateId}';`
        : ''
    }
  `);
  return auditId;
}

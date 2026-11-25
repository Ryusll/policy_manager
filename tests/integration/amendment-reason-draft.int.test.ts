import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';
import { sql } from './race';
import { lockOf, seedReviewCandidate } from './amendment-seed';

const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const kdate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}. ${m}. ${d}.`;
};

/**
 * T-161 (SRS LAW-21) 개정 이유 초안 — 후보 상세가 '사유 초안 넣기'의 사실 문장을 주고, 승인할 때 서버가 같은 함수로 다시 만들어
 * 사유와 견준 결과를 승인 감사에 남긴다.
 *
 * 막고 싶은 사고:
 * 1. 화면의 초안과 승인 때 견주는 초안이 갈라진다(판 기록·공포일이 빠지거나 다른 변환을 쓴다)
 * 2. 초안을 고치지 않고 승인했는지가 남지 않거나, 고쳐서 승인했는데 '그대로'로 남는다
 * 3. 같은 승인을 다시 보내면 기록이 늘어난다, 다른 회사 후보의 초안이 보인다
 */
describe('T-161 개정 이유 초안 — 상세 응답과 승인 기록', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let other: Awaited<ReturnType<typeof createTenant>>;
  const cleanups: (() => void)[] = [];
  const E = day(30);
  let asIs = '';
  let edited = '';
  let noVersion = '';

  /** 판 기록(법률 제21700호)과 공포일을 변경 이벤트에 붙인다 — 시드는 둘 다 비워 둔다. 판 기록은 법령을 지울 때 함께 지워진다(Cascade) */
  const withVersion = (changeEventId: string) => {
    const v = randomUUID();
    sql(`
      INSERT INTO law_versions (id, law_id, mst, kind, law_type, promulgated_date, promulgation_no, revision_type, effective_date)
        SELECT '${v}', law_id, 'r${v.slice(0, 8)}', 'change', '법률', '2026-05-26', '21700', '일부개정', law_effective_date FROM law_change_events WHERE id = '${changeEventId}';
      UPDATE law_change_events SET law_version_id = '${v}', promulgated_date = '2026-05-26' WHERE id = '${changeEventId}';
    `);
  };
  const detail = async (id: string, token = t.token) => api(`/amendments/${id}`, { token });
  const approve = async (id: string, changeNote: string) =>
    api(`/amendments/${id}/approve`, { method: 'POST', token: t.token, json: { ...(await lockOf(t.token, id)), effectiveDate: E, changeNote } });
  const draftRecordOf = (id: string) =>
    sql(`SELECT count(*) || '|' || coalesce(max((details->'changeNoteDraft')::text), 'null') FROM audit_logs WHERE action = 'amendment.approve' AND entity_id = '${id}';`);

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('reason-draft');
    other = await createTenant('reason-draft-o');
    const set = await createPolicyWithArticle(t.token, `RD-${Date.now().toString(36)}`, '초안시험규정');
    const seed = async (number: number, tag: string, version: boolean) => {
      const s = await seedReviewCandidate(t.token, set.policy.id, set.chapter.id, { number, lawEffective: E, tag });
      cleanups.push(s.cleanup);
      if (version) withVersion(s.changeEventId);
      return s.candidateId;
    };
    asIs = await seed(50, '초안A', true);
    edited = await seed(51, '초안B', true);
    noVersion = await seed(52, '초안C', false);
  }, 180_000);

  afterAll(() => {
    for (const c of cleanups) c();
  });

  it('상세가 사실 문장을 준다 — 정식 제명·조항·법률 번호·공포일·시행일, 우리 조문 제목, 바뀐 글자 쌍. 한 줄 500자 이하', async () => {
    const res = await detail(asIs);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const draft = res.body.reasonDraft as string;
    // 값 규칙은 숫자만 바꾸지만 인용은 뒤의 같은 단위까지(‘15일’) — 시연 문장과 같은 모양
    expect(draft).toBe(`「정정시험법초안A」 제60조제1항 개정(법률 제21700호, 2026. 5. 26. 공포, ${kdate(E)} 시행)에 따라 제50조(조50) 중 ‘15일’을 ‘20일’로 바꿈`);
    expect(draft).not.toContain('\n');
    expect(draft.length).toBeLessThanOrEqual(500);
  });

  it('판 기록이 없는 옛 변경은 번호·공포일 없이 — 빈 괄호를 남기지 않는다', async () => {
    const draft = (await detail(noVersion)).body.reasonDraft as string;
    expect(draft).toContain(`「정정시험법초안C」 제60조제1항 개정(${kdate(E)} 시행)에 따라 제52조(조52) 중 `);
    expect(draft).not.toContain('법률 제');
  });

  it('초안 그대로 승인하면 승인 감사에 "그대로"와 규칙 판이 남고(초안 글은 사유와 같아 다시 쓰지 않는다), 같은 승인을 다시 보내도 기록이 늘지 않는다', async () => {
    const draft = (await detail(asIs)).body.reasonDraft as string;
    const ok = await approve(asIs, draft);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const [count, record] = draftRecordOf(asIs).split('|');
    expect(count).toBe('1');
    expect(JSON.parse(record)).toEqual({ matches: true, rule: 'reason-draft-v1' });
    expect(sql(`SELECT change_note FROM article_versions WHERE source_candidate_id = '${asIs}';`)).toBe(draft);
    // 응답이 유실돼 다시 보낸 같은 승인 — 버전·감사를 새로 만들지 않는다
    const again = await api(`/amendments/${asIs}/approve`, {
      method: 'POST',
      token: t.token,
      json: { expectedRevision: ok.body.revision, expectedLockVersion: ok.body.lockVersion - 1, effectiveDate: E, changeNote: draft },
    });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.alreadyApproved).toBe(true);
    expect(draftRecordOf(asIs).split('|')[0]).toBe('1');
  });

  it('한 글자라도 고쳐서 승인하면 "고침"으로 남는다 — 견준 초안 글도 함께', async () => {
    const draft = (await detail(edited)).body.reasonDraft as string;
    const ok = await approve(edited, `${draft} (이사회 의결 반영)`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(JSON.parse(draftRecordOf(edited).split('|')[1])).toEqual({ matches: false, draft, rule: 'reason-draft-v1' });
  });

  it('다른 회사의 후보는 초안도 없다 — 404', async () => {
    expect((await detail(noVersion, other.token)).status).toBe(404);
  });
});

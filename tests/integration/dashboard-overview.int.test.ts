import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { api, createTenant, login, waitForApi } from './helpers';
import { sql } from './race';
import { lockOf } from './amendment-seed';
import { todayDateOnly, toDateOnlyString } from '../../apps/api/src/common/date-only';

/*
 * 대시보드 지표 카드·법령 개정 구역 (T-213, SRS LAW-29·LAW-19 수정) — GET /dashboard/overview.
 * 숫자가 다른 화면의 숫자와 같은 규칙인지(개정 검토 목록 total·제·개정 예고 목록 합), 조 수 규칙, 연결 법령 확인 상태,
 * 최근 법령 개정 줄, 다른 회사의 연결·후보가 섞이지 않는지, 역할 범위를 본다.
 * 법령·조항·변경은 SQL 로 심고(법제처 없이) afterAll 에서 지운다 — 남은 법령은 다른 시험(법령 동기화)의 차례를 바꾼다.
 */

const today = toDateOnlyString(todayDateOnly());
const plusDays = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const ids = {
  source: randomUUID(),
  laws: [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const,
  arts: [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const,
  events: [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const,
};
const ext = () => String(800000 + Math.floor(Math.random() * 99999));

type Tenant = Awaited<ReturnType<typeof createTenant>>;
let A: Tenant;
let B: Tenant;
const art: Record<string, string> = {};
let overview: any;

const post = (token: string, path: string, json?: unknown) => api(path, { method: 'POST', token, json });
async function ok(p: Promise<{ status: number; body: any }>, label: string) {
  const r = await p;
  expect(r.status, `${label}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
  return r.body;
}
async function addArticle(t: Tenant, policyId: string, chapterId: string, key: string, json: Record<string, unknown>) {
  const body = await ok(post(t.token, `/policies/${policyId}/chapters/${chapterId}/articles`, { content: `${key} 본문`, ...json }), key);
  art[key] = body.id;
}
async function publishedVersionId(token: string, articleId: string) {
  const versions = await ok(api(`/articles/${articleId}/versions`, { token }), 'versions');
  return (versions as any[]).find((v) => v.status === 'published').id as string;
}

function cleanup() {
  const lawArts = ids.arts.map((x) => `'${x}'`).join(',');
  const events = ids.events.map((x) => `'${x}'`).join(',');
  const laws = ids.laws.map((x) => `'${x}'`).join(',');
  sql(`
    DELETE FROM amendment_candidates WHERE change_event_id IN (${events});
    UPDATE article_versions SET change_event_id = NULL WHERE change_event_id IN (${events});
    DELETE FROM law_change_events WHERE id IN (${events});
    DELETE FROM law_links WHERE law_article_id IN (${lawArts});
    DELETE FROM laws WHERE id IN (${laws});
    DELETE FROM law_sources WHERE id = '${ids.source}';
  `);
}

beforeAll(async () => {
  await waitForApi();
  A = await createTenant('dash-a');
  B = await createTenant('dash-b');

  // ── 회사 A 규정: 조 수 규칙을 가르는 조문들 ──
  const p1 = await ok(post(A.token, '/policies', { code: 'DASH-1', title: '대시보드 시험 규정' }), 'p1');
  const c1 = await ok(post(A.token, `/policies/${p1.id}/chapters`, { number: 1, title: '본문', suppressHeader: true }), 'c1');
  await addArticle(A, p1.id, c1.id, 'a1', { number: 1, title: '목적' });
  await addArticle(A, p1.id, c1.id, 'a2', { number: 2, title: '휴가' }); // 조 머리
  await addArticle(A, p1.id, c1.id, 'a2c1', { number: 2, clauseNumber: 1 }); // 같은 조의 항
  await addArticle(A, p1.id, c1.id, 'a2c2', { number: 2, clauseNumber: 2 });
  await addArticle(A, p1.id, c1.id, 'a3', { number: 3, title: '본조' }); // 제3조 — 제3조의2 와 다른 조
  await addArticle(A, p1.id, c1.id, 'a3b', { number: 3, branchNumber: 2, title: '가지 조' }); // 제3조의2
  await addArticle(A, p1.id, c1.id, 'a4', { number: 4, title: '오늘 폐지' });
  await addArticle(A, p1.id, c1.id, 'a7', { number: 7, title: '폐지 예정' });
  await ok(post(A.token, `/policies/${p1.id}/publish-drafts`, { changeNote: '제정', effectiveDate: '2020-01-01' }), 'publish p1');
  await addArticle(A, p1.id, c1.id, 'a6', { number: 6, title: '시행 예정만' });
  await ok(post(A.token, `/policies/${p1.id}/publish-drafts`, { changeNote: '신설', effectiveDate: plusDays(40) }), 'publish a6');
  await addArticle(A, p1.id, c1.id, 'a5', { number: 5, title: '초안만' }); // 발행하지 않는다
  await ok(post(A.token, `/versions/${await publishedVersionId(A.token, art.a4)}/archive`, { repealedOn: today }), 'repeal a4');
  await ok(post(A.token, `/versions/${await publishedVersionId(A.token, art.a7)}/archive`, { repealedOn: plusDays(20) }), 'repeal a7');

  // 둘째 활성 규정의 제1조 — 첫 규정의 제1조와 다른 조(장이 다르다)
  const p3 = await ok(post(A.token, '/policies', { code: 'DASH-3', title: '둘째 활성 규정' }), 'p3');
  const c3 = await ok(post(A.token, `/policies/${p3.id}/chapters`, { number: 1, title: '본문', suppressHeader: true }), 'c3');
  await addArticle(A, p3.id, c3.id, 'p3a1', { number: 1, title: '목적' });
  await ok(post(A.token, `/policies/${p3.id}/publish-drafts`, { changeNote: '제정', effectiveDate: '2020-01-01' }), 'publish p3');

  // 비활성 규정 — 조 수에 들지 않고 비활성 수에만
  const p2 = await ok(post(A.token, '/policies', { code: 'DASH-2', title: '비활성 규정' }), 'p2');
  const c2 = await ok(post(A.token, `/policies/${p2.id}/chapters`, { number: 1, title: '본문', suppressHeader: true }), 'c2');
  await addArticle(A, p2.id, c2.id, 'p2a1', { number: 1, title: '목적' });
  await ok(post(A.token, `/policies/${p2.id}/publish-drafts`, { changeNote: '제정', effectiveDate: '2020-01-01' }), 'publish p2');
  await ok(api(`/policies/${p2.id}`, { method: 'PUT', token: A.token, json: { isActive: false } }), 'deactivate p2');

  // ── 공용 법령(SQL): L1 확인 성공, L2 마지막 확인 실패(전에는 성공), L3 확인 전, L4 처음부터 실패(확인 기록 없음) ──
  const [L1, L2, L3, L4] = ids.laws;
  const [la1, la2, la3, la4, la5, la6] = ids.arts;
  sql(`
    INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${ids.source}', 'it-${ids.source.slice(0, 8)}', '통합테스트', 'http://example.test', now());
    INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, short_title, effective_date, last_checked_at, last_check_error, updated_at) VALUES
      ('${L1}', '${ids.source}', '${ext()}', '${ext()}', '대시보드시험기본법', '대시보드법', '2020-01-01', '2026-11-01 00:00:00+00', NULL, now()),
      ('${L2}', '${ids.source}', '${ext()}', '${ext()}', '대시보드시험둘째법', NULL, '2020-01-01', '2026-10-15 00:00:00+00', '확인 실패(시험)', now()),
      ('${L3}', '${ids.source}', '${ext()}', '${ext()}', '대시보드시험셋째법', NULL, '2020-01-01', NULL, NULL, now()),
      ('${L4}', '${ids.source}', '${ext()}', '${ext()}', '대시보드시험넷째법', NULL, '2020-01-01', NULL, '확인 실패(시험, 처음부터)', now());
    INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, label, content, version_key, sort_order, updated_at) VALUES
      ('${la1}', '${L1}', '60/1/', 60, 1, '제60조제1항', '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.', 'v1', 1, now()),
      ('${la2}', '${L1}', '61/', 61, NULL, '제61조', '휴가는 나누어 쓸 수 있다.', 'v1', 2, now()),
      ('${la3}', '${L2}', '10/', 10, NULL, '제10조', '보고는 매월 한다.', 'v1', 1, now()),
      ('${la4}', '${L3}', '5/', 5, NULL, '제5조', '목적을 정한다.', 'v1', 1, now()),
      ('${la5}', '${L4}', '7/', 7, NULL, '제7조', '기록을 남긴다.', 'v1', 1, now()),
      ('${la6}', '${L3}', '6/', 6, NULL, '제6조', '보고서를 보관한다.', 'v1', 2, now());
  `);

  // ── 연결: A 확정 다섯(법령 넷) + 추천 하나, B 확정 하나(같은 조항 — A 숫자에 섞이면 안 된다) ──
  for (const [articleId, lawArticleId] of [[art.a1, la1], [art.a2, la2], [art.a3b, la3], [art.a1, la4], [art.a2, la5]]) {
    await ok(post(A.token, '/law-links', { lawArticleId, articleId, relationType: 'citation' }), 'link A');
  }
  sql(`INSERT INTO law_links (id, tenant_id, law_article_id, article_id, relation_type, confirm_state, updated_at)
       VALUES ('${randomUUID()}', (SELECT id FROM tenants WHERE slug = '${A.slug}'), '${la1}', '${art.a3b}', 'citation', 'suggested', now());`);
  const pb = await ok(post(B.token, '/policies', { code: 'DASH-B', title: '다른 회사 규정' }), 'pb');
  const cb = await ok(post(B.token, `/policies/${pb.id}/chapters`, { number: 1, title: '본문', suppressHeader: true }), 'cb');
  await addArticle(B, pb.id, cb.id, 'b1', { number: 1, title: '휴가' });
  await ok(post(B.token, `/policies/${pb.id}/publish-drafts`, { changeNote: '제정', effectiveDate: '2020-01-01' }), 'publish b');
  await ok(post(B.token, '/law-links', { lawArticleId: la1, articleId: art.b1, relationType: 'citation' }), 'link B');
  // B 의 둘째 연결 — 후보를 만든 뒤 지운다(연결을 지워도 후보가 있는 변경은 '최근 법령 개정' 줄이 된다)
  const bLink2 = await ok(post(B.token, '/law-links', { lawArticleId: la6, articleId: art.b1, relationType: 'citation' }), 'link B2');

  // ── 변경(연결 뒤에 심는다 — 확정하는 순간의 자동 생성(T-149) 없이 '개정 후보 만들기'로 만든다) ──
  const [e1, e2, e3, e4, e5, e6, e7] = ids.events;
  sql(`
    INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, before_version_key, after_version_key, law_effective_date, promulgated_date, received_via, amendments_processed_at) VALUES
      ('${e1}', '${L1}', '${la1}', '60/1/', 'modified', '사용자는 근로자에게 15일의 유급휴가를 주어야 한다.', '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.', 'v0', 'v1', '${plusDays(60)}', '2026-10-01', 'poll', now()),
      ('${e2}', '${L1}', '${la2}', '61/', 'modified', '휴가는 한 번에 쓴다.', '휴가는 나누어 쓸 수 있다.', 'v0', 'v1', '2025-07-01', '2025-01-10', 'poll', now()),
      ('${e3}', '${L2}', '${la3}', '10/', 'modified', '보고는 분기마다 한다.', '보고는 매월 한다.', 'v0', 'v1', '${plusDays(30)}', '2026-09-01', 'poll', now());
    -- 법령 시행일이 없는 변경 셋: e4·e6 은 공포일로 줄을 가르고(같은 법령이라도 다른 개정), e5 는 공포일도 없어 감지한 날(한국 날짜 9/16 01시)로
    -- 줄을 세운다. e6 은 A 에게 여섯째 줄이라 잘린다(다섯 줄까지)
    INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, before_version_key, after_version_key, law_effective_date, promulgated_date, received_via, amendments_processed_at, detected_at) VALUES
      ('${e4}', '${L1}', '${la2}', '61/', 'modified', '휴가는 나누어 쓸 수 있다.', '휴가는 반일 단위로 나누어 쓸 수 있다.', 'v1', 'v2', NULL, '2026-08-01', 'poll', now(), now()),
      ('${e5}', '${L2}', '${la3}', '10/', 'modified', '보고는 매월 한다.', '보고는 매월 말일에 한다.', 'v1', 'v2', NULL, NULL, 'poll', now(), '2026-09-15 16:00:00+00'),
      ('${e6}', '${L1}', '${la1}', '60/1/', 'modified', '사용자는 근로자에게 10일의 유급휴가를 주어야 한다.', '사용자는 근로자에게 15일의 유급휴가를 주어야 한다.', 'u0', 'u1', NULL, '2024-01-01', 'poll', now(), '2024-01-02 00:00:00+00'),
      -- B 가 후보를 만든 뒤 연결을 지울 변경 — 확정 연결로는 닿지 않고 후보로만 줄이 된다
      ('${e7}', '${L3}', '${la6}', '6/', 'modified', '보고서는 1년 보관한다.', '보고서를 보관한다.', 'v0', 'v1', '${plusDays(90)}', '2026-05-01', 'poll', now(), now());
  `);
  const gen = async (t: Tenant, ev: string, articleId: string) => {
    const g = await ok(post(t.token, '/amendments/generate', { changeEventId: ev }), `generate ${ev}`);
    return (g.created as any[]).find((c) => c.articleId === articleId).id as string;
  };
  await gen(A, e1, art.a1); // 작성
  const c2Id = await gen(A, e2, art.a2);
  const c3Id = await gen(A, e3, art.a3b);
  await gen(B, e1, art.b1); // 다른 회사 후보 — A 숫자에 섞이면 안 된다
  await gen(B, e7, art.b1);
  const del = await api(`/law-links/${bLink2.id}`, { method: 'DELETE', token: B.token });
  expect(del.status, JSON.stringify(del.body)).toBeLessThan(300);
  // A 만의 후보 줄 둘 더 — B 의 줄 고르기에 남의 후보 변경이 끼면 B 의 셋째 줄(e6)이 다섯 줄 밖으로 밀려난다
  await gen(A, e4, art.a2);
  await gen(A, e5, art.a3b);
  // 시험 조문 본문에는 법령 문구가 없어 후보 본문이 기준 본문과 같다 — '개정 불필요'로 검토를 요청하려면 이유가 필요하다(LAW-7a)
  const reason = '시험 조문에는 바꿀 문구가 없다';
  await ok(post(A.token, `/amendments/${c2Id}/review`, { ...(await lockOf(A.token, c2Id)), reason }), 'review c2');
  await ok(post(A.token, `/amendments/${c2Id}/reject`, { ...(await lockOf(A.token, c2Id)), reason: '회사 기준이 이미 충족' }), 'reject c2');
  await ok(post(A.token, `/amendments/${c3Id}/review`, { ...(await lockOf(A.token, c3Id)), reason }), 'review c3'); // 검토(승인 대기)

  overview = await ok(api('/dashboard/overview', { token: A.token }), 'overview A');
}, 180_000);

afterAll(() => {
  cleanup();
});

describe('대시보드 지표 (T-213)', () => {
  it('① 관리 규정 — 활성·비활성 규정 수, 오늘 시행 중인 조 수(머리·항은 한 조, 가지 조 따로, 폐지·초안만·시행 예정만·비활성 규정은 빼고 폐지 예정은 넣는다)', () => {
    // 첫 규정 제1조·제2조·제3조·제3조의2·제7조 + 둘째 규정 제1조
    expect(overview.policies).toEqual({ active: 2, inactive: 1, articlesInForce: 6 });
  });

  it('② 연결 법령 — 확정 연결이 닿는 법령 수·확정 연결 수(추천 제외), 다른 회사 연결은 섞이지 않는다', () => {
    expect(overview.links).toMatchObject({ confirmedLinks: 5, suggestedLinks: 1, linkedLaws: 4 });
  });

  it('② 연결 법령 확인 상태 — 실패 우선(처음부터 실패한 법령을 확인 전에 또 세지 않는다), 가장 오래된 마지막 확인', () => {
    expect(overview.links).toMatchObject({ failedLaws: 2, uncheckedLaws: 1, oldestCheckedAt: '2026-10-15T00:00:00.000Z' });
  });

  it('③ 개정 검토 대기 — 작성·검토 수의 합이 개정 검토 기본 목록 total(=메뉴 배지)과 같다, 다른 회사 후보는 섞이지 않는다', async () => {
    expect(overview.candidates).toEqual({ draft: 3, review: 1 });
    const list = await ok(api('/amendments?state=open&page=1&limit=1', { token: A.token }), 'list');
    expect(list.total).toBe(overview.candidates.draft + overview.candidates.review);
  });

  it('④ 사내 시행 예정 — 제·개정 예고 목록(묶음 50 아래)의 조문 수·폐지 수 합과 같다', async () => {
    const groups = (await ok(api('/policies/scheduled-changes?limit=50', { token: A.token }), 'scheduled')) as any[];
    expect(groups.length).toBeLessThan(50);
    const sum = groups.reduce((s, g) => ({ amend: s.amend + g.articleCount, repeal: s.repeal + g.repealCount }), { amend: 0, repeal: 0 });
    expect(overview.scheduled).toEqual(sum);
    expect(overview.scheduled).toEqual({ amend: 1, repeal: 1 });
  });

  it('최근 법령 개정 — 법령·시행일 한 줄(시행일이 없으면 공포일로 가른다), 최근 순(공포일, 없으면 한국 날짜 감지일 — 시행 전후 모두), 우리 조문(확정만 ∪ 후보)·후보 현황', () => {
    const lines = overview.recentLawChanges.filter((l: any) => ids.laws.includes(l.lawId));
    expect(lines.map((l: any) => [l.lawName, l.effectiveDate, l.promulgatedDate])).toEqual([
      ['대시보드법', plusDays(60), '2026-10-01'],
      ['대시보드시험둘째법', null, null], // 감지 9/16(한국) — UTC 로 자르면 9/15
      ['대시보드시험둘째법', plusDays(30), '2026-09-01'],
      ['대시보드법', null, '2026-08-01'], // 시행일 없는 개정은 시행일 있는 줄과도, 공포일이 다른 시행일 없는 개정(e6)과도 합치지 않는다
      ['대시보드법', '2025-07-01', '2025-01-10'],
    ]);
    expect(lines[1].detectedDate).toBe('2026-09-16');
    expect(lines.map((l: any) => [l.articles, l.pending, l.approved, l.rejected])).toEqual([
      [1, 1, 0, 0], // 추천 연결(a3b ↔ la1)·다른 회사 연결(b1 ↔ la1)은 세지 않는다
      [1, 1, 0, 0],
      [1, 1, 0, 0], // 검토 중
      [1, 1, 0, 0], // e4 → a2 만(공포일이 다른 e6 → a1 이 섞이면 2)
      [1, 0, 0, 1], // 반려 — 여섯째 줄(e6)은 잘린다
    ]);
    expect(new Set(lines.map((l: any) => l.key)).size).toBe(lines.length);
    expect(lines[0].lawFullName).toBe('대시보드시험기본법');
  });

  it('다른 회사(B)에는 B 의 것만 — 확정 연결 하나, 작성 후보 둘(하나는 연결을 지운 변경), 시행 예정 없음, 최근 개정은 B 의 줄만', async () => {
    const b = await ok(api('/dashboard/overview', { token: B.token }), 'overview B');
    expect(b.links).toMatchObject({ confirmedLinks: 1, suggestedLinks: 0, linkedLaws: 1 });
    expect(b.candidates).toEqual({ draft: 2, review: 0 });
    expect(b.policies).toEqual({ active: 1, inactive: 0, articlesInForce: 1 });
    expect(b.scheduled).toEqual({ amend: 0, repeal: 0 }); // A 의 시행 예정(a6)·폐지 예정(a7)이 섞이지 않는다
    const lines = b.recentLawChanges.filter((l: any) => ids.laws.includes(l.lawId));
    expect(lines.map((l: any) => [l.lawName, l.effectiveDate, l.promulgatedDate, l.articles, l.pending, l.approved, l.rejected])).toEqual([
      ['대시보드법', plusDays(60), '2026-10-01', 1, 1, 0, 0], // b1 ↔ la1 이 닿는 e1 과 B 의 작성 후보 — A 의 후보는 세지 않는다
      ['대시보드시험셋째법', plusDays(90), '2026-05-01', 1, 1, 0, 0], // 연결을 지웠어도 B 의 후보가 있는 e7 — 우리 조문은 후보 조문(b1)
      ['대시보드법', null, '2024-01-01', 1, 0, 0, 0], // la1 의 e6 — A 의 줄(e2·e3·e4·e5)은 없다
    ]);
  });

  it('역할 — 편집자는 읽고, 열람자는 403(확정 전 내부 정보)', async () => {
    const make = async (role: 'editor' | 'viewer') => {
      const email = `dash-${role}-${Date.now().toString(36)}@example.test`;
      const password = 'DashboardTest!234';
      await ok(post(A.token, '/users', { email, password, name: role, role }), `create ${role}`);
      return (await login(email, password, A.slug)).body.accessToken as string;
    };
    expect((await api('/dashboard/overview', { token: await make('editor') })).status).toBe(200);
    const viewer = await api('/dashboard/overview', { token: await make('viewer') });
    expect(viewer.status).toBe(403);
    expect(viewer.body?.code).not.toBe('PASSWORD_CHANGE_REQUIRED');
  });
});

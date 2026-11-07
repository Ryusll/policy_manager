import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';
import { sql } from './race';

const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const PW = 'SummaryPass!2345';

/**
 * T-158 (SRS LAW-19, ADR-0021 결과) 대시보드 법령 개정 배너·메뉴 처리 대기 배지 — `GET /amendments/summary`.
 *
 * 막고 싶은 사고:
 * 1. 조 머리에 건 연결 하나가 두 항 개정을 받을 때 우리 조문을 두 번 센다(T-148 — 판 단위로 한 번씩)
 * 2. 배지 숫자가 개정 검토 화면 기본 목록과 다르다, 법령 시행일이 지난 미처리 후보가 시행 예정 줄에 섞인다
 * 3. 열람자나 다른 회사에 숫자가 보인다
 */
describe('T-158 대시보드 법령 개정 숫자', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let other: Awaited<ReturnType<typeof createTenant>>;
  let viewerToken = '';
  const [sourceId, lawId, jo, hang1, hang2, v1, e1, e2, e3, strayLink] = Array.from({ length: 10 }, () => randomUUID());
  const E = day(20);
  const summary = async (token = t.token) => api('/amendments/summary', { token });

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('summary');
    other = await createTenant('summary-o');
    const email = `viewer-${t.slug}@example.test`;
    const made = await api('/users', { method: 'POST', token: t.token, json: { email, password: PW, name: 'viewer', role: 'viewer' } });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    viewerToken = (await login(email, PW, t.slug)).body.accessToken as string;

    const { article } = await createPolicyWithArticle(t.token, `SM-${Date.now().toString(36)}`, '요약시험규정');
    sql(`
      DELETE FROM article_versions WHERE article_id='${article.id}';
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at)
        VALUES ('${randomUUID()}', '${article.id}', 1, '연차 유급휴가는 15일로 한다.', 'published', '2020-01-01', now());
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, short_title, effective_date, updated_at)
        VALUES ('${lawId}', '${sourceId}', '991580', '999580', '요약시험에 관한 법률', '요약시험법', '${E}', now());
      INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, label, content, version_key, sort_order, updated_at) VALUES
        ('${jo}', '${lawId}', '60//', 60, NULL, '제60조', '', 'v1:jo', 1, now()),
        ('${hang1}', '${lawId}', '60/1/', 60, 1, '제60조제1항', '① 연차 유급휴가는 16일로 한다.', 'v1:h1', 2, now()),
        ('${hang2}', '${lawId}', '60/2/', 60, 2, '제60조제2항', '② 연차 유급휴가는 17일까지 쓴다.', 'v1:h2', 3, now());
      INSERT INTO law_versions (id, law_id, mst, kind, law_type, promulgated_date, promulgation_no, revision_type, effective_date)
        VALUES ('${v1}', '${lawId}', 'r${v1.slice(0, 8)}', 'change', '법률', '2026-05-26', '22000', '일부개정', '${E}');
      INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, law_effective_date, law_version_id, received_via, amendments_processed_at) VALUES
        ('${e1}', '${lawId}', '${hang1}', '60/1/', 'modified', '① 연차 유급휴가는 15일로 한다.', '① 연차 유급휴가는 16일로 한다.', '${E}', '${v1}', 'poll', now()),
        ('${e2}', '${lawId}', '${hang2}', '60/2/', 'modified', '② 연차 유급휴가는 15일까지 쓴다.', '② 연차 유급휴가는 17일까지 쓴다.', '${E}', '${v1}', 'poll', now()),
        ('${e3}', '${lawId}', '${hang1}', '60/1/', 'modified', '① 연차 유급휴가는 15일로 한다.', '① 연차 유급휴가는 18일로 한다.', '${day(-1)}', NULL, 'poll', now());
    `);
    // 조 머리 행에 확정 연결 — 두 항 개정을 함께 받는다(T-148). 확정하는 순간 창 안 변경으로 후보가 생긴다(T-149)
    const link = await api('/law-links', { method: 'POST', token: t.token, json: { lawArticleId: jo, articleId: article.id, relationType: 'citation' } });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const made3 = sql(`SELECT count(*) FROM amendment_candidates WHERE change_event_id IN ('${e1}', '${e2}', '${e3}');`);
    expect(made3, '연결 확정이 변경 셋의 후보를 만들어야 한다').toBe('3');

    // 다른 회사도 같은 법령 제60조제2항에 자기 조문을 확정 연결한다 — 그 회사에는 자기 후보 1건만
    const theirs = await createPolicyWithArticle(other.token, `SMO-${Date.now().toString(36)}`, '남의규정');
    sql(`
      DELETE FROM article_versions WHERE article_id='${theirs.article.id}';
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at)
        VALUES ('${randomUUID()}', '${theirs.article.id}', 1, '연차 유급휴가는 15일까지 쓴다.', 'published', '2020-01-01', now());
    `);
    const theirLink = await api('/law-links', { method: 'POST', token: other.token, json: { lawArticleId: hang2, articleId: theirs.article.id, relationType: 'citation' } });
    expect(theirLink.status, JSON.stringify(theirLink.body)).toBe(201);
    // T-41 형 잘못된 행 — 연결의 회사는 우리인데 조문은 다른 회사 것. 우리 숫자에 들어오면 안 된다(ourLinks)
    sql(`INSERT INTO law_links (id, tenant_id, law_article_id, article_id, relation_type, confirm_state, updated_at)
           VALUES ('${strayLink}', '${t.user.tenantId}', '${hang1}', '${theirs.article.id}', 'citation', 'confirmed', now());`);
  }, 120_000);

  afterAll(() => {
    sql(`
      DELETE FROM amendment_candidates WHERE change_event_id IN ('${e1}', '${e2}', '${e3}');
      UPDATE article_versions SET change_event_id = NULL WHERE change_event_id IN ('${e1}', '${e2}', '${e3}');
      DELETE FROM law_links WHERE law_article_id IN ('${jo}', '${hang1}', '${hang2}');
      DELETE FROM laws WHERE id = '${lawId}'; DELETE FROM law_sources WHERE id = '${sourceId}';
    `);
  });

  it('판 한 줄 — 우리 조문은 두 항 개정을 합쳐 1개, 처리 대기 후보 2건, 약칭·판 표기. 법령 시행일이 지난 후보는 따로', async () => {
    const res = await summary();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      pending: 3,
      overdue: 1,
      undated: 0,
      upcoming: [
        {
          lawId,
          lawName: '요약시험법',
          lawFullName: '요약시험에 관한 법률',
          version: { lawType: '법률', promulgationNo: '22000', revisionType: '일부개정' },
          effectiveDate: E,
          articles: 1,
          pending: 2,
        },
      ],
      more: 0,
    });
  });

  it('법령 변경 화면의 영향 수와 같은 규칙 — 변경마다 우리 조문 1개, 판으로 합쳐도 1개(두 번 세지 않는다)', async () => {
    const list = await api(`/law-changes?lawId=${lawId}&affected=true`, { token: t.token });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const impacts = (list.body as Array<{ id: string; impact: { confirmed: number } }>).filter((e) => e.id === e1 || e.id === e2).map((e) => e.impact.confirmed);
    expect(impacts).toEqual([1, 1]);
    expect((await summary()).body.upcoming[0].articles).toBe(1);
  });

  it('메뉴 배지 숫자 = 개정 검토 화면 기본 목록의 건수', async () => {
    const list = await api('/amendments', { token: t.token });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.total).toBe((await summary()).body.pending);
  });

  it('열람자는 403, 로그인 없으면 401 — 다른 회사는 자기 연결·후보만(우리 회사 이름으로 남의 조문에 건 잘못된 행도 우리 숫자에 들지 않는다)', async () => {
    expect((await summary(viewerToken)).status).toBe(403);
    expect((await api('/amendments/summary', {})).status).toBe(401);
    const theirs = await summary(other.token);
    expect(theirs.status).toBe(200);
    expect(theirs.body).toMatchObject({ pending: 1, overdue: 0, undated: 0, upcoming: [{ lawId, effectiveDate: E, articles: 1, pending: 1 }], more: 0 });
    expect((await summary()).body).toMatchObject({ pending: 3, upcoming: [{ articles: 1, pending: 2 }] });
  });

  it('처리하면 줄어든다 — 시행일 지난 후보를 반려하면 처리 대기 2건, 지난 미처리 0건', async () => {
    const id = sql(`SELECT id FROM amendment_candidates WHERE change_event_id = '${e3}';`);
    const c = (await api(`/amendments/${id}`, { token: t.token })).body;
    const lock = (b: { revision: number; lockVersion: number }) => ({ expectedRevision: b.revision, expectedLockVersion: b.lockVersion });
    const review = await api(`/amendments/${id}/review`, { method: 'POST', token: t.token, json: lock(c) });
    expect(review.status, JSON.stringify(review.body)).toBe(200);
    const reject = await api(`/amendments/${id}/reject`, { method: 'POST', token: t.token, json: { reason: '시험 반려', ...lock(review.body) } });
    expect(reject.status, JSON.stringify(reject.body)).toBe(200);
    expect((await summary()).body).toMatchObject({ pending: 2, overdue: 0, upcoming: [{ articles: 1, pending: 2 }] });
  });

  it('연결을 지워도 처리 대기 후보의 조문은 우리 조문으로 센다 — "우리 조문 0개, 처리 대기 후보 2건"이 되지 않는다', async () => {
    sql(`DELETE FROM law_links WHERE tenant_id = '${t.user.tenantId}' AND law_article_id = '${jo}';`);
    expect((await summary()).body).toMatchObject({ pending: 2, upcoming: [{ articles: 1, pending: 2 }] });
  });
});

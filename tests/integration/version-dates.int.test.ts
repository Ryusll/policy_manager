import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';

/**
 * 날짜 3종 — 법령 시행일 / 발행일 / 사내 규정 시행일 (T-111, 특허 청구항 7, LAW-11).
 *
 * 법제처 없이 돈다 — 법령·조항·변경 이벤트를 DB 에 직접 심는다.
 *
 * 막고 싶은 사고:
 * 1. **옛 발행일 보정이 엉뚱한 행을 고친다** — 초안·검토 중, 이미 기록된 발행일, 승인 시각이 없는 행은 그대로여야 한다.
 * 2. **보정한 발행일을 그때 기록한 것처럼 보인다** — 보정 표시가 따로 남아야 한다.
 * 3. **법령 시행일이 사내 규정 시행일 자리를 차지한다** — 시점 조회는 사내 시행일로만 고른다(법령 시행일·발행일 무관).
 * 4. 법령 조항이 사라져도 어느 조항의 변경인지 표기가 남는다.
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

/** 한국 날짜 — 서버의 "오늘"(todayDateOnly)이 한국 날짜다(T-126) */
const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const PW = 'IntegrationTest!234';

const LAW_BEFORE = '사용자는 근로자에게 15일의 유급휴가를 주어야 한다.';
const LAW_AFTER = '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.';
const TEXT_15 = '직원에게는 매년 15일의 연차휴가를 준다.';
const TEXT_20 = '직원에게는 매년 20일의 연차휴가를 준다.';

/** 마이그레이션의 보정 문장 그대로 — 이 테스트의 조문으로만 좁혀 돌린다(다른 테스트의 행은 건드리지 않는다) */
function backfill(articleIds: string[]) {
  const file = join(__dirname, '../../apps/api/prisma/migrations/20261010010000_published_at_backfill/migration.sql');
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf('UPDATE "article_versions"');
  expect(start).toBeGreaterThan(-1);
  const stmt = text.slice(start).trim().replace(/;\s*$/, '');
  sql(`${stmt} AND "article_id" IN (${articleIds.map((id) => `'${id}'`).join(',')});`);
}

describe('T-111 날짜 3종', () => {
  const sourceId = randomUUID();
  const lawId = randomUUID();
  const lawArt = randomUUID();
  const ev = randomUUID();
  const LAW_DATE = day(30); // 법령 시행일
  const OURS = day(10); // 사내 규정 시행일 — 법령보다 이르다(조기 시행)

  let t1: Awaited<ReturnType<typeof createTenant>>;
  let viewerToken = '';
  let policyId = '';
  let chapterId = '';
  const art = {} as Record<'old' | 'none' | 'kept' | 'law', string>;
  const v = {} as Record<'o1' | 'o2' | 'o3' | 'o4' | 'none' | 'kept' | 'law1', string>;
  let candId = '';

  const versions = async (articleId: string, token = t1.token) => {
    const r = await api(`/articles/${articleId}/versions`, { token });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body as any[];
  };
  const byNum = (rows: any[], n: number) => rows.find((r) => r.versionNum === n);

  beforeAll(async () => {
    await waitForApi();
    t1 = await createTenant('vdates-1');
    const email = `viewer-${t1.slug}@example.test`;
    await api('/users', { method: 'POST', token: t1.token, json: { email, password: PW, name: '열람자', role: 'viewer' } });
    viewerToken = (await login(email, PW, t1.slug)).body.accessToken;

    sql(`
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, updated_at)
        VALUES ('${lawId}', '${sourceId}', '900111', '990111', '날짜시험법', '${LAW_DATE}', now());
      INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, label, content, version_key, sort_order, updated_at)
        VALUES ('${lawArt}', '${lawId}', '60/1/', 60, 1, '제60조제1항(유급휴가)', '${LAW_AFTER}', 'v1:p2', 1, now());
      INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, before_version_key, after_version_key, law_effective_date, received_via, amendments_processed_at)
        VALUES ('${ev}', '${lawId}', '${lawArt}', '60/1/', 'modified', '${LAW_BEFORE}', '${LAW_AFTER}', 'v1:p1', 'v1:p2', '${LAW_DATE}', 'poll', now());
    `);

    const { policy, chapter, article } = await createPolicyWithArticle(t1.token, `VDT-${Date.now().toString(36)}`, '날짜 규정');
    policyId = policy.id;
    chapterId = chapter.id;
    art.old = article.id;
    for (const [i, k] of (['none', 'kept', 'law'] as const).entries()) {
      art[k] = (await api(`/policies/${policyId}/chapters/${chapterId}/articles`, {
        method: 'POST', token: t1.token, json: { number: i + 2, title: `조문 ${k}`, content: '본문' },
      })).body.id;
    }
    for (const k of Object.keys({ o1: 1, o2: 1, o3: 1, o4: 1, none: 1, kept: 1, law1: 1 }) as Array<keyof typeof v>) v[k] = randomUUID();
    // T-108 이전 모습 — 발행일 없이 승인 시각만 있는 발행 이력, 승인 시각도 없는 발행 이력(관리자 JSON 일괄 등록),
    // 이미 발행일이 기록된 것, 그리고 보정하면 안 되는 초안·검토 중(승인 시각이 있어도)
    sql(`
      DELETE FROM article_versions WHERE article_id IN ('${art.old}', '${art.none}', '${art.kept}', '${art.law}');
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, approved_at, published_at, updated_at) VALUES
        ('${v.o1}', '${art.old}', 1, '옛 본문 1', 'archived', '2020-01-01', '2019-12-31 01:00:00', NULL, now()),
        ('${v.o2}', '${art.old}', 2, '옛 본문 2', 'published', '2021-01-01', '2020-12-20 01:30:00', NULL, now()),
        ('${v.o3}', '${art.old}', 3, '옛 초안', 'draft', NULL, '2021-02-01 00:00:00', NULL, now()),
        ('${v.o4}', '${art.old}', 4, '옛 검토', 'review', NULL, '2021-03-01 00:00:00', NULL, now()),
        ('${v.none}', '${art.none}', 1, '일괄 등록 본문', 'published', '2022-01-01', NULL, NULL, now()),
        ('${v.kept}', '${art.kept}', 1, '그때 기록한 본문', 'published', '2026-10-01', '2026-09-30 00:00:00', '2026-09-30 00:00:05', now()),
        ('${v.law1}', '${art.law}', 1, '${TEXT_15}', 'published', '2020-01-01', NULL, NULL, now());
    `);
    backfill([art.old, art.none, art.kept, art.law]);

    // 개정 후보 승인으로 v2 발행 — 사내 시행일이 법령 시행일보다 이르다(이유 필요)
    const link = await api('/law-links', { method: 'POST', token: t1.token, json: { lawArticleId: lawArt, articleId: art.law, relationType: 'delegation', evidenceText: '연차휴가 일수' } });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const g = await api('/amendments/generate', { method: 'POST', token: t1.token, json: { changeEventId: ev } });
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    candId = g.body.created.find((c: any) => c.articleId === art.law).id;
    const lock = async () => {
      const b = (await api(`/amendments/${candId}`, { token: t1.token })).body;
      return { expectedRevision: b.revision, expectedLockVersion: b.lockVersion };
    };
    const review = await api(`/amendments/${candId}/review`, { method: 'POST', token: t1.token, json: await lock() });
    expect(review.status, JSON.stringify(review.body)).toBe(200);
    const ok = await api(`/amendments/${candId}/approve`, {
      method: 'POST',
      token: t1.token,
      json: { ...(await lock()), effectiveDate: OURS, changeNote: '날짜시험법 개정 반영', earlyReason: '노사 합의로 먼저 시행' },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  }, 180_000);

  afterAll(() => {
    sql(`
      DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      UPDATE article_versions SET change_event_id = NULL WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      DELETE FROM laws WHERE id='${lawId}'; DELETE FROM law_sources WHERE id='${sourceId}';
    `);
  });

  describe('옛 발행일 보정 (마이그레이션 20261010010000)', () => {
    it('발행 이력이고 발행일이 비고 승인 시각이 있으면 승인 시각으로 채우고 보정 표시를 남긴다', async () => {
      const rows = await versions(art.old);
      expect(byNum(rows, 1)).toMatchObject({ status: 'archived', publishedAt: '2019-12-31T01:00:00.000Z', publishedAtFromApproval: true });
      expect(byNum(rows, 2)).toMatchObject({ status: 'published', publishedAt: '2020-12-20T01:30:00.000Z', publishedAtFromApproval: true });
    });

    it('초안·검토 중은 승인 시각이 있어도 건드리지 않는다 — 발행된 적이 없다', async () => {
      const rows = await versions(art.old);
      expect(byNum(rows, 3)).toMatchObject({ status: 'draft', publishedAt: null, publishedAtFromApproval: false });
      expect(byNum(rows, 4)).toMatchObject({ status: 'review', publishedAt: null, publishedAtFromApproval: false });
    });

    it('승인 시각도 없으면 비워 둔다 — 생성일·시행일로 대신 채우지 않는다', async () => {
      expect((await versions(art.none))[0]).toMatchObject({ publishedAt: null, publishedAtFromApproval: false, effectiveDate: '2022-01-01T00:00:00.000Z' });
    });

    it('이미 기록된 발행일은 그대로 — 승인 시각과 달라도 덮어쓰지 않고 보정 표시도 없다', async () => {
      expect((await versions(art.kept))[0]).toMatchObject({ publishedAt: '2026-09-30T00:00:05.000Z', publishedAtFromApproval: false });
    });

    it('다시 돌려도 같다 — 이미 채운 행은 다시 고르지 않는다', () => {
      const before = sql(`SELECT string_agg(id || ':' || coalesce(published_at::text, '-') || ':' || published_at_from_approval, ',' ORDER BY id) FROM article_versions WHERE article_id IN ('${art.old}', '${art.none}', '${art.kept}');`);
      backfill([art.old, art.none, art.kept]);
      const after = sql(`SELECT string_agg(id || ':' || coalesce(published_at::text, '-') || ':' || published_at_from_approval, ',' ORDER BY id) FROM article_versions WHERE article_id IN ('${art.old}', '${art.none}', '${art.kept}');`);
      expect(after).toBe(before);
    });
  });

  describe('버전 목록의 날짜 3종', () => {
    it('후보 승인 버전 — 사내 시행일·발행일(그때 기록)·법령 시행일과 법령명·조항', async () => {
      const rows = await versions(art.law);
      const v2 = byNum(rows, 2);
      expect(v2).toMatchObject({
        status: 'published',
        effectiveDate: `${OURS}T00:00:00.000Z`,
        publishedAtFromApproval: false,
        sourceCandidateId: candId,
        lawChange: { eventId: ev, lawId, lawName: '날짜시험법', label: '제60조제1항(유급휴가)', lawEffectiveDate: LAW_DATE },
      });
      expect(v2.publishedAt).toBeTruthy();
      expect(Date.now() - new Date(v2.publishedAt).getTime()).toBeLessThan(10 * 60_000);
      // 날짜 3종은 서로 다른 값이다 — 법령 시행일이 사내 시행일 자리에 들어가지 않는다
      expect(v2.effectiveDate.slice(0, 10)).not.toBe(v2.lawChange.lawEffectiveDate);
      expect('changeEvent' in v2).toBe(false);
    });

    it('후보 승인이 아닌 버전은 법령 시행일이 없다 — 그 법령의 시행일로 대신하지 않는다', async () => {
      expect(byNum(await versions(art.law), 1).lawChange).toBeNull();
      expect((await versions(art.kept))[0].lawChange).toBeNull();
    });

    it('법령 조항이 사라져도 어느 조항인지 남는다 — 조항 표기를 이벤트의 위치로 되살린다', async () => {
      sql(`UPDATE law_change_events SET law_article_id = NULL WHERE id='${ev}';`);
      try {
        expect(byNum(await versions(art.law), 2).lawChange).toMatchObject({ label: '제60조제1항', lawEffectiveDate: LAW_DATE });
      } finally {
        sql(`UPDATE law_change_events SET law_article_id = '${lawArt}' WHERE id='${ev}';`);
      }
    });

    it('법령 시행일이 없는 이벤트는 null — 화면은 기록 없음', async () => {
      sql(`UPDATE law_change_events SET law_effective_date = NULL WHERE id='${ev}';`);
      try {
        expect(byNum(await versions(art.law), 2).lawChange).toMatchObject({ eventId: ev, lawEffectiveDate: null });
      } finally {
        sql(`UPDATE law_change_events SET law_effective_date = '${LAW_DATE}' WHERE id='${ev}';`);
      }
    });

    it('열람자도 같은 날짜를 본다', async () => {
      expect(byNum(await versions(art.law, viewerToken), 2).lawChange).toMatchObject({ lawEffectiveDate: LAW_DATE });
    });

    it('규정 조회(연혁 탭)의 시행본에도 같은 값', async () => {
      const r = await api(`/policies/${policyId}`, { token: t1.token });
      expect(r.status).toBe(200);
      const articles = r.body.chapters.flatMap((c: any) => c.articles);
      // 사내 시행일(OURS = 오늘+10)이 아직 오지 않아 v2 는 "시행 예정"이고 오늘 본문은 v1 이다(T-127).
      // 날짜 3종(법령 시행일·발행일)은 시행 예정 자리에 같은 모양으로 실린다
      const lawArticle = articles.find((a: any) => a.id === art.law);
      expect(lawArticle.versions[0]).toMatchObject({ versionNum: 1, lawChange: null });
      expect(lawArticle.currentState).toBe('in_force');
      const lawV = lawArticle.scheduledVersions[0];
      expect(lawV).toMatchObject({ versionNum: 2, lawChange: { eventId: ev, lawEffectiveDate: LAW_DATE, label: '제60조제1항(유급휴가)' } });
      expect(String(lawV.effectiveDate)).toMatch(new RegExp(`^${OURS}`));
      expect(lawV).toHaveProperty('publishedAt');
      expect(lawV).toHaveProperty('publishedAtFromApproval');
      expect('changeEvent' in lawV).toBe(false);
      expect(articles.find((a: any) => a.id === art.old).versions[0]).toMatchObject({ versionNum: 2, publishedAtFromApproval: true, lawChange: null });
      // 초안 요약(includePending)이 붙는 경로도 같은 모양
      const withPending = await api(`/policies/${policyId}?includePending=true`, { token: t1.token });
      const oldArt = withPending.body.chapters.flatMap((c: any) => c.articles).find((a: any) => a.id === art.old);
      expect(oldArt.versions[0]).toMatchObject({ versionNum: 2, lawChange: null });
    });
  });

  describe('유효성은 사내 규정 시행일 기준', () => {
    const contentAt = async (date: string) =>
      (await api(`/policies/${policyId}/as-of?date=${date}`, { token: t1.token })).body.chapters
        .flatMap((c: any) => c.articles)
        .find((a: any) => a.id === art.law)?.versions?.[0]?.content;

    it('오늘 발행했어도 사내 시행일 전에는 옛 본문, 사내 시행일부터는 법령 시행일 전이라도 새 본문', async () => {
      expect(await contentAt(day(0))).toBe(TEXT_15);
      expect(await contentAt(day(9))).toBe(TEXT_15);
      expect(await contentAt(OURS)).toBe(TEXT_20);
      expect(await contentAt(day(29))).toBe(TEXT_20);
    });

    it('옛 발행일 보정은 시점 조회를 바꾸지 않는다 — 발행일이 시행일보다 앞서도 시행일부터', async () => {
      const at = async (date: string) =>
        (await api(`/policies/${policyId}/as-of?date=${date}`, { token: t1.token })).body.chapters
          .flatMap((c: any) => c.articles)
          .find((a: any) => a.id === art.old)?.versions?.[0]?.content;
      // v2 는 2020-12-20 에 발행(보정), 2021-01-01 시행
      expect(await at('2020-12-31')).toBe('옛 본문 1');
      expect(await at('2021-01-01')).toBe('옛 본문 2');
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';

/**
 * 폐지한 조문이 시점 조회에서 되살아나지 않는다 (T-126).
 *
 * "게시본 폐지"는 버전을 archived 로 내리는데, 새 버전에 밀려 내려간(대체) 버전도 archived 다. 시점 조회는
 * 대체된 옛 본문을 과거 날짜에 보여 주려고 archived 도 고르므로, 폐지 시행일이 없으면 폐지한 조문이 폐지 뒤
 * 날짜에도 시행 중으로 나온다 — 규정 시점 조회·신구 대비·법령 영향 분석·개정 후보가 모두 같은 규칙을 쓴다.
 *
 * 막고 싶은 사고:
 * 1. 폐지한 조문이 폐지 뒤 날짜에 (그 버전이든 대체된 옛 버전이든) 다시 나온다
 * 2. 폐지가 그날 이후를 다 덮지 못한다 — 시행일 없는 시행본, 아직 시행 전인 버전, 오늘 뒤에 시행될 다른 버전
 * 3. 다시 시행하면서 폐지 전 날짜까지 새 본문으로 바꾼다(폐지일보다 이른 시행일)
 * 4. 폐지된 조문으로 개정 후보를 만들거나 승인한다
 * 5. 폐지와 승인이 겹쳐 새 버전에 밀려 내려간 버전에 폐지일이 찍힌다
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

/** 한국 날짜 — 서버의 "오늘"(todayDateOnly)과 같은 날 */
const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const PW = 'IntegrationTest!234';
const LAW_BEFORE = '사용자는 근로자에게 15일의 유급휴가를 주어야 한다.';
const LAW_AFTER = '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.';
const TEXT_15 = '직원에게는 매년 15일의 연차휴가를 준다.';

type Key = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'h' | 'i' | 'j';

describe('T-126 폐지한 조문과 시점 조회', () => {
  const sourceId = randomUUID();
  const lawId = randomUUID();
  const lawArt = randomUUID();
  const ev = randomUUID();
  const E = day(30); // 법령 시행일 — 영향 분석 기준일
  const today = day(0);

  let t1: Awaited<ReturnType<typeof createTenant>>;
  let editorToken = '';
  let policyId = '';
  let policy2Id = '';
  const art = {} as Record<Key | 'g' | 'g2', string>;
  const ver: Record<string, string> = {};
  const cand = {} as Record<'h' | 'i', string>;

  const post = (path: string, json?: Record<string, unknown>, token = t1.token) =>
    api(path, { method: 'POST', token, json: json ?? {} });
  const asOf = async (pid: string, date: string) => {
    const r = await api(`/policies/${pid}/as-of?date=${date}`, { token: t1.token });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };
  const contentAt = async (pid: string, date: string, articleId: string) => {
    const body = await asOf(pid, date);
    const a = body.chapters.flatMap((c: any) => c.articles).find((x: any) => x.id === articleId);
    return (a?.versions?.[0]?.content as string | undefined) ?? null;
  };
  const row = (id: string) => sql(`SELECT status || ':' || coalesce(repealed_on::text, '-') FROM article_versions WHERE id='${id}';`);
  const lockOf = async (id: string) => {
    const b = (await api(`/amendments/${id}`, { token: t1.token })).body;
    return { expectedRevision: b.revision, expectedLockVersion: b.lockVersion };
  };
  /** 초안을 올려 검토 요청까지 — 승인은 각 테스트가 시행일을 정해 부른다 */
  const reviewDraft = async (articleId: string, content: string) => {
    const created = await post(`/articles/${articleId}/versions`, { content, changeNote: '다시 시행' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await post(`/versions/${created.body.id}/submit`)).status).toBeLessThan(300);
    return created.body.id as string;
  };
  const approveVersion = (id: string, effectiveDate: string) =>
    post(`/versions/${id}/approve`, { changeNote: '다시 시행', effectiveDate });

  beforeAll(async () => {
    await waitForApi();
    t1 = await createTenant('repeal');
    const email = `editor-${t1.slug}@example.test`;
    await api('/users', { method: 'POST', token: t1.token, json: { email, password: PW, name: '편집자', role: 'editor' } });
    editorToken = (await login(email, PW, t1.slug)).body.accessToken;

    sql(`
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, updated_at)
        VALUES ('${lawId}', '${sourceId}', '900126', '990126', '폐지시험법', '${E}', now());
      INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, label, content, version_key, sort_order, updated_at)
        VALUES ('${lawArt}', '${lawId}', '60/1/', 60, 1, '제60조제1항', '${LAW_AFTER}', 'v1:p2', 1, now());
      INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, before_version_key, after_version_key, law_effective_date, received_via, amendments_processed_at)
        VALUES ('${ev}', '${lawId}', '${lawArt}', '60/1/', 'modified', '${LAW_BEFORE}', '${LAW_AFTER}', 'v1:p1', 'v1:p2', '${E}', 'poll', now());
    `);

    const p1 = await createPolicyWithArticle(t1.token, `RPL-${Date.now().toString(36)}`, '취업규칙');
    policyId = p1.policy.id;
    art.a = p1.article.id;
    const keys: Key[] = ['b', 'c', 'd', 'e', 'f', 'h', 'i', 'j'];
    for (const [n, k] of keys.entries()) {
      art[k] = (await post(`/policies/${policyId}/chapters/${p1.chapter.id}/articles`, { number: n + 2, title: `조문 ${k}`, content: '본문' })).body.id;
    }
    const p2 = await createPolicyWithArticle(t1.token, `RPL2-${Date.now().toString(36)}`, '복무규정');
    policy2Id = p2.policy.id;
    art.g = p2.article.id;
    // 처음부터 초안뿐인 새 조문 — 한꺼번에 시행이 거부되면 이것도 시행되지 않아야 한다
    art.g2 = (await post(`/policies/${policy2Id}/chapters/${p2.chapter.id}/articles`, { number: 2, title: '새 조문', content: '새 조문 본문' })).body.id;

    // [조문, 번호, 본문, 상태, 시행일]
    const rows: Array<[Key | 'g', number, string, string, string | null]> = [
      ['a', 1, 'A 옛 본문', 'archived', '2020-01-01'],
      ['a', 2, 'A 본문', 'published', '2024-01-01'],
      ['b', 1, 'B 본문', 'published', null],
      ['c', 1, 'C 본문', 'archived', '2020-01-01'],
      ['c', 2, 'C 예정 본문', 'published', day(30)],
      ['d', 1, 'D 늦은 본문', 'archived', day(60)],
      ['d', 2, 'D 본문', 'published', '2024-01-01'],
      ['e', 1, 'E 나중 시행 본문', 'archived', '2025-01-01'],
      ['e', 2, 'E 앞선 시행 본문', 'published', '2024-01-01'],
      ['f', 1, 'F 본문', 'published', '2024-01-01'],
      ['h', 1, TEXT_15, 'published', '2020-01-01'],
      ['i', 1, 'I 옛 본문', 'archived', '2019-01-01'],
      ['i', 2, TEXT_15, 'published', '2020-01-01'],
      ['j', 1, 'J 본문', 'published', '2024-01-01'],
      ['j', 2, 'J 새 본문', 'review', null],
      ['g', 1, 'G 본문', 'published', '2024-01-01'],
    ];
    for (const [k, n] of rows) ver[`${k}${n}`] = randomUUID();
    sql(`
      DELETE FROM article_versions WHERE article_id IN (${[...keys, 'a', 'g'].map((k) => `'${art[k as Key]}'`).join(',')});
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at) VALUES
        ${rows.map(([k, n, content, status, eff]) => `('${ver[`${k}${n}`]}', '${art[k]}', ${n}, '${content}', '${status}', ${eff ? `'${eff}'` : 'NULL'}, now())`).join(',\n        ')};
    `);

    for (const k of ['h', 'i'] as const) {
      const r = await post('/law-links', { lawArticleId: lawArt, articleId: art[k], relationType: 'delegation', evidenceText: '연차휴가 일수' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const g = await post('/amendments/generate', { changeEventId: ev });
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    for (const k of ['h', 'i'] as const) cand[k] = g.body.created.find((c: any) => c.articleId === art[k]).id;
    const review = await api(`/amendments/${cand.h}/review`, { method: 'POST', token: editorToken, json: await lockOf(cand.h) });
    expect(review.status, JSON.stringify(review.body)).toBe(200);
  });

  afterAll(() => {
    // 심어 둔 법령을 남기면 법령 동기화가 그것부터 확인하려 든다(확인한 적 없는 법령이 먼저) — 후보가 이벤트를
    // Restrict 로 잡고 있어 먼저 지운다
    sql(`
      DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      DELETE FROM laws WHERE id='${lawId}'; DELETE FROM law_sources WHERE id='${sourceId}';
    `);
  });

  describe('폐지 시행일', () => {
    it('관리자만 폐지한다', async () => {
      expect((await post(`/versions/${ver.a2}/archive`, {}, editorToken)).status).toBe(403);
      expect(row(ver.a2)).toBe('published:-');
    });

    it('폐지하면 오늘(한국 날짜)이 폐지 시행일로 남고 감사에도 남는다', async () => {
      const r = await post(`/versions/${ver.a2}/archive`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ status: 'archived', remainingPublished: 0 });
      expect(String(r.body.repealedOn).slice(0, 10)).toBe(today);
      expect(row(ver.a2)).toBe(`archived:${today}`);
      // 새 버전에 밀려 내려간 옛 버전에는 폐지일을 찍지 않는다
      expect(row(ver.a1)).toBe('archived:-');
      expect(
        sql(`SELECT details->>'repealedOn' || '|' || (details->>'remainingPublished') FROM audit_logs WHERE entity_id='${ver.a2}' AND action='version.archive';`),
      ).toBe(`${today}|0`);
      const versions = (await api(`/articles/${art.a}/versions`, { token: t1.token })).body;
      expect(String(versions.find((v: any) => v.id === ver.a2).repealedOn).slice(0, 10)).toBe(today);
    });
  });

  describe('시점 조회', () => {
    it('폐지일부터는 조문이 빠지고 폐지일과 함께 알린다 — 대체된 옛 본문으로 되살아나지 않는다', async () => {
      const body = await asOf(policyId, today);
      expect(body.chapters.flatMap((c: any) => c.articles).some((a: any) => a.id === art.a)).toBe(false);
      expect(body.asOf.repealedArticles).toEqual([
        expect.objectContaining({ id: art.a, number: 1, repealedOn: today }),
      ]);
      expect(await contentAt(policyId, day(400), art.a)).toBeNull();
      expect((await asOf(policyId, day(400))).asOf.repealedArticles.map((a: any) => a.id)).toContain(art.a);
    });

    it('폐지 전 날짜에는 그때 본문이 그대로 나온다', async () => {
      expect(await contentAt(policyId, day(-1), art.a)).toBe('A 본문');
      expect(await contentAt(policyId, '2022-06-01', art.a)).toBe('A 옛 본문');
      expect((await asOf(policyId, day(-1))).asOf.repealedArticles).toEqual([]);
    });

    it('신구조문대비표에서 폐지한 조문은 삭제로 나온다', async () => {
      const r = await api(`/policies/${policyId}/compare?from=${day(-1)}&to=${today}`, { token: t1.token });
      expect(r.status).toBe(200);
      expect(r.body.rows.find((x: any) => x.articleId === art.a)).toMatchObject({ kind: 'removed', after: null });
    });

    it('개정 시점 목록에 폐지일이 들어간다', async () => {
      const r = await api(`/policies/${policyId}/effective-dates`, { token: t1.token });
      expect(r.body).toContain(today);
      expect(r.body).toEqual([...r.body].sort().reverse());
    });
  });

  describe('폐지가 그날 이후를 다 덮지 못하면 거부한다', () => {
    it.each([
      ['시행일이 없는 시행본', 'b1', /시행일이 기록되지 않은/],
      ['아직 시행 전인 버전', 'c2', /아직 시행 전인 버전/],
      ['오늘 뒤에 시행될 다른 버전이 있는 조문', 'd2', /오늘 뒤에 시행되는 버전\(v1/],
      ['오늘 시행 중인 본문이 아닌 버전(시행일이 뒤바뀐 이력)', 'e2', /오늘 시행 중인 본문은 이 버전이 아니라 v1/],
    ])('%s', async (_label, key, message) => {
      const r = await post(`/versions/${ver[key]}/archive`);
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.message).toMatch(message);
      expect(row(ver[key])).toBe('published:-');
    });
  });

  describe('다시 시행', () => {
    it('폐지일보다 이른 시행일로는 다시 시행하지 않는다', async () => {
      ver.a3 = await reviewDraft(art.a, 'A 다시 쓴 본문');
      const r = await approveVersion(ver.a3, day(-1));
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.message).toContain(`${today}에 폐지됐습니다`);
      expect(row(ver.a3)).toBe('review:-');
    });

    it('폐지한 날 다시 시행하면 그날부터 새 본문이 나온다', async () => {
      const r = await approveVersion(ver.a3, today);
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
      expect(await contentAt(policyId, today, art.a)).toBe('A 다시 쓴 본문');
      expect(await contentAt(policyId, day(-1), art.a)).toBe('A 본문');
      expect((await asOf(policyId, today)).asOf.repealedArticles).toEqual([]);
    });

    it('나중에 다시 시행하면 그 사이는 폐지, 시행일부터 새 본문', async () => {
      expect((await post(`/versions/${ver.f1}/archive`)).status).toBe(200);
      const f2 = await reviewDraft(art.f, 'F 다시 쓴 본문');
      expect((await approveVersion(f2, day(10))).status).toBeLessThan(300);
      expect(await contentAt(policyId, day(5), art.f)).toBeNull();
      expect((await asOf(policyId, day(5))).asOf.repealedArticles.map((a: any) => a.id)).toEqual([art.f]);
      expect(await contentAt(policyId, day(10), art.f)).toBe('F 다시 쓴 본문');
    });

    it('한꺼번에 시행도 폐지일보다 이른 시행일이면 거부하고 아무것도 시행하지 않는다', async () => {
      expect((await post(`/versions/${ver.g1}/archive`)).status).toBe(200);
      const g2 = await post(`/articles/${art.g}/versions`, { content: 'G 다시 쓴 본문', changeNote: '다시 시행' });
      expect(g2.status).toBe(201);
      const early = await post(`/policies/${policy2Id}/publish-drafts`, { changeNote: '다시 시행', effectiveDate: day(-3) });
      expect(early.status, JSON.stringify(early.body)).toBe(400);
      expect(early.body.message).toContain(`제1조(${today} 폐지)`);
      expect(sql(`SELECT count(*) FROM article_versions WHERE article_id IN ('${art.g}', '${art.g2}') AND status = 'published';`)).toBe('0');

      const ok = await post(`/policies/${policy2Id}/publish-drafts`, { changeNote: '다시 시행', effectiveDate: today });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.published).toBe(2);
      expect(await contentAt(policy2Id, today, art.g)).toBe('G 다시 쓴 본문');
    });
  });

  describe('법령 영향 분석·개정 후보', () => {
    it('폐지한 조문은 영향 목록에 남되 폐지일과 함께 "폐지됨"으로, 기준 본문 없이 나온다', async () => {
      expect((await post(`/versions/${ver.h1}/archive`)).status).toBe(200);
      const { body } = await api(`/law-changes/${ev}/impact`, { token: t1.token });
      const h = body.impacted.find((x: any) => x.article.id === art.h);
      expect(h).toMatchObject({ baseVersion: null, skipReason: 'repealed', repealedOn: today });
      const i = body.impacted.find((x: any) => x.article.id === art.i);
      expect(i).toMatchObject({ skipReason: null, repealedOn: null, baseVersion: { id: ver.i2 } });
    });

    it('폐지 전에 만든 후보는 "폐지됨"으로 낡고, 승인은 그 까닭으로 막힌다', async () => {
      const detail = (await api(`/amendments/${cand.h}`, { token: t1.token })).body;
      expect(detail).toMatchObject({ isCurrentBase: false, staleReason: 'repealed', currentBase: null });
      const list = (await api(`/amendments?state=all&changeEventId=${ev}`, { token: t1.token })).body;
      expect(list.rows.find((x: any) => x.id === cand.h)).toMatchObject({ staleReason: 'repealed' });

      const r = await post(`/amendments/${cand.h}/approve`, { effectiveDate: E, changeNote: '법령 개정 반영', ...(await lockOf(cand.h)) });
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(r.body.reason).toBe('repealed');
      expect(r.body.message).toContain(`${today}에 폐지돼`);
      expect(sql(`SELECT count(*) FROM article_versions WHERE article_id='${art.h}' AND status='published';`)).toBe('0');
    });

    it('폐지한 조문으로는 다시 만들어도 후보가 생기지 않는다', async () => {
      const re = await post(`/amendments/${cand.h}/regenerate`);
      expect(re.status, JSON.stringify(re.body)).toBe(200);
      expect(re.body).toMatchObject({ candidateId: null, skipped: 'repealed' });
      const g = await post('/amendments/generate', { changeEventId: ev });
      expect(g.body.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ articleId: art.h, reason: 'repealed' })]));
    });

    it('후보를 만든 뒤 옛 버전에 폐지일이 채워지면(기존 폐지 보정) 이력이 바뀐 것으로 본다', async () => {
      expect((await api(`/amendments/${cand.i}`, { token: t1.token })).body.staleReason).toBeNull();
      sql(`UPDATE article_versions SET repealed_on = '2019-06-01' WHERE id = '${ver.i1}';`);
      const detail = (await api(`/amendments/${cand.i}`, { token: t1.token })).body;
      expect(detail).toMatchObject({ isCurrentBase: false, staleReason: 'history_changed' });
    });
  });

  describe('동시 처리', () => {
    it('승인이 옛 시행본을 내리는 사이 그 버전을 폐지하면 폐지가 409 — 밀려 내려간 버전에 폐지일이 찍히지 않는다', async () => {
      const fn = `it_slow_repeal_${art.j.slice(0, 8)}`;
      // 승인이 조문을 잠근 채 오래 머물도록 새 버전 발행을 1.5초 늦추는 테스트용 트리거 — 잠금·재확인이 없으면
      // 폐지가 승인 전 상태(v1 시행 중)를 읽고 승인이 끝난 뒤 v1 에 폐지일을 찍는다
      sql(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
             BEGIN IF NEW.id = '${ver.j2}' AND NEW.status = 'published' THEN PERFORM pg_sleep(1.5); END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
           CREATE TRIGGER ${fn} BEFORE UPDATE ON article_versions FOR EACH ROW EXECUTE FUNCTION ${fn}();`);
      let approved: Awaited<ReturnType<typeof api>>;
      let archived: Awaited<ReturnType<typeof api>>;
      try {
        const approving = approveVersion(ver.j2, today);
        await new Promise((resolve) => setTimeout(resolve, 400));
        [approved, archived] = await Promise.all([approving, post(`/versions/${ver.j1}/archive`)]);
      } finally {
        sql(`DROP TRIGGER IF EXISTS ${fn} ON article_versions; DROP FUNCTION IF EXISTS ${fn}();`);
      }
      expect(approved.status, JSON.stringify(approved.body)).toBeLessThan(300);
      expect(archived.status, JSON.stringify(archived.body)).toBe(409);
      expect(row(ver.j1)).toBe('archived:-');
      expect(row(ver.j2)).toBe('published:-');
      expect(await contentAt(policyId, today, art.j)).toBe('J 새 본문');
    });
  });
});

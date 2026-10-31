import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * 상위 조항에 건 연결도 영향으로 잡기 (T-148).
 *
 * 인용 자동 찾기는 '제60조'를 조 머리 행(60//)에 잇는다. 항이 여럿인 조의 머리 행은 본문이 비어 있어
 * 항 개정 이벤트가 항(60/1/)에만 생긴다 — 같은 행만 보면 가장 흔한 연결이 실제 개정을 받지 못한다.
 * 법제처 없이 돈다 — 법령·조항·변경 이벤트를 DB 에 직접 심는다(T-105·T-106 과 같은 방식).
 *
 * 막고 싶은 사고:
 * 1. 조 단위 연결이 항 개정을 놓친다 — 영향 조회·변경 목록(거르기·개수)·자동 생성 모두
 * 2. 넓히면서 다른 회사의 연결이 섞인다 — 연결의 회사와 조문의 실제 소속을 둘 다 본다(T-41)
 * 3. 같은 조문이 조·항에 둘 다 걸려 두 번 잡히거나, 아래로(항 연결 → 조 머리 행 변경) 퍼진다
 * 4. 다시 처리할 때 이미 후보가 있는 조문에 새 후보·알림이 또 생긴다
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

/** 한국 날짜 — 서버의 "오늘"(todayDateOnly)이 한국 날짜다(T-126) */
const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

const BEFORE_601 = '① 사용자는 1년간 80퍼센트 이상 출근한 근로자에게 15일의 유급휴가를 주어야 한다.';
const AFTER_601 = '① 사용자는 1년간 80퍼센트 이상 출근한 근로자에게 16일의 유급휴가를 주어야 한다.';

describe('T-148 상위 조항에 건 연결도 영향으로 잡기', () => {
  const sourceId = randomUUID();
  const lawId = randomUUID();
  const la = {
    jo60: randomUUID(),
    p601: randomUUID(),
    p602: randomUUID(),
    jo70: randomUUID(),
    p701: randomUUID(),
    h7012: randomUUID(),
    jo80: randomUUID(),
    p801: randomUUID(),
    jo90: randomUUID(),
    p901: randomUUID(),
  };
  const ev = { p601: randomUUID(), h7012: randomUUID(), jo80: randomUUID(), p901: randomUUID() };
  const lawEffective = day(30);

  let t1: Awaited<ReturnType<typeof createTenant>>;
  let t2: Awaited<ReturnType<typeof createTenant>>;
  let platformToken = '';
  const art: Record<'x' | 'd' | 'h' | 'n' | 's' | 'w', string> = { x: '', d: '', h: '', n: '', s: '', w: '' };
  const ver = { x1: randomUUID(), x2: randomUUID(), d: randomUUID(), h: randomUUID(), n: randomUUID(), s: randomUUID(), w: randomUUID() };

  const link = async (token: string, lawArticleId: string, articleId: string, evidenceText: string) => {
    const res = await api('/law-links', {
      method: 'POST',
      token,
      json: { lawArticleId, articleId, relationType: 'citation', evidenceText },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  };
  const lawNotes = async (token: string) =>
    (await api('/notifications', { token })).body.filter((n: { kind: string }) => n.kind === 'law_amendment');

  beforeAll(async () => {
    await waitForApi();
    t1 = await createTenant('parent-1');
    t2 = await createTenant('parent-2');
    const platform = await createTenant('parent-pf');
    sql(`UPDATE users SET platform_role='global_admin' WHERE id='${platform.user.id}';`);
    platformToken = platform.token;

    // 공용 법령 데이터. 항이 여럿인 조(제60조·제70조)는 머리 행 본문이 비어 있다 — 법제처 응답 그대로의 모양.
    // 확인 시각을 가장 오래된 값으로 둬 동기화(limit 1)가 이 법령을 고르게 한다 — 가짜 법령이라 동기화 자체는
    // 실패하지만, 끝에 붙은 개정 후보 자동 생성은 그대로 돈다
    sql(`
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, last_checked_at, updated_at)
        VALUES ('${lawId}', '${sourceId}', '900148', '990148', '상위조항시험법', '${lawEffective}', '1970-01-01', now());
      INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, item_no, label, content, version_key, sort_order, updated_at) VALUES
        ('${la.jo60}', '${lawId}', '60//', 60, NULL, NULL, '제60조', '', 'v1:jo60', 1, now()),
        ('${la.p601}', '${lawId}', '60/1/', 60, 1, NULL, '제60조제1항', '${AFTER_601}', 'v1:p601b', 2, now()),
        ('${la.p602}', '${lawId}', '60/2/', 60, 2, NULL, '제60조제2항', '② 계속 근로 1년 미만이면 1개월 개근 시 1일의 유급휴가를 준다.', 'v1:p602', 3, now()),
        ('${la.jo70}', '${lawId}', '70//', 70, NULL, NULL, '제70조', '', 'v1:jo70', 4, now()),
        ('${la.p701}', '${lawId}', '70/1/', 70, 1, NULL, '제70조제1항', '① 사용자는 다음 각 호의 휴가를 주어야 한다.', 'v1:p701', 5, now()),
        ('${la.h7012}', '${lawId}', '70/1/2', 70, 1, 2, '제70조제1항제2호', '2. 출산전후휴가 120일', 'v1:h7012b', 6, now()),
        ('${la.jo80}', '${lawId}', '80//', 80, NULL, NULL, '제80조', '휴일은 주 1회 이상으로 한다.', 'v1:jo80b', 7, now()),
        ('${la.p801}', '${lawId}', '80/1/', 80, 1, NULL, '제80조제1항', '① 사용자는 휴일을 주어야 한다.', 'v1:p801', 8, now()),
        ('${la.jo90}', '${lawId}', '90//', 90, NULL, NULL, '제90조', '', 'v1:jo90', 9, now()),
        ('${la.p901}', '${lawId}', '90/1/', 90, 1, NULL, '제90조제1항', '① 연차 유급휴가는 16일로 한다.', 'v1:p901b', 10, now());
      INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, before_version_key, after_version_key, promulgated_date, law_effective_date, received_via, amendments_processed_at) VALUES
        ('${ev.p601}', '${lawId}', '${la.p601}', '60/1/', 'modified', '${BEFORE_601}', '${AFTER_601}', 'v1:p601a', 'v1:p601b', '${day(-3)}', '${lawEffective}', 'poll', NULL),
        ('${ev.h7012}', '${lawId}', '${la.h7012}', '70/1/2', 'modified', '2. 출산전후휴가 90일', '2. 출산전후휴가 120일', 'v1:h7012a', 'v1:h7012b', '${day(-3)}', '${lawEffective}', 'poll', NULL),
        ('${ev.jo80}', '${lawId}', '${la.jo80}', '80//', 'modified', '휴일은 주 1회로 한다.', '휴일은 주 1회 이상으로 한다.', 'v1:jo80a', 'v1:jo80b', '${day(-3)}', '${lawEffective}', 'poll', NULL),
        ('${ev.p901}', '${lawId}', '${la.p901}', '90/1/', 'modified', '① 연차 유급휴가는 15일로 한다.', '① 연차 유급휴가는 16일로 한다.', 'v1:p901a', 'v1:p901b', '${day(-3)}', '${lawEffective}', 'poll', NULL);
    `);

    // 회사 1: 조문 다섯
    const { policy, chapter, article } = await createPolicyWithArticle(t1.token, `PAR-${Date.now().toString(36)}`, '취업규칙');
    art.x = article.id;
    const addArticle = async (number: number, title: string) =>
      (await api(`/policies/${policy.id}/chapters/${chapter.id}/articles`, {
        method: 'POST', token: t1.token, json: { number, title, content: `${title} 본문` },
      })).body.id as string;
    art.d = await addArticle(2, '조·항 둘 다 연결');
    art.h = await addArticle(3, '항 연결, 호 변경');
    art.n = await addArticle(4, '항 연결, 조 머리 행 변경');
    art.s = await addArticle(5, '조 단위 추천 연결');
    // 회사 2: 같은 조(제60조)에 자기 조문 하나
    const other = await createPolicyWithArticle(t2.token, `PAR2-${Date.now().toString(36)}`, '다른 회사 규정');
    art.w = other.article.id;

    sql(`
      DELETE FROM article_versions WHERE article_id IN ('${art.x}', '${art.d}', '${art.h}', '${art.n}', '${art.s}', '${art.w}');
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at) VALUES
        ('${ver.x1}', '${art.x}', 1, '연차 유급휴가는 15일로 한다.', 'published', '2020-01-01', now()),
        ('${ver.d}', '${art.d}', 1, '연차 유급휴가 15일을 준다.', 'published', '2020-01-01', now()),
        ('${ver.h}', '${art.h}', 1, '출산전후휴가는 90일로 한다.', 'published', '2020-01-01', now()),
        ('${ver.n}', '${art.n}', 1, '휴일은 주 1회로 한다.', 'published', '2020-01-01', now()),
        ('${ver.s}', '${art.s}', 1, '연차 유급휴가는 15일이다.', 'published', '2020-01-01', now()),
        ('${ver.w}', '${art.w}', 1, '연차 유급휴가는 15일로 한다.', 'published', '2020-01-01', now());
    `);

    // 회사 1 연결: X 는 조(제60조) — 인용 자동 찾기가 만드는 모양, D 는 조와 항 둘 다, H 는 항(제70조제1항), N 은 항(제80조제1항)
    await link(t1.token, la.jo60, art.x, '연차 유급휴가');
    await link(t1.token, la.jo60, art.d, '연차 유급휴가');
    await link(t1.token, la.p601, art.d, '연차 유급휴가');
    await link(t1.token, la.p701, art.h, '출산전후휴가');
    await link(t1.token, la.p801, art.n, '휴일');
    // S 는 조에 추천 상태로만. 그리고 회사 1 이름으로 회사 2 의 조문(W)을 가리키는 잘못된 행 —
    // 연결의 회사만 보면 회사 1 의 영향으로 잡힌다(T-41 과 같은 모양). 제90조에는 이 잘못된 행만 둔다 —
    // 회사 1 의 정상 연결이 없는 조라서, 소속 확인이 빠지면 그 변경이 회사 1 쪽에 바로 나타난다
    sql(`
      INSERT INTO law_links (id, tenant_id, law_article_id, article_id, relation_type, confirm_state, updated_at) VALUES
        ('${randomUUID()}', '${t1.user.tenantId}', '${la.jo60}', '${art.s}', 'citation', 'suggested', now()),
        ('${randomUUID()}', '${t1.user.tenantId}', '${la.jo60}', '${art.w}', 'citation', 'confirmed', now()),
        ('${randomUUID()}', '${t1.user.tenantId}', '${la.jo90}', '${art.w}', 'citation', 'confirmed', now());
    `);
    // 회사 2 연결: W 는 조(제60조)
    await link(t2.token, la.jo60, art.w, '연차 유급휴가');
  }, 120_000);

  afterAll(() => {
    // 후보가 이벤트를 Restrict 로 잡고 있다 — 먼저 지워야 법령(→ 이벤트·조항·연결)을 지울 수 있다
    sql(`
      DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      DELETE FROM laws WHERE id='${lawId}';
      DELETE FROM law_sources WHERE id='${sourceId}';
    `);
  });

  describe('영향 조회', () => {
    it('조 머리 행에 건 연결이 항 개정을 받고, 상위 조항으로 찾았다고 표시한다', async () => {
      const res = await api(`/law-changes/${ev.p601}/impact`, { token: t1.token });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = res.body.impacted.map((i: { article: { id: string } }) => i.article.id).sort();
      expect(ids).toEqual([art.d, art.x].sort());
      const x = res.body.impacted.find((i: { article: { id: string } }) => i.article.id === art.x);
      expect(x).toMatchObject({ viaParent: true, linkLabel: '제60조' });
      expect(x.baseVersion.content).toBe('연차 유급휴가는 15일로 한다.');
    });

    it('같은 조문이 조·항에 둘 다 걸려 있으면 가까운 항 연결 하나로 잡는다', async () => {
      const res = await api(`/law-changes/${ev.p601}/impact`, { token: t1.token });
      const ds = res.body.impacted.filter((i: { article: { id: string } }) => i.article.id === art.d);
      expect(ds).toHaveLength(1);
      expect(ds[0]).toMatchObject({ viaParent: false, linkLabel: '제60조제1항' });
    });

    it('항에 건 연결이 그 아래 호의 개정을 받는다', async () => {
      const res = await api(`/law-changes/${ev.h7012}/impact`, { token: t1.token });
      expect(res.status).toBe(200);
      expect(res.body.impacted.map((i: { article: { id: string } }) => i.article.id)).toEqual([art.h]);
      expect(res.body.impacted[0]).toMatchObject({ viaParent: true, linkLabel: '제70조제1항' });
    });

    it('아래로는 퍼뜨리지 않는다 — 항에 건 연결은 조 머리 행의 변경을 받지 않는다', async () => {
      const res = await api(`/law-changes/${ev.jo80}/impact`, { token: t1.token });
      expect(res.status).toBe(200);
      expect(res.body.impacted).toEqual([]);
    });

    it('다른 회사의 조문은 섞이지 않는다 — 연결의 회사가 우리여도 조문이 다른 회사 것이면 뺀다', async () => {
      const mine = await api(`/law-changes/${ev.p601}/impact`, { token: t1.token });
      expect(mine.body.impacted.map((i: { article: { id: string } }) => i.article.id)).not.toContain(art.w);
      const theirs = await api(`/law-changes/${ev.p601}/impact`, { token: t2.token });
      expect(theirs.body.impacted.map((i: { article: { id: string } }) => i.article.id)).toEqual([art.w]);
      expect(theirs.body.impacted[0]).toMatchObject({ viaParent: true });
    });

    it('정상 연결이 없는 조에 다른 회사 조문을 가리키는 잘못된 행만 있으면 우리 회사 영향이 아니다', async () => {
      const res = await api(`/law-changes/${ev.p901}/impact`, { token: t1.token });
      expect(res.status).toBe(200);
      expect(res.body.impacted).toEqual([]);
      expect(res.body.suggestedCount).toBe(0);
    });

    it('확인 필요(추천) 수도 상위 조항까지 센다', async () => {
      const res = await api(`/law-changes/${ev.p601}/impact`, { token: t1.token });
      expect(res.body.suggestedCount).toBe(1); // S
      const theirs = await api(`/law-changes/${ev.p601}/impact`, { token: t2.token });
      expect(theirs.body.suggestedCount).toBe(0);
    });
  });

  describe('변경 목록', () => {
    it('"우리 조문에 걸린 변경만"과 개수가 상위 조항 연결을 센다', async () => {
      const res = await api(`/law-changes?lawId=${lawId}&affected=true`, { token: t1.token });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const byId = new Map(res.body.map((e: { id: string }) => [e.id, e]));
      expect([...byId.keys()].sort()).toEqual([ev.p601, ev.h7012].sort());
      // X·D 두 조문(D 는 조·항 둘 다 걸렸지만 한 번), 잘못된 행이 가리키는 다른 회사 조문(W)은 세지 않는다
      expect(byId.get(ev.p601)).toMatchObject({ impact: { confirmed: 2, suggested: 1 } });
      expect(byId.get(ev.h7012)).toMatchObject({ impact: { confirmed: 1, suggested: 0 } });
    });

    it('거르지 않은 목록에서도 개수는 같고, 걸린 것이 없는 변경은 0', async () => {
      const res = await api(`/law-changes?lawId=${lawId}`, { token: t1.token });
      const byId = new Map(res.body.map((e: { id: string }) => [e.id, e]));
      expect(byId.get(ev.p601)).toMatchObject({ impact: { confirmed: 2, suggested: 1 } });
      expect(byId.get(ev.jo80)).toMatchObject({ impact: { confirmed: 0, suggested: 0 } });
      // 잘못된 행(회사 1 → 회사 2 조문)만 걸린 제90조의 변경은 0
      expect(byId.get(ev.p901)).toMatchObject({ impact: { confirmed: 0, suggested: 0 } });
    });

    it('다른 회사의 목록에는 그 회사의 연결만 잡힌다', async () => {
      const res = await api(`/law-changes?lawId=${lawId}&affected=true`, { token: t2.token });
      expect(res.body.map((e: { id: string }) => e.id)).toEqual([ev.p601]);
      expect(res.body[0]).toMatchObject({ impact: { confirmed: 1, suggested: 0 } });
    });
  });

  describe('자동 생성 — 법령 동기화가 끝날 때', () => {
    it('상위 조항 연결로도 후보를 만든다 — 신뢰도는 보통까지, 조 단위 연결로 찾았다고 표시', async () => {
      const run = await api('/platform-admin/law-sync/run', { method: 'POST', token: platformToken, json: { limit: 1 } });
      expect(run.status, JSON.stringify(run.body)).toBeLessThan(300);
      expect(run.body.amendments).toMatchObject({ failed: 0 });

      const rows = sql(
        `SELECT article_id || '|' || confidence || '|' || array_to_string(review_flags, ',') FROM amendment_candidates WHERE tenant_id='${t1.user.tenantId}';`,
      )
        .split('\n')
        .filter(Boolean);
      const of = (articleId: string) => rows.find((r) => r.startsWith(`${articleId}|`));
      expect(rows).toHaveLength(3); // X·D(제60조제1항), H(제70조제1항제2호). N 은 아래로 퍼지지 않아 없다
      // X 는 규칙이 다 반영했지만(15일 → 16일) 조 단위 연결로 찾았으니 '높음'이 아니다
      expect(of(art.x)).toMatch(/^[^|]+\|medium\|.*parent_link/);
      expect(of(art.h)).toMatch(/^[^|]+\|medium\|.*parent_link/);
      // D 는 항에 직접 걸린 연결로 찾았다
      expect(of(art.d)).toMatch(/^[^|]+\|high\|/);
      expect(of(art.d)).not.toContain('parent_link');
      // 다른 회사 조문(W)은 회사 1 후보가 되지 않고, 회사 2 에 자기 후보로 생긴다
      expect(of(art.w)).toBeUndefined();
      expect(sql(`SELECT count(*) FROM amendment_candidates WHERE tenant_id='${t2.user.tenantId}' AND article_id='${art.w}';`)).toBe('1');
      // 잘못된 행만 걸린 제90조의 변경으로는 어느 회사에도 후보가 없다
      expect(sql(`SELECT count(*) FROM amendment_candidates WHERE change_event_id='${ev.p901}';`)).toBe('0');

      const xId = sql(`SELECT id FROM amendment_candidates WHERE tenant_id='${t1.user.tenantId}' AND article_id='${art.x}';`);
      const detail = await api(`/amendments/${xId}`, { token: t1.token });
      expect(detail.status).toBe(200);
      expect(detail.body.candidateContent).toBe('연차 유급휴가는 16일로 한다.');
      expect(detail.body.rationale.link).toMatchObject({ viaParent: true, label: '제60조', lawArticleId: la.jo60 });
      // 근거 경로: 바뀐 조항 → 연결된 상위 조항 → 연결 → 우리 조문
      expect(detail.body.rationale.path.map((p: { type: string }) => p.type)).toEqual(['lawArticle', 'lawArticle', 'lawLink', 'article']);
      expect(detail.body.rationale.path[0].id).toBe(la.p601);
      expect(detail.body.rationale.path[1].id).toBe(la.jo60);

      // 알림 — 회사 1 은 변경마다 한 번(제60조제1항, 제70조제1항제2호), 회사 2 는 한 번
      expect(await lawNotes(t1.token)).toHaveLength(2);
      expect(await lawNotes(t2.token)).toHaveLength(1);
    });

    it('다시 처리해도 이미 후보가 있는 조문에는 새 후보·알림이 없다 — 그 사이 기준 본문이 바뀌었어도', async () => {
      // X 에 법령 시행일 전에 시행될 새 시행본 — 예전에는 다시 처리하면 이 본문을 기준으로 후보가 또 생겼다
      sql(`
        UPDATE article_versions SET status='archived' WHERE id='${ver.x1}';
        INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at)
          VALUES ('${ver.x2}', '${art.x}', 2, '연차 유급휴가는 15일로 하고 근속 가산을 둔다.', 'published', '${day(1)}', now());
        UPDATE law_change_events SET amendments_processed_at = NULL WHERE law_id='${lawId}';
        UPDATE laws SET last_checked_at='1970-01-01' WHERE id='${lawId}';
      `);
      const run = await api('/platform-admin/law-sync/run', { method: 'POST', token: platformToken, json: { limit: 1 } });
      expect(run.status).toBeLessThan(300);
      expect(run.body.amendments).toMatchObject({ failed: 0 });
      expect(sql(`SELECT count(*) FROM amendment_candidates WHERE change_event_id IN ('${ev.p601}', '${ev.h7012}', '${ev.jo80}', '${ev.p901}');`)).toBe('4');
      expect(await lawNotes(t1.token)).toHaveLength(2);
      expect(await lawNotes(t2.token)).toHaveLength(1);
      // 사람이 고르는 "다시 만들기"(조문 하나)는 그대로 새 기준 본문으로 만든다 — 상위 조항 연결로 찾은 조문도
      const xId = sql(`SELECT id FROM amendment_candidates WHERE tenant_id='${t1.user.tenantId}' AND article_id='${art.x}';`);
      const regen = await api(`/amendments/${xId}/regenerate`, { method: 'POST', token: t1.token, json: {} });
      expect(regen.status, JSON.stringify(regen.body)).toBeLessThan(300);
      expect(regen.body).toMatchObject({ created: true, unchanged: false });
      const fresh = await api(`/amendments/${regen.body.candidateId}`, { token: t1.token });
      expect(fresh.body.reviewFlags).toContain('parent_link');
    });
  });
});

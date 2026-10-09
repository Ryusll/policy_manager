import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';

/**
 * 개정 후보 승인 → 후속 버전 발행 / 반려 (T-108, 특허 청구항 1 ⑦·6, 도 12).
 *
 * 법제처 없이 돈다 — 법령·조항·변경 이벤트를 DB 에 직접 심는다.
 *
 * 막고 싶은 사고:
 * 1. **조문 식별자가 바뀐다** — 승인은 같은 조문의 후속 버전이어야 연결·이력이 이어진다.
 * 2. **확인하지 않은 내용이 발행된다** — 검토를 요청한 그 판만, 화면이 본 판·잠금 그대로일 때만.
 * 3. **그 사이 바뀐 조문을 덮어쓴다** — 기준 본문이 어긋나거나 늦은 시행본·다른 발행이 있으면 막는다.
 * 4. **같은 승인이 두 번 발행된다** — 응답을 못 받고 다시 누르거나 동시에 눌러도 버전은 하나.
 * 5. 편집자가 승인하거나, 다른 회사 후보가 승인된다.
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

/** 한국 날짜 — 서버의 "오늘"(todayDateOnly)이 한국 날짜다(T-126). UTC 로 만들면 한국 시간 0~9시에 하루 어긋난다 */
const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const PW = 'IntegrationTest!234';

const LAW_BEFORE = '사용자는 근로자에게 15일의 유급휴가를 주어야 한다.';
const LAW_AFTER = '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.';
const TEXT_15 = '직원에게는 매년 15일의 연차휴가를 준다.';
const TEXT_20 = '직원에게는 매년 20일의 연차휴가를 준다.';

type Key = 'x' | 'm' | 'y' | 'z' | 'w' | 'u' | 'd' | 'p' | 'n' | 'q' | 'r';

describe('T-108 개정 후보 승인·반려', () => {
  const sourceId = randomUUID();
  const lawId = randomUUID();
  const lawArt = randomUUID();
  const lawArt2 = randomUUID(); // Q 에만 걸린 두 번째 조항 — 같은 조문에 후보가 둘
  const ev = randomUUID();
  const ev2 = randomUUID();
  const E = day(30); // 법령 시행일 = 승인에 쓸 사내 시행일
  const today = day(0);

  let t1: Awaited<ReturnType<typeof createTenant>>;
  let t2: Awaited<ReturnType<typeof createTenant>>;
  let editorToken = '';
  let editorId = '';
  let viewerId = '';
  let viewerToken = '';
  let policyId = '';
  let chapterId = '';
  const art = {} as Record<Key | 'g', string>;
  const ver = {} as Record<Key, string>;
  const cand = {} as Record<Key, string>;
  let candQ2 = '';

  const lockOf = async (id: string) => {
    const b = (await api(`/amendments/${id}`, { token: t1.token })).body;
    return { expectedRevision: b.revision, expectedLockVersion: b.lockVersion };
  };
  const approve = async (token: string, id: string, body: Record<string, unknown>) =>
    api(`/amendments/${id}/approve`, { method: 'POST', token, json: { ...(await lockOf(id)), ...body } });
  const reject = async (token: string, id: string, body: Record<string, unknown>) =>
    api(`/amendments/${id}/reject`, { method: 'POST', token, json: { ...(await lockOf(id)), ...body } });
  const requestReview = async (id: string, reason?: string) => {
    const r = await api(`/amendments/${id}/review`, {
      method: 'POST',
      token: editorToken,
      json: { ...(await lockOf(id)), ...(reason ? { reason } : {}) },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  };
  const versionsOf = (articleId: string) =>
    sql(`SELECT string_agg(version_num || ':' || status || ':' || coalesce(effective_date::text, '-'), ',' ORDER BY version_num) FROM article_versions WHERE article_id='${articleId}';`);
  const notes = async (token: string) =>
    ((await api('/notifications', { token })).body as any[]).filter((n) => ['law_amendment', 'policy_revision'].includes(n.kind));

  beforeAll(async () => {
    await waitForApi();
    t1 = await createTenant('amapp-1');
    t2 = await createTenant('amapp-2');
    const member = async (role: 'editor' | 'viewer', name: string) => {
      const email = `${role}-${t1.slug}@example.test`;
      const created = await api('/users', { method: 'POST', token: t1.token, json: { email, password: PW, name, role } });
      return { id: created.body.id as string, token: (await login(email, PW, t1.slug)).body.accessToken as string };
    };
    const editor = await member('editor', '편집자');
    editorToken = editor.token;
    editorId = editor.id;
    const viewer = await member('viewer', '열람자');
    viewerToken = viewer.token;
    viewerId = viewer.id;

    sql(`
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, updated_at)
        VALUES ('${lawId}', '${sourceId}', '900004', '990004', '승인시험법', '${E}', now());
      INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, label, content, version_key, sort_order, updated_at)
        VALUES ('${lawArt}', '${lawId}', '60/1/', 60, 1, '제60조제1항', '${LAW_AFTER}', 'v1:p2', 1, now()),
               ('${lawArt2}', '${lawId}', '61//', 61, NULL, '제61조', '휴가는 25일을 넘지 않는다.', 'v1:q2', 2, now());
      INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, before_version_key, after_version_key, law_effective_date, received_via, amendments_processed_at)
        VALUES ('${ev}', '${lawId}', '${lawArt}', '60/1/', 'modified', '${LAW_BEFORE}', '${LAW_AFTER}', 'v1:p1', 'v1:p2', '${E}', 'poll', now()),
               ('${ev2}', '${lawId}', '${lawArt2}', '61//', 'modified', '휴가는 15일을 넘지 않는다.', '휴가는 25일을 넘지 않는다.', 'v1:q1', 'v1:q2', '${E}', 'poll', now());
    `);

    const { policy, chapter, article } = await createPolicyWithArticle(t1.token, `APV-${Date.now().toString(36)}`, '취업규칙');
    policyId = policy.id;
    chapterId = chapter.id;
    art.x = article.id;
    const keys: Key[] = ['m', 'y', 'z', 'w', 'u', 'd', 'p', 'n', 'q', 'r'];
    for (const [i, k] of keys.entries()) {
      art[k] = (await api(`/policies/${policyId}/chapters/${chapterId}/articles`, {
        method: 'POST', token: t1.token, json: { number: i + 2, title: `조문 ${k}`, content: '본문' },
      })).body.id;
    }
    art.g = (await api(`/policies/${policyId}/chapters/${chapterId}/articles`, {
      method: 'POST', token: t1.token, json: { number: 20, title: '일반 승인', content: '처음 본문' },
    })).body.id;
    for (const k of ['x', ...keys] as Key[]) ver[k] = randomUUID();
    sql(`
      DELETE FROM article_versions WHERE article_id IN (${(['x', ...keys] as Key[]).map((k) => `'${art[k]}'`).join(',')});
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at) VALUES
        ${(['x', ...keys] as Key[])
          .map((k) => `('${ver[k]}', '${art[k]}', 1, '${k === 'm' || k === 'n' ? '연차휴가는 근로기준법에 따른다.' : TEXT_15}', 'published', '2020-01-01', now())`)
          .join(',\n        ')};
      UPDATE policies SET metadata = '{"revisionNotify": {"enabled": true, "userIds": ["${viewerId}"], "groupIds": []}}' WHERE id = '${policyId}';
    `);
    for (const k of ['x', ...keys] as Key[]) {
      const r = await api('/law-links', { method: 'POST', token: t1.token, json: { lawArticleId: lawArt, articleId: art[k], relationType: 'delegation', evidenceText: '연차휴가 일수' } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const q2 = await api('/law-links', { method: 'POST', token: t1.token, json: { lawArticleId: lawArt2, articleId: art.q, relationType: 'delegation' } });
    expect(q2.status).toBe(201);
    const g2 = await api('/amendments/generate', { method: 'POST', token: t1.token, json: { changeEventId: ev2 } });
    candQ2 = g2.body.created[0].id;
    const g = await api('/amendments/generate', { method: 'POST', token: t1.token, json: { changeEventId: ev } });
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    for (const c of g.body.created) {
      const k = (Object.keys(art) as Array<Key | 'g'>).find((key) => art[key] === c.articleId) as Key;
      cand[k] = c.id;
    }
    for (const k of ['x', 'y', 'z', 'w', 'u', 'p', 'q', 'r'] as Key[]) await requestReview(cand[k]);
    await requestReview(candQ2);
    await requestReview(cand.m, '우리 규정은 근로기준법을 따른다고만 적었다');
    await requestReview(cand.n, '개정 불필요 판단');
  }, 180_000);

  afterAll(() => {
    sql(`
      DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      UPDATE article_versions SET change_event_id = NULL WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      DELETE FROM laws WHERE id='${lawId}'; DELETE FROM law_sources WHERE id='${sourceId}';
    `);
  });

  describe('권한·입력', () => {
    it('승인·반려는 관리자만 — 편집자·열람자 403, 다른 회사 404', async () => {
      expect((await approve(editorToken, cand.x, { effectiveDate: E, changeNote: '반영' })).status).toBe(403);
      expect((await reject(editorToken, cand.x, { reason: '안 됨' })).status).toBe(403);
      expect((await approve(viewerToken, cand.x, { effectiveDate: E, changeNote: '반영' })).status).toBe(403);
      const other = await api(`/amendments/${cand.x}/approve`, {
        method: 'POST', token: t2.token, json: { effectiveDate: E, changeNote: '반영', expectedRevision: 1, expectedLockVersion: 1 },
      });
      expect(other.status).toBe(404);
    });

    it('사유·시행일이 없거나 틀리면 400 — 소급 불가, 법령 시행일보다 이르면 이유 필수', async () => {
      expect((await approve(t1.token, cand.x, { effectiveDate: E, changeNote: '  ' })).status).toBe(400);
      expect((await approve(t1.token, cand.x, { effectiveDate: '2027/01/01', changeNote: '반영' })).status).toBe(400);
      expect((await approve(t1.token, cand.x, { effectiveDate: '2027-02-30', changeNote: '반영' })).status).toBe(400);
      // 이른 시행 이유를 줘도 과거 날짜는 안 된다 — 소급 개정은 하지 않는다
      const past = await approve(t1.token, cand.x, { effectiveDate: day(-1), changeNote: '반영', earlyReason: '이유' });
      expect(past.status).toBe(400);
      expect(past.body.message).toMatch(/소급/);
      const early = await approve(t1.token, cand.x, { effectiveDate: today, changeNote: '반영' });
      expect(early.status).toBe(400);
      expect(early.body.message).toMatch(/법령 시행일/);
      expect(sql(`SELECT review_state FROM amendment_candidates WHERE id='${cand.x}';`)).toBe('review');
    });

    it('본문이 기준 본문과 같으면 승인하지 않는다 — 개정이 필요 없으면 반려로 닫는다', async () => {
      const r = await approve(t1.token, cand.n, { effectiveDate: E, changeNote: '반영' });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/반려로/);
    });

    it('검토 중이 아니거나 판·잠금이 어긋나면 승인하지 않는다', async () => {
      expect((await approve(t1.token, cand.d, { effectiveDate: E, changeNote: '반영' })).status).toBe(400); // 작성 상태
      const stale = await api(`/amendments/${cand.x}/approve`, {
        method: 'POST', token: t1.token, json: { effectiveDate: E, changeNote: '반영', ...(await lockOf(cand.x)), expectedLockVersion: 99 },
      });
      expect(stale.status).toBe(409);
      expect(versionsOf(art.x)).toBe('1:published:2020-01-01');
    });
  });

  describe('승인', () => {
    it('같은 조문의 후속 버전으로 발행 — 시행일·발행일·원천 연결, 옛 시행본은 폐지', async () => {
      const { status, body } = await approve(t1.token, cand.x, { effectiveDate: E, changeNote: '근로기준법 제60조 개정 반영' });
      expect(status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({ reviewState: 'approved', decision: { state: 'approved', revision: 1 }, resultVersion: { versionNum: 2, effectiveDate: E } });
      expect(versionsOf(art.x)).toBe(`1:archived:2020-01-01,2:published:${E}`);
      expect(
        sql(`SELECT content || '|' || (published_at IS NOT NULL) || '|' || change_event_id || '|' || source_candidate_id || '|' || change_note FROM article_versions WHERE article_id='${art.x}' AND version_num=2;`),
      ).toBe(`${TEXT_20}|true|${ev}|${cand.x}|근로기준법 제60조 개정 반영`);
    });

    it('시점 조회는 시행일 전까지 옛 본문, 시행일부터 새 본문', async () => {
      const at = async (date: string) =>
        (await api(`/policies/${policyId}/as-of?date=${date}`, { token: t1.token })).body.chapters
          .flatMap((c: any) => c.articles)
          .find((a: any) => a.id === art.x)?.versions?.[0]?.content;
      expect(await at(day(29))).toBe(TEXT_15);
      expect(await at(E)).toBe(TEXT_20);
    });

    it('감사 기록 한 건에 발행 버전·변경 이벤트·후보·비교 정보·승인자, 개정 당시 근거까지', async () => {
      const logs = await api('/audit-logs?action=amendment.approve', { token: t1.token });
      expect(logs.body.total).toBe(1);
      const row = (await api(`/audit-logs/${logs.body.rows[0].id}`, { token: t1.token })).body;
      expect(row.userId).toBe(t1.user.id);
      expect(row.details).toMatchObject({
        version: { versionNum: 2, contentHash: sha(TEXT_20), effectiveDate: E },
        changeEvent: { id: ev, law: '승인시험법', label: '제60조제1항', lawEffectiveDate: E },
        candidate: { id: cand.x, revision: 1, revisionHash: sha(TEXT_20), baseVersionId: ver.x },
        comparison: { changes: 1, unexplained: 0 },
        changeNote: '근로기준법 제60조 개정 반영',
        evidence: { link: { relationType: 'delegation', evidenceText: '연차휴가 일수' }, engine: 'rule/1' },
      });
      expect(row.details.comparison.revisionId).toBeTruthy();
    });

    it('요청자에게 결과, 규정 알림 수신자에게 시행 예정 알림 — 승인한 사람은 빼고 한 번씩', async () => {
      const editorNotes = await notes(editorToken);
      expect(editorNotes).toHaveLength(1);
      expect(editorNotes[0]).toMatchObject({ kind: 'law_amendment', link: `/amendments/${cand.x}` });
      expect(editorNotes[0].title).toMatch(/^\[개정 후보 승인\] 취업규칙 제1조/);
      const viewerNotes = await notes(viewerToken);
      expect(viewerNotes).toHaveLength(1);
      expect(viewerNotes[0]).toMatchObject({ kind: 'policy_revision', title: `[개정 발행 · ${E} 시행 예정] 취업규칙`, articleId: art.x });
      expect(await notes(t1.token)).toEqual([]);
    });

    it('같은 요청을 다시 보내면 기존 결과 — 버전·감사·알림을 또 만들지 않는다. 다른 내용이면 409', async () => {
      const again = await api(`/amendments/${cand.x}/approve`, {
        method: 'POST', token: t1.token, json: { effectiveDate: E, changeNote: '근로기준법 제60조 개정 반영', expectedRevision: 1, expectedLockVersion: 0 },
      });
      expect(again.status).toBe(200);
      expect(again.body.alreadyApproved).toBe(true);
      const differ = await api(`/amendments/${cand.x}/approve`, {
        method: 'POST', token: t1.token, json: { effectiveDate: E, changeNote: '다른 사유', expectedRevision: 1, expectedLockVersion: 0 },
      });
      expect(differ.status).toBe(409);
      expect(versionsOf(art.x)).toBe(`1:archived:2020-01-01,2:published:${E}`);
      expect((await api('/audit-logs?action=amendment.approve', { token: t1.token })).body.total).toBe(1);
      expect(await notes(editorToken)).toHaveLength(1);
    });

    it('승인된 후보는 고치거나 반려할 수 없다', async () => {
      const lock = await lockOf(cand.x);
      expect((await api(`/amendments/${cand.x}`, { method: 'PATCH', token: t1.token, json: { ...lock, candidateContent: '바꿈', note: '승인 뒤' } })).status).toBe(400);
      expect((await reject(t1.token, cand.x, { reason: '늦은 반려' })).status).toBe(400);
    });
  });

  describe('반려', () => {
    it('사유와 함께 반려 — 발행본은 그대로, 요청자에게 알림', async () => {
      expect((await reject(t1.token, cand.m, { reason: ' ' })).status).toBe(400);
      const { status, body } = await reject(t1.token, cand.m, { reason: '개정 불필요 — 법 조문을 따르게만 되어 있다' });
      expect(status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({ reviewState: 'rejected', decision: { state: 'rejected', reason: '개정 불필요 — 법 조문을 따르게만 되어 있다' } });
      expect(versionsOf(art.m)).toBe('1:published:2020-01-01');
      expect((await api('/audit-logs?action=amendment.reject', { token: t1.token })).body.total).toBe(1);
      expect((await notes(editorToken)).some((n) => n.title.startsWith('[개정 후보 반려]'))).toBe(true);
      expect((await approve(t1.token, cand.m, { effectiveDate: E, changeNote: '반영' })).status).toBe(400);
    });

    it('반려된 후보를 고치면 작성으로 — 반려 사유와 고치기 전 내용은 이력에 남는다', async () => {
      const lock = await lockOf(cand.m);
      const e = await api(`/amendments/${cand.m}`, { method: 'PATCH', token: editorToken, json: { ...lock, candidateContent: '연차휴가는 20일로 한다.', note: '반려 뒤 직접 고침' } });
      expect(e.body).toMatchObject({ reviewState: 'draft', revision: 2 });
      const h = (await api(`/amendments/${cand.m}/history`, { token: t1.token })).body;
      expect(h.stateChanges.map((c: any) => `${c.fromState}>${c.toState}`)).toEqual(['draft>review', 'review>rejected', 'rejected>draft']);
      expect(h.stateChanges[0].actor).toMatchObject({ id: editorId }); // 검토를 요청한 사람
      expect(h.stateChanges[1]).toMatchObject({ reason: '개정 불필요 — 법 조문을 따르게만 되어 있다', actor: { id: t1.user.id } });
      expect(h.revisions.map((r: any) => r.content)).toEqual(['연차휴가는 근로기준법에 따른다.', '연차휴가는 20일로 한다.']);
    });
  });

  describe('기준 본문 확인 — 어긋나면 원인을 담아 409, 아무것도 바꾸지 않는다', () => {
    const expectBlocked = async (k: Key, reason: string) => {
      const before = versionsOf(art[k]);
      const r = await approve(t1.token, cand[k], { effectiveDate: E, changeNote: '반영' });
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(r.body.reason).toBe(reason);
      expect(versionsOf(art[k])).toBe(before);
      expect(sql(`SELECT review_state FROM amendment_candidates WHERE id='${cand[k]}';`)).toBe('review');
    };

    it('그 시행일의 시행본이 기준 본문이 아니면 base_mismatch — 그 시행일로 다시 만들면 승인된다', async () => {
      const v2 = randomUUID();
      sql(`UPDATE article_versions SET status='archived' WHERE id='${ver.y}';
           INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at)
             VALUES ('${v2}', '${art.y}', 2, '직원에게는 매년 15일의 연차휴가를 주고 이월할 수 있다.', 'published', '${day(-1)}', now());`);
      await expectBlocked('y', 'base_mismatch');
      const re = await api(`/amendments/${cand.y}/regenerate`, { method: 'POST', token: t1.token, json: { asOf: E } });
      expect(re.body).toMatchObject({ created: true });
      await requestReview(re.body.candidateId);
      const ok = await approve(t1.token, re.body.candidateId, { effectiveDate: E, changeNote: '다시 만든 후보로 반영' });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(versionsOf(art.y)).toBe(`1:archived:2020-01-01,2:archived:${day(-1)},3:published:${E}`);
    });

    it('다시 만들기는 승인하려던 시행일을 기준으로 — 기본 기준일(법령 시행일)과 다른 날이어도', async () => {
      const v2 = randomUUID();
      const E5 = day(35);
      sql(`INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at)
           VALUES ('${v2}', '${art.r}', 2, '직원에게는 매년 15일의 연차휴가를 주고 신청을 받아 준다.', 'published', '${day(32)}', now());`);
      const blockedR = await approve(t1.token, cand.r, { effectiveDate: E5, changeNote: '반영' });
      expect(blockedR.body.reason).toBe('base_mismatch');
      const re = await api(`/amendments/${cand.r}/regenerate`, { method: 'POST', token: t1.token, json: { asOf: E5 } });
      expect(re.body).toMatchObject({ created: true });
      const fresh = (await api(`/amendments/${re.body.candidateId}`, { token: t1.token })).body;
      expect(fresh.baseVersion.id).toBe(v2); // 시행일(E+5)의 시행본 — 기본 기준일(E)이면 v1 이었다
      expect(fresh.asOf).toBe(E5);
    });

    it('그 시행일보다 늦은 시행본이 있으면 later_version', async () => {
      sql(`INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at)
           VALUES ('${randomUUID()}', '${art.z}', 2, '나중 본문', 'published', '${day(40)}', now());`);
      await expectBlocked('z', 'later_version');
    });

    it('기준 본문은 같아도 그 사이 다른 발행이 있었으면 history_changed', async () => {
      sql(`INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at)
           VALUES ('${randomUUID()}', '${art.w}', 2, '더 이른 시행일로 발행된 다른 본문', 'archived', '2019-01-01', now());`);
      expect((await api(`/amendments/${cand.w}`, { token: t1.token })).body).toMatchObject({ isCurrentBase: false, staleReason: 'history_changed' });
      await expectBlocked('w', 'history_changed');
    });

    it('시행일이 기록되지 않은 시행본이 있으면 undated_history', async () => {
      sql(`INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at)
           VALUES ('${randomUUID()}', '${art.u}', 2, '시행일 없는 옛 본문', 'archived', NULL, now());`);
      await expectBlocked('u', 'undated_history');
    });
  });

  describe('동시 승인·일반 승인', () => {
    it('같은 승인을 동시에 눌러도 버전은 하나', async () => {
      const lock = await lockOf(cand.p);
      const body = { effectiveDate: E, changeNote: '동시에 누름', ...lock };
      const [a, b] = await Promise.all([
        api(`/amendments/${cand.p}/approve`, { method: 'POST', token: t1.token, json: body }),
        api(`/amendments/${cand.p}/approve`, { method: 'POST', token: t1.token, json: body }),
      ]);
      expect([a.status, b.status].sort()).toEqual(expect.arrayContaining([200]));
      expect([a.status, b.status].every((s) => s === 200 || s === 409)).toBe(true);
      expect(sql(`SELECT count(*) FROM article_versions WHERE source_candidate_id='${cand.p}';`)).toBe('1');
      expect(versionsOf(art.p)).toBe(`1:archived:2020-01-01,2:published:${E}`);
    });

    it('같은 조문의 서로 다른 후보를 동시에 승인해도 하나만 — 조문 단위로 줄 세운다', async () => {
      const bodyOf = async (id: string) => ({ effectiveDate: E, changeNote: '동시 승인', ...(await lockOf(id)) });
      const bodies = [await bodyOf(cand.q), await bodyOf(candQ2)];
      // 두 승인이 확실히 겹치도록 이 조문의 버전 저장을 1.5초 늦추는 테스트용 트리거 — 잠금이 없으면 둘 다
      // 같은 이력을 읽고 발행해 시행본이 둘이 된다
      sql(`CREATE OR REPLACE FUNCTION it_slow_publish_${art.q.slice(0, 8)}() RETURNS trigger AS $$
           BEGIN IF NEW.article_id = '${art.q}' THEN PERFORM pg_sleep(1.5); END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
           CREATE TRIGGER it_slow_publish_${art.q.slice(0, 8)} BEFORE INSERT ON article_versions
             FOR EACH ROW EXECUTE FUNCTION it_slow_publish_${art.q.slice(0, 8)}();`);
      let a: Awaited<ReturnType<typeof api>>;
      let b: Awaited<ReturnType<typeof api>>;
      try {
        [a, b] = await Promise.all([
          api(`/amendments/${cand.q}/approve`, { method: 'POST', token: t1.token, json: bodies[0] }),
          api(`/amendments/${candQ2}/approve`, { method: 'POST', token: t1.token, json: bodies[1] }),
        ]);
      } finally {
        sql(`DROP TRIGGER IF EXISTS it_slow_publish_${art.q.slice(0, 8)} ON article_versions;
             DROP FUNCTION IF EXISTS it_slow_publish_${art.q.slice(0, 8)}();`);
      }
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(sql(`SELECT count(*) FROM article_versions WHERE article_id='${art.q}' AND status='published';`)).toBe('1');
      expect(versionsOf(art.q)).toBe(`1:archived:2020-01-01,2:published:${E}`);
    });

    it('일반 조문 승인도 발행일을 남긴다', async () => {
      const created = await api(`/articles/${art.g}/versions`, { method: 'POST', token: t1.token, json: { content: '고친 본문', changeNote: '개정' } });
      expect(created.status).toBe(201);
      expect((await api(`/versions/${created.body.id}/submit`, { method: 'POST', token: t1.token })).status).toBeLessThan(300);
      const ok = await api(`/versions/${created.body.id}/approve`, { method: 'POST', token: t1.token, json: { changeNote: '일반 개정', effectiveDate: today } });
      expect(ok.status).toBeLessThan(300);
      expect(sql(`SELECT published_at IS NOT NULL FROM article_versions WHERE id='${created.body.id}';`)).toBe('t');
    });
  });
});

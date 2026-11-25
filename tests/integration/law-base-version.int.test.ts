import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { api, createPolicyWithArticle, createTenant, waitForApi } from './helpers';
import { FakeLaw, requireRedis, type FakeVersion } from './lawgokr-seed';

/**
 * 먼저 공포된 판이 아직 시행 전일 때의 기준판 (T-150 ③④·검토) — 가짜 법제처(lawgokr-seed)로 돈다.
 *
 * 판 본문은 공포 순으로 쌓인다. 현행 판(S)보다 먼저 공포된 판(B)이 아직 시행 전이면 S 의 본문에 B 의 개정이 이미 들어 있다.
 * 2026-11 운영의 근로기준법·자본시장법·산업안전보건법이 그렇게 등록돼 B 의 개정이 변경 이벤트·개정 후보 없이 묻혔다.
 *
 * 막고 싶은 사고:
 * 1. S 로 등록해 B 의 개정이 묻힌다 — B 의 바로 앞 판(P)을 기준으로 등록하고 동기화가 B·S 를 차례로 반영해야 한다
 * 2. 이미 그렇게 묻힌 법령을 찾지 못한다(보정 계획이 '등록 때 시행 중'만 본다)
 * 3. 동기화가 뒤 판까지 걸어 둔 법령은 고칠 수단이 없다 — 다시 걸기는 연결·개정 후보가 없을 때만, 있으면 아무것도 지우지 않는다
 */
function sql(query: string): string {
  return execSync(`docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`, {
    encoding: 'utf8',
    input: query,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

const CLI = process.env.LAW_SYNC_CLI || 'docker compose exec -T api node dist/laws/law-sync.cli.js';
function cli(args: string): { code: number; out: string } {
  try {
    return { code: 0, out: execSync(`${CLI} ${args}`, { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const art = (no: string, title: string, body: string) => ({ no, title, body });
// 시행 예정 판의 시행일 — 시험이 언제 돌아도 오늘 뒤다
const FUTURE = '20991127';

describe('T-150 먼저 공포된 시행 전 판과 기준판 (가짜 법제처)', () => {
  let pf: Awaited<ReturnType<typeof createTenant>>;
  const fakes: FakeLaw[] = [];
  const lawIds: string[] = [];
  const fake = (prefix: string) => {
    const f = new FakeLaw(prefix);
    fakes.push(f);
    return f;
  };
  const run = async (lawId: string) => {
    const res = await api('/platform-admin/law-sync/run', { method: 'POST', token: pf.token, json: { lawId } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.results[0];
  };
  const versions = (lawId: string) => sql(`SELECT string_agg(mst || ':' || kind, ',' ORDER BY order_key) FROM law_versions WHERE law_id='${lawId}';`);

  beforeAll(async () => {
    await waitForApi();
    pf = await createTenant('lawbase-pf');
    sql(`UPDATE users SET platform_role='global_admin' WHERE id='${pf.user.id}';`);
    requireRedis();
  }, 90_000);

  afterAll(() => {
    if (lawIds.length) {
      const ids = lawIds.map((id) => `'${id}'`).join(',');
      sql(`
        DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id IN (${ids}));
        UPDATE article_versions SET change_event_id = NULL WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id IN (${ids}));
        DELETE FROM law_links WHERE law_article_id IN (SELECT id FROM law_articles WHERE law_id IN (${ids}));
        DELETE FROM laws WHERE id IN (${ids});
      `);
    }
    for (const f of fakes) f.cleanup();
  });

  describe('등록 — 현행 판보다 먼저 공포된 판이 시행 전이면 그 앞 판으로', () => {
    const law = fake('앞판기준시험법');
    const P: FakeVersion = { mst: law.mst(1), promulgated: '20250110', promulgationNo: '901', effective: '20250201', articles: [art('1', '휴가', '휴가는 2일로 한다.')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20250310', promulgationNo: '902', effective: FUTURE, articles: [art('1', '휴가', '휴가는 4일로 한다.')] };
    // S 의 본문에는 먼저 공포된 B 의 개정(4일)이 들어 있다
    const S: FakeVersion = { mst: law.mst(3), promulgated: '20250410', promulgationNo: '903', effective: '20250501', articles: [art('1', '휴가', '휴가는 4일로 한다.'), art('2', '신설', '새 조문.')] };
    let lawId = '';

    it('현행 판(S)을 요청해도 B 의 바로 앞 판(P)으로 등록한다', async () => {
      law.seedAll([P, B, S], S);
      const res = await api('/laws', { method: 'POST', token: pf.token, json: { mst: S.mst } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      lawId = res.body.id;
      lawIds.push(lawId);
      expect(res.body).toMatchObject({ externalId: P.mst, requestedMst: S.mst });
      // 등록 알림이 '현행 판으로 등록'이라 하지 않게 — 어느 시행 전 판 때문인지 싣는다. 첫 확인 전이라 화면이 그것을 알린다(T-150 마지막 검토)
      expect(res.body.beforePending).toBe('제902호(2025-03-10 공포)');
      expect(sql(`SELECT last_checked_at IS NULL FROM laws WHERE id='${lawId}';`)).toBe('t');
      expect(versions(lawId)).toBe(`${P.mst}:baseline`);
    });

    it('다음 동기화가 B·S 를 공포 순으로 반영한다 — B 의 개정이 시행 예정 변경으로, 현행 문구는 B 전 문구', async () => {
      const r = await run(lawId);
      expect(r.outcome, JSON.stringify(r)).toBe('updated');
      expect(versions(lawId)).toBe(`${P.mst}:baseline,${B.mst}:change,${S.mst}:change`);
      const res = await api(`/laws/${lawId}/in-force`, { token: pf.token });
      expect(res.status).toBe(200);
      expect(res.body.current).toMatchObject({ mst: S.mst });
      expect(res.body.scheduled.map((v: { mst: string }) => v.mst)).toEqual([B.mst]);
      const vacation = res.body.articles.find((a: { articleNo: number }) => a.articleNo === 1);
      expect(vacation).toMatchObject({ content: '휴가는 2일로 한다.', scheduled: { content: '휴가는 4일로 한다.', effectiveDate: '2099-11-27' } });
    });
  });

  describe('보정 — 이미 S 로 등록돼 B 가 묻히고, 동기화가 뒤 판(T)까지 걸어 둔 법령', () => {
    const law = fake('다시걸기시험법');
    const P: FakeVersion = { mst: law.mst(1), promulgated: '20250110', promulgationNo: '911', effective: '20250201', articles: [art('1', '휴가', '휴가는 2일로 한다.')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20250310', promulgationNo: '912', effective: FUTURE, articles: [art('1', '휴가', '휴가는 4일로 한다.')] };
    const S: FakeVersion = { mst: law.mst(3), promulgated: '20250410', promulgationNo: '913', effective: '20250501', articles: [art('1', '휴가', '휴가는 4일로 한다.')] };
    const T: FakeVersion = { mst: law.mst(4), promulgated: '20250610', promulgationNo: '914', effective: '20250701', articles: [art('1', '휴가', '휴가는 4일로 한다.'), art('2', '신설', '새 조문.')] };
    let lawId = '';
    let linkId = '';

    it('T-150 검토 전처럼 S 로 등록된 법령을 만들고(그때 목록에 B 가 안 보였다고 흉내) 동기화가 T 까지 건다', async () => {
      law.seedAll([P, S], S);
      const res = await api('/laws', { method: 'POST', token: pf.token, json: { mst: S.mst } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      lawId = res.body.id;
      lawIds.push(lawId);
      expect(res.body.externalId).toBe(S.mst);
      law.seedAll([P, B, S, T], T);
      const r = await run(lawId);
      expect(r.outcome, JSON.stringify(r)).toBe('updated');
      expect(versions(lawId)).toBe(`${S.mst}:baseline,${T.mst}:change`);
    });

    it('보정 계획이 묻힌 B 를 잡지만, 동기화가 걸었으니 --reset 없이는 막는다', () => {
      const r = cli(`--rebaseline ${lawId}`);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toContain('--reset');
      const reset = cli(`--rebaseline ${lawId} --reset`);
      expect(reset.code, reset.out).toBe(0);
      expect(reset.out).toContain(`묻힌 판 MST ${B.mst}`);
      expect(reset.out).toContain(`기준 MST ${T.mst} → ${P.mst}`);
      expect(sql(`SELECT external_id FROM laws WHERE id='${lawId}';`)).toBe(T.mst); // 계획만
    });

    it('이 법령에 연결이 걸려 있으면 다시 걸지 않는다 — 아무것도 지우지 않는다', async () => {
      const set = await createPolicyWithArticle(pf.token, `LB-${Date.now().toString(36)}`, '다시걸기규정');
      const lawArticleId = sql(`SELECT id FROM law_articles WHERE law_id='${lawId}' AND article_no=1 AND clause_no IS NULL AND item_no IS NULL;`);
      const link = await api('/law-links', { method: 'POST', token: pf.token, json: { lawArticleId, articleId: set.article.id, relationType: 'delegation', evidenceText: '휴가' } });
      expect(link.status, JSON.stringify(link.body)).toBe(201);
      linkId = link.body.id;
      const events = sql(`SELECT count(*) FROM law_change_events WHERE law_id='${lawId}';`);
      const r = cli(`--rebaseline ${lawId} --reset --apply`);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toContain('연결 1건');
      expect(sql(`SELECT count(*) FROM law_change_events WHERE law_id='${lawId}';`)).toBe(events);
      expect(sql(`SELECT external_id FROM laws WHERE id='${lawId}';`)).toBe(T.mst);
    });

    it('연결이 없으면 다시 건다 — 이벤트·판 기록을 지우고 P 를 기준판으로, 다음 동기화가 B 부터 반영한다', async () => {
      sql(`DELETE FROM law_links WHERE id='${linkId}';`);
      const r = cli(`--rebaseline ${lawId} --reset --apply`);
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain('지운 이벤트');
      expect(sql(`SELECT external_id || '|' || coalesce(last_checked_at::text, 'null') FROM laws WHERE id='${lawId}';`)).toBe(`${P.mst}|null`);
      expect(versions(lawId)).toBe(`${P.mst}:baseline`);
      expect(sql(`SELECT count(*) FROM law_change_events WHERE law_id='${lawId}';`)).toBe('0');

      const again = await run(lawId);
      expect(again.outcome, JSON.stringify(again)).toBe('updated');
      expect(versions(lawId)).toBe(`${P.mst}:baseline,${B.mst}:change,${S.mst}:change,${T.mst}:change`);
      const res = await api(`/laws/${lawId}/in-force`, { token: pf.token });
      expect(res.body.scheduled.map((v: { mst: string }) => v.mst)).toEqual([B.mst]);
      expect(res.body.articles.find((a: { articleNo: number }) => a.articleNo === 1)).toMatchObject({ content: '휴가는 2일로 한다.' });
    });
  });
});

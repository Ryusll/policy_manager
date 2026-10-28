import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { api, createTenant, waitForApi } from './helpers';
import { FakeLaw, requireRedis, type FakeVersion } from './lawgokr-seed';

/**
 * 시행 예정 법령 바로 다루기 (T-150 ②③④, SRS LAW-15) — 가짜 법제처(lawgokr-seed)로 돈다.
 *
 * 막고 싶은 사고:
 * 1. 공포됐지만 시행 전인 개정의 문구가 법령 화면에서 오늘 시행 중인 것처럼 보이고, 시행일에 삭제될 조항이 받자마자 사라진다
 * 2. 시행 예정 판으로 등록하면 그 판이 기준판이 돼 개정이 변경 이벤트·개정 후보 없이 묻힌다
 * 3. 이미 묻힌 법령을 되돌릴 수단이 없다
 */
function sql(query: string): string {
  return execSync(`docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`, {
    encoding: 'utf8',
    input: query,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/** 법령 동기화 CLI — 기본은 docker 의 API 컨테이너. 따로 띄운 API 로 시험할 때는 LAW_SYNC_CLI 로 그 명령을 준다 */
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

describe('T-150 시행 예정 법령 (가짜 법제처)', () => {
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

  beforeAll(async () => {
    await waitForApi();
    pf = await createTenant('lawforce-pf');
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

  describe('현행 판 + 시행 예정 판', () => {
    const law = fake('시행예정시험법');
    const A: FakeVersion = {
      mst: law.mst(1), promulgated: '20250101', promulgationNo: '101', effective: '20250201',
      articles: [art('1', '목적', '이 법은 목적을 정한다.'), art('2', '휴가', '휴가는 2일로 한다.'), art('4', '옛 조문', '없어질 조문이다.')],
    };
    const B: FakeVersion = {
      mst: law.mst(2), promulgated: '20260901', promulgationNo: '21700', effective: FUTURE,
      articles: [art('1', '목적', '이 법은 목적을 정한다.'), art('2', '휴가', '휴가는 4일로 한다.'), art('3', '신설', '새로 생기는 조문이다.')],
    };
    let lawId = '';

    it('시행 예정 판으로 등록을 요청하면 현행 판으로 등록하고 다음 동기화의 맨 앞에 세운다', async () => {
      law.seedAll([A, B], A);
      const res = await api('/laws', { method: 'POST', token: pf.token, json: { mst: B.mst } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      lawId = res.body.id;
      lawIds.push(lawId);
      expect(res.body).toMatchObject({ externalId: A.mst, requestedMst: B.mst, lastCheckedAt: null, alreadyTracked: false });
      expect(sql(`SELECT count(*) FROM law_change_events WHERE law_id='${lawId}';`)).toBe('0');
    });

    it('동기화가 시행 예정 판을 변경으로 받고, 조항 본문은 그 판(시행 전) 문구가 된다 — 삭제될 조항은 사라짐 표시', async () => {
      const r = await run(lawId);
      expect(r.outcome, JSON.stringify(r)).toBe('updated');
      const raw = await api(`/laws/${lawId}/articles`, { token: pf.token });
      const body = raw.body as { nodeKey: string; content: string }[];
      expect(body.find((a) => a.content.includes('휴가는'))?.content).toContain('4일');
      expect(body.some((a) => a.content.includes('없어질 조문'))).toBe(false);
    });

    it('현행·예정 조회는 지금 시행 중인 문구와 시행 예정 변경(신설·변경·삭제, 시행일)을 가른다', async () => {
      const res = await api(`/laws/${lawId}/in-force`, { token: pf.token });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const { current, scheduled, articles } = res.body as {
        current: { promulgationNo: string; effectiveDate: string };
        scheduled: { promulgationNo: string; effectiveDate: string; changeCount: number }[];
        articles: { content: string | null; title: string | null; scheduled: { changeType: string; content: string | null; effectiveDate: string } | null }[];
      };
      expect(current).toMatchObject({ promulgationNo: '101', effectiveDate: '2025-02-01' });
      expect(scheduled).toEqual([expect.objectContaining({ promulgationNo: '21700', effectiveDate: '2099-11-27', changeCount: 3 })]);
      const byTitle = (t: string) => articles.find((a) => a.title === t)!;
      expect(byTitle('휴가').content).toContain('2일');
      expect(byTitle('휴가').scheduled).toMatchObject({ changeType: 'modified', effectiveDate: '2099-11-27' });
      expect(byTitle('휴가').scheduled?.content).toContain('4일');
      expect(byTitle('신설')).toMatchObject({ content: null, scheduled: { changeType: 'created' } });
      expect(byTitle('옛 조문').content).toContain('없어질 조문');
      expect(byTitle('옛 조문').scheduled).toMatchObject({ changeType: 'deleted', content: null });
      expect(byTitle('목적').scheduled).toBeNull();
    });

    it('변경 목록은 어느 판의 개정인지(법률 제N호)를 함께 준다', async () => {
      const res = await api(`/law-changes?lawId=${lawId}`, { token: pf.token });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = (res.body.items ?? res.body) as { version: { lawType: string; promulgationNo: string } | null }[];
      expect(items.length).toBe(3);
      for (const e of items) expect(e.version).toEqual({ lawType: '법률', promulgationNo: '21700' });
    });
  });

  it('아직 시행된 판이 없는 법령은 등록하지 않는다 — 422 LAW_NOT_IN_FORCE', async () => {
    const law = fake('시행전시험법');
    const only: FakeVersion = { mst: law.mst(1), promulgated: '20260901', promulgationNo: '200', effective: FUTURE, articles: [art('1', '목적', '목적.')] };
    law.seedBody(only);
    law.seedVersionList([only]); // 현행 표시 없음
    const res = await api('/laws', { method: 'POST', token: pf.token, json: { mst: only.mst } });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe('LAW_NOT_IN_FORCE');
    expect(sql(`SELECT count(*) FROM laws WHERE external_law_id='${law.lawId}';`)).toBe('0');
  });

  describe('묻힌 법령 보정 (④)', () => {
    const law = fake('묻힘보정시험법');
    const A: FakeVersion = {
      mst: law.mst(1), promulgated: '20250101', promulgationNo: '301', effective: '20250201',
      articles: [art('1', '목적', '목적 조문.'), art('2', '휴가', '휴가는 2일로 한다.')],
    };
    const B: FakeVersion = {
      mst: law.mst(2), promulgated: '20260901', promulgationNo: '302', effective: FUTURE,
      articles: [art('1', '목적', '목적 조문.'), art('2', '휴가', '휴가는 4일로 한다.'), art('3', '신설', '새 조문.')],
    };
    let lawId = '';
    const articleId = (no: string) => sql(`SELECT id FROM law_articles WHERE law_id='${lawId}' AND article_no=${no} AND clause_no IS NULL AND item_no IS NULL;`);
    let vacationId = '';

    it('T-150 전처럼 시행 예정 판으로 등록된 법령을 만든다(그때 목록이 그 판을 현행으로 줬다고 흉내)', async () => {
      law.seedAll([A, B], B);
      const res = await api('/laws', { method: 'POST', token: pf.token, json: { mst: B.mst } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      lawId = res.body.id;
      lawIds.push(lawId);
      expect(res.body.externalId).toBe(B.mst);
      law.seedVersionList([A, B], A); // 실제로는 A 가 현행이다
      vacationId = articleId('2');
    });

    it('계획만 찍으면 DB 를 바꾸지 않는다', () => {
      const r = cli(`--rebaseline ${lawId}`);
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain(`기준 MST ${B.mst} → ${A.mst}`);
      expect(sql(`SELECT external_id FROM laws WHERE id='${lawId}';`)).toBe(B.mst);
    });

    it('--apply 는 등록 때 시행 중이던 앞 판으로 기준을 되돌린다 — 이벤트 없이, 조항 id 는 그대로, 다음 동기화 맨 앞', () => {
      const r = cli(`--rebaseline ${lawId} --apply`);
      expect(r.code, r.out).toBe(0);
      expect(sql(`SELECT external_id || '|' || coalesce(last_checked_at::text, 'null') FROM laws WHERE id='${lawId}';`)).toBe(`${A.mst}|null`);
      expect(sql(`SELECT mst || '|' || kind FROM law_versions WHERE law_id='${lawId}';`)).toBe(`${A.mst}|baseline`);
      expect(sql(`SELECT count(*) FROM law_change_events WHERE law_id='${lawId}';`)).toBe('0');
      expect(articleId('2')).toBe(vacationId);
      expect(sql(`SELECT content FROM law_articles WHERE id='${vacationId}';`)).toContain('2일');
      expect(sql(`SELECT deleted_at IS NOT NULL FROM law_articles WHERE law_id='${lawId}' AND article_no=3 AND clause_no IS NULL;`)).toBe('t');
    });

    it('다음 동기화가 묻혔던 판을 변경 이벤트로 남긴다', async () => {
      const r = await run(lawId);
      expect(r.outcome, JSON.stringify(r)).toBe('updated');
      expect(sql(`SELECT external_id FROM laws WHERE id='${lawId}';`)).toBe(B.mst);
      expect(sql(`SELECT string_agg(change_type::text, ',' ORDER BY node_key) FROM law_change_events WHERE law_id='${lawId}';`)).toBe('modified,created');
      expect(articleId('2')).toBe(vacationId);
    });

    it('이미 이벤트가 있으면 되돌리지 않는다(같은 판이 두 번 들어가지 않게)', () => {
      const r = cli(`--rebaseline ${lawId} --apply`);
      expect(r.code).toBe(1);
      expect(r.out).toContain('보정하지 않습니다');
      expect(sql(`SELECT external_id FROM laws WHERE id='${lawId}';`)).toBe(B.mst);
    });
  });
});

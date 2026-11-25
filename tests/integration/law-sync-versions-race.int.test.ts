import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, createTenant, waitForApi } from './helpers';
import { FakeLaw, requireRedis, type FakeVersion } from './lawgokr-seed';
import { brief, sleepTrigger, sql, waitForBlockedBy, waitForSleep } from './race';

/**
 * 판 반영과 겹치는 쓰기 — 실제 DB 의 차례 (T-151 검토 H1·H4). 가짜 법제처(lawgokr-seed)로 돈다.
 *
 * HTTP 두 개는 그냥 보내면 차례로 끝나 겹치지 않는다. 그래서 판 기록(law_versions)·법령 행(laws)을 넣을 때 잠시 멈추는 시험용
 * 트리거로 한쪽 트랜잭션을 세워 두고, 다른 쪽이 실제로 그 트랜잭션에 막힌 것(pg_blocking_pids)을 본 뒤 결과를 견준다.
 *
 * 막고 싶은 사고:
 * 1. 동기화가 법령 행을 뒤 판으로 옮기는 사이에(또는 옮긴 뒤에) 현행 판을 등록해 같은 법령의 둘째 행이 생긴다
 * 2. 겹친 두 동기화가 같은 판을 두 번 넣는다(판 기록·이벤트 중복) — 늦은 쪽은 경합으로 물러나야 한다
 * 3. 같은 법령의 서로 다른 판을 동시에 처음 등록해 두 행이 생긴다(판이 달라 MST 유일에 걸리지 않는다)
 */
const art = (no: string, title: string, body: string) => ({ no, title, body });

describe('T-151 판 반영과 겹치는 쓰기', () => {
  let pf: Awaited<ReturnType<typeof createTenant>>;
  const fakes: FakeLaw[] = [];
  const fake = (prefix: string) => {
    const f = new FakeLaw(prefix);
    fakes.push(f);
    return f;
  };
  const post = (path: string, json: unknown) => api(path, { method: 'POST', token: pf.token, json });
  const register = (mst: string) => post('/laws', { mst });
  const run = (lawId: string) => post('/platform-admin/law-sync/run', { lawId });
  const rowsOf = (law: FakeLaw) => sql(`SELECT id || '|' || external_id FROM laws WHERE external_law_id='${law.lawId}' ORDER BY created_at;`).split('\n').filter(Boolean);
  const versions = (lawId: string) =>
    sql(`SELECT mst || '|' || kind || '|' || coalesce(previous_mst,'-') || '|' || event_count FROM law_versions WHERE law_id='${lawId}' ORDER BY order_key NULLS FIRST, recorded_at;`)
      .split('\n')
      .filter(Boolean);
  const events = (lawId: string) => sql(`SELECT count(*) FROM law_change_events WHERE law_id='${lawId}';`);

  beforeAll(async () => {
    await waitForApi();
    pf = await createTenant('lawver-race');
    sql(`UPDATE users SET platform_role='global_admin' WHERE id='${pf.user.id}';`);
    requireRedis();
  }, 90_000);

  afterAll(() => {
    const keys = fakes.map((f) => `'${f.lawId}'`).join(',');
    if (keys) {
      const ids = `SELECT id FROM laws WHERE external_law_id IN (${keys})`;
      sql(`
        DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id IN (${ids}));
        UPDATE article_versions SET change_event_id = NULL WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id IN (${ids}));
        DELETE FROM laws WHERE id IN (${ids});
      `);
    }
    for (const f of fakes) f.cleanup();
  });

  it('판 반영 중에 현행 판을 등록하면 반영이 끝날 때까지 기다렸다가 그 행을 돌려준다 — 끝난 뒤 다시 등록해도 같다', async () => {
    const law = fake('겹친등록시험법');
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '901', effective: '20260201', articles: [art('1', '목적', 'a1'), art('2', '휴가', 'b1')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '902', effective: '20270101', articles: [art('1', '목적', 'a2'), art('2', '휴가', 'b1')] };
    law.seedAll([A, B], A); // 현행은 A, B 는 시행 예정
    const first = await register(A.mst);
    expect(first.status, brief(first)).toBe(200);
    const lawId: string = first.body.id;

    const drop = sleepTrigger('t151_ver', 'law_versions', 'BEFORE', 'INSERT', `NEW.mst = '${B.mst}'`, 3);
    try {
      const syncing = run(lawId);
      await waitForSleep('t151_ver'); // 동기화가 B 를 넣는 중 — 법령 행은 이미 B 로 옮겨 잠가 두었다
      const again = register(A.mst);
      await waitForBlockedBy('t151_ver'); // 등록이 그 법령 행에 실제로 막혔다
      const [s, r] = await Promise.all([syncing, again]);
      expect(s.status, brief(s)).toBe(200);
      expect(s.body.results[0]).toMatchObject({ outcome: 'updated', fromMst: A.mst, toMst: B.mst });
      expect(r.status, brief(r)).toBe(200);
      expect(r.body).toMatchObject({ id: lawId, externalId: B.mst, alreadyTracked: true });
    } finally {
      drop();
    }
    expect(rowsOf(law)).toEqual([`${lawId}|${B.mst}`]);
    expect(versions(lawId)).toEqual([`${A.mst}|baseline|-|0`, `${B.mst}|change|${A.mst}|1`]);

    // 겹치지 않아도 같다 — 옛 판으로 되돌리지 않고, 본문·이벤트도 그대로
    const later = await register(A.mst);
    expect(later.status, brief(later)).toBe(200);
    expect(later.body).toMatchObject({ id: lawId, externalId: B.mst, alreadyTracked: true });
    expect(rowsOf(law)).toEqual([`${lawId}|${B.mst}`]);
    expect(sql(`SELECT string_agg(content, ',' ORDER BY sort_order) FROM law_articles WHERE law_id='${lawId}' AND deleted_at IS NULL;`)).toBe('a2,b1');
    expect(events(lawId)).toBe('1');
  }, 60_000);

  it('겹친 두 동기화 — 늦은 쪽은 판을 넣지 못하고 경합으로 물러난다(판 기록·이벤트가 한 번씩)', async () => {
    const law = fake('겹친동기화시험법');
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '911', effective: '20260201', articles: [art('1', '목적', 'a1'), art('2', '휴가', 'b1')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '912', effective: '20260401', articles: [art('1', '목적', 'a2'), art('2', '휴가', 'b1')] };
    const C: FakeVersion = { mst: law.mst(3), promulgated: '20260510', promulgationNo: '913', effective: '20260601', articles: [art('1', '목적', 'a2'), art('2', '휴가', 'b2')] };
    law.seedAll([A, B, C]);
    const reg = await register(A.mst);
    expect(reg.status, brief(reg)).toBe(200);
    const lawId: string = reg.body.id;

    const drop = sleepTrigger('t151_ver', 'law_versions', 'BEFORE', 'INSERT', `NEW.mst = '${B.mst}'`, 3);
    try {
      const first = run(lawId);
      await waitForSleep('t151_ver');
      // 앞 실행이 "중단됨"으로 보일 만큼 오래된 것처럼 — 실제로 겹칠 수 있는 유일한 길(앞 실행이 30분을 넘긴 경우)
      // 이 시험의 실행만 — 공용 DB 에서 다른 세션의 실행을 "중단됨"으로 닫지 않게
      sql(`UPDATE law_sync_runs SET started_at = now() - interval '31 minutes' WHERE status='running' AND triggered_by='${pf.user.id}';`);
      const second = run(lawId);
      await waitForBlockedBy('t151_ver'); // 늦은 쪽이 같은 법령 행(A → B 바꾸기)에 막혔다
      const [f, s] = await Promise.all([first, second]);
      expect(f.status, brief(f)).toBe(200);
      expect(f.body.results[0]).toMatchObject({ outcome: 'updated', fromMst: A.mst, toMst: C.mst });
      expect(s.status, brief(s)).toBe(200);
      expect(s.body.results[0]).toMatchObject({ outcome: 'unchanged', fromMst: A.mst });
      expect(s.body.results[0].note).toContain('다른 경로가 먼저');
    } finally {
      drop();
    }
    expect(rowsOf(law)).toEqual([`${lawId}|${C.mst}`]);
    expect(versions(lawId)).toEqual([`${A.mst}|baseline|-|0`, `${B.mst}|change|${A.mst}|1`, `${C.mst}|change|${B.mst}|1`]);
    expect(events(lawId)).toBe('2');
  }, 60_000);

  it('같은 법령의 서로 다른 판을 동시에 처음 등록하면 늦은 쪽이 기다렸다가 먼저 만든 행을 돌려받는다', async () => {
    const law = fake('겹친첫등록시험법');
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '921', effective: '20260201', articles: [art('1', '목적', 'a1')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '922', effective: '20270101', articles: [art('1', '목적', 'a2')] };
    law.seedAll([A, B], A);

    const drop = sleepTrigger('t151_law', 'laws', 'BEFORE', 'INSERT', `NEW.external_law_id = '${law.lawId}'`, 3);
    try {
      const a = register(A.mst);
      await waitForSleep('t151_law'); // A 의 첫 등록이 법령 행을 넣는 중
      const b = register(B.mst);
      await waitForBlockedBy('t151_law'); // B 의 등록이 같은 법령ID 의 열쇠에 막혔다
      const [ra, rb] = await Promise.all([a, b]);
      expect(ra.status, brief(ra)).toBe(200);
      expect(rb.status, brief(rb)).toBe(200);
      expect(ra.body).toMatchObject({ externalId: A.mst, alreadyTracked: false });
      expect(rb.body).toMatchObject({ id: ra.body.id, externalId: A.mst, alreadyTracked: true });
    } finally {
      drop();
    }
    expect(rowsOf(law)).toHaveLength(1);
  }, 60_000);
});

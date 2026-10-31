import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';
import { FakeLaw, day, requireRedis, type FakeVersion } from './lawgokr-seed';

/**
 * 두 확인 사이에 공포된 판을 차례로 반영 (T-151, PAT-07 — 특허 도 7 S770).
 *
 * 법제처 없이 돈다 — 가짜 법령의 판 목록(법령ID)·판 본문을 캐시(Redis)에 심고(lawgokr-seed), 동기화를 그 법령만 돌린다.
 * 겹치는 쓰기(등록·동기화가 같은 법령 행을 다툼)는 law-sync-versions-race.int.test.ts 가 본다.
 *
 * 막고 싶은 사고:
 * 1. 가장 큰 판 하나로 건너뛰어 중간 판의 변경이 마지막 판의 공포일·시행일로 묶인다
 * 2. 가운데 판에서 실패했는데 건너뛰거나, 일부만 반영한 상태가 남아 다음 실행이 같은 판을 두 번 넣는다
 * 3. 판 기록·이벤트가 어긋나도(같은 판·같은 조항) DB 가 막지 않는다
 * 4. 판 목록이 이상한데(저장 판 없음·폐지) 짐작으로 이어 간다
 */
function sql(query: string): string {
  return execSync(`docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`, {
    encoding: 'utf8',
    input: query,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function cli(args: string): { code: number; out: string } {
  try {
    return { code: 0, out: execSync(`docker compose exec -T api node dist/laws/law-sync.cli.js ${args}`, { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const art = (no: string, title: string, body: string) => ({ no, title, body });

describe('T-151 판을 차례로 반영 (가짜 법제처)', () => {
  let pf: Awaited<ReturnType<typeof createTenant>>;
  const fakes: FakeLaw[] = [];
  const lawIds: string[] = [];

  const fake = (prefix: string) => {
    const f = new FakeLaw(prefix);
    fakes.push(f);
    return f;
  };
  const register = async (mst: string) => {
    const res = await api('/laws', { method: 'POST', token: pf.token, json: { mst } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    lawIds.push(res.body.id);
    return res.body.id as string;
  };
  const run = async (lawId: string) => {
    const res = await api('/platform-admin/law-sync/run', { method: 'POST', token: pf.token, json: { lawId } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.results).toHaveLength(1);
    return res.body.results[0];
  };
  const versions = (lawId: string) =>
    sql(`SELECT mst || '|' || kind || '|' || coalesce(previous_mst,'-') || '|' || event_count FROM law_versions WHERE law_id='${lawId}' ORDER BY order_key NULLS FIRST, recorded_at;`)
      .split('\n')
      .filter(Boolean);
  const externalId = (lawId: string) => sql(`SELECT external_id FROM laws WHERE id='${lawId}';`);

  beforeAll(async () => {
    await waitForApi();
    pf = await createTenant('lawver-pf');
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

  describe('판 셋을 차례로', () => {
    const law = new FakeLaw('판걷기시험법');
    fakes.push(law);
    // A(현행) → B(뒤에 공포, 시행은 12월·내년 6월 두 단계) → C(B 뒤에 공포, 시행은 B 보다 이른 9월)
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '101', effective: '20260201', articles: [art('1', '목적', 'a1'), art('2', '휴가', 'b1'), art('3', '보칙', 'c1')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '102', effective: '20261201', stages: ['20261201', '20270601'], articles: [art('1', '목적', 'a2'), art('2', '휴가', 'b1'), art('3', '보칙', 'c1')] };
    const C: FakeVersion = { mst: law.mst(3), promulgated: '20260510', promulgationNo: '103', effective: '20260901', revisionType: '타법개정', articles: [art('1', '목적', 'a2'), art('2', '휴가', 'b2'), art('3', '보칙', 'c1')] };
    let lawId = '';

    it('등록하면 그 판이 기준판 한 행으로 남고 이벤트는 없다', async () => {
      law.seedAll([A, B, C]);
      lawId = await register(A.mst);
      expect(versions(lawId)).toEqual([`${A.mst}|baseline|-|0`]);
      expect(sql(`SELECT count(*) FROM law_change_events WHERE law_id='${lawId}';`)).toBe('0');
    });

    it('동기화는 저장 판 뒤의 판을 공포 순으로 하나씩 — 이벤트마다 그 판의 공포일·시행일·판 연결, 법령은 마지막 판', async () => {
      const r = await run(lawId);
      expect(r).toMatchObject({ outcome: 'updated', fromMst: A.mst, toMst: C.mst, events: 2 });
      expect(r.versions.map((v: any) => [v.mst, v.events, v.stageEffectiveDates])).toEqual([
        [B.mst, 1, ['2026-12-01', '2027-06-01']],
        [C.mst, 1, ['2026-09-01']],
      ]);
      expect(versions(lawId)).toEqual([`${A.mst}|baseline|-|0`, `${B.mst}|change|${A.mst}|1`, `${C.mst}|change|${B.mst}|1`]);
      expect(sql(`SELECT stage_effective_dates::text FROM law_versions WHERE law_id='${lawId}' AND mst='${B.mst}';`)).toBe('{2026-12-01,2027-06-01}');
      // 이벤트: 제1조는 B 의 날짜, 제2조는 C 의 날짜 — 마지막 판 하나로 묶이지 않는다
      const ev = sql(`
        SELECT e.node_key || '|' || v.mst || '|' || e.promulgated_date || '|' || e.law_effective_date || '|' || e.received_via
        FROM law_change_events e JOIN law_versions v ON v.id = e.law_version_id WHERE e.law_id='${lawId}' ORDER BY e.detected_at, e.node_key;`).split('\n');
      expect(ev).toEqual([`1//|${B.mst}|${day(B.promulgated)}|${day(B.effective)}|poll`, `2//|${C.mst}|${day(C.promulgated)}|${day(C.effective)}|poll`]);
      expect(sql(`SELECT count(*) FROM law_change_events WHERE law_id='${lawId}' AND law_version_id IS NULL;`)).toBe('0');
      // 앞 판의 이벤트가 먼저 생긴다(판마다 커밋이 따로) — 후보·알림도 이 순서로 만든다
      expect(sql(`SELECT bool_and(b.detected_at < c.detected_at) FROM law_change_events b, law_change_events c WHERE b.law_id='${lawId}' AND c.law_id='${lawId}' AND b.node_key='1//' AND c.node_key='2//';`)).toBe('t');
      expect(externalId(lawId)).toBe(C.mst);
      expect(sql(`SELECT string_agg(content, ',' ORDER BY sort_order) FROM law_articles WHERE law_id='${lawId}' AND deleted_at IS NULL;`)).toBe('a2,b2,c1');
      expect(sql(`SELECT coalesce(last_check_error, 'none') || '|' || (now() - last_checked_at < interval '1 minute') FROM laws WHERE id='${lawId}';`)).toBe('none|true');
    });

    it('다시 돌리면 개정 없음 — 판·이벤트 수 그대로', async () => {
      const before = sql(`SELECT count(*) FROM law_change_events WHERE law_id='${lawId}';`);
      const r = await run(lawId);
      expect(r).toMatchObject({ outcome: 'unchanged', fromMst: C.mst });
      expect(versions(lawId)).toHaveLength(3);
      expect(sql(`SELECT count(*) FROM law_change_events WHERE law_id='${lawId}';`)).toBe(before);
    });

    it('같은 판·같은 조항의 이벤트는 DB 가 거부한다 — 판 기록이 특허의 "변경 전후 버전 조합"을 맡는다', () => {
      const versionId = sql(`SELECT id FROM law_versions WHERE law_id='${lawId}' AND mst='${B.mst}';`);
      expect(() =>
        sql(`INSERT INTO law_change_events (id, law_id, node_key, change_type, law_effective_date, received_via, law_version_id)
             VALUES ('${randomUUID()}', '${lawId}', '1//', 'modified', '2026-12-01', 'poll', '${versionId}');`),
      ).toThrow(/duplicate key|law_change_events_law_version_id_node_key_key/);
    });
  });

  it('가운데 판이 실패하면 그 앞까지 확정하고 멈춘다 — 실패 판을 건너뛰지 않고, 고쳐지면 거기서 잇는다', async () => {
    const law = fake('판실패시험법');
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '201', effective: '20260201', articles: [art('1', '목적', 'a1'), art('2', '휴가', 'b1')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '202', effective: '20260401', articles: [art('1', '목적', 'a2'), art('2', '휴가', 'b1')] };
    const C: FakeVersion = { mst: law.mst(3), promulgated: '20260510', promulgationNo: '203', effective: '20260601', articles: null }; // 조문 없는 본문
    const D: FakeVersion = { mst: law.mst(4), promulgated: '20260710', promulgationNo: '204', effective: '20260801', articles: [art('1', '목적', 'a2'), art('2', '휴가', 'b3')] };
    law.seedAll([A, B, C, D]);
    const lawId = await register(A.mst);

    const r = await run(lawId);
    expect(r).toMatchObject({ outcome: 'failed', fromMst: A.mst, toMst: B.mst, events: 1, remaining: 2 });
    expect(r.error).toContain(`MST ${C.mst} 반영 실패(${B.mst}까지 반영했습니다)`);
    expect(r.error).toContain('조문이 없어');
    expect(externalId(lawId)).toBe(B.mst);
    expect(versions(lawId)).toEqual([`${A.mst}|baseline|-|0`, `${B.mst}|change|${A.mst}|1`]); // C·D 는 기록도 이벤트도 없다
    expect(sql(`SELECT last_check_error FROM laws WHERE id='${lawId}';`)).toContain(`MST ${C.mst}`);

    // 법제처에 본문이 제대로 올라오면 다음 동기화가 C 부터 잇는다
    law.seedBody({ ...C, articles: [art('1', '목적', 'a2'), art('2', '휴가', 'b2')] });
    const again = await run(lawId);
    expect(again).toMatchObject({ outcome: 'updated', fromMst: B.mst, toMst: D.mst });
    expect(again.versions.map((v: any) => v.mst)).toEqual([C.mst, D.mst]);
    expect(versions(lawId)).toEqual([`${A.mst}|baseline|-|0`, `${B.mst}|change|${A.mst}|1`, `${C.mst}|change|${B.mst}|1`, `${D.mst}|change|${C.mst}|1`]);
    expect(sql(`SELECT coalesce(last_check_error,'none') FROM laws WHERE id='${lawId}';`)).toBe('none');
  });

  it('판 기록에 이미 있는 판이면(법령 행과 어긋남) 그 판을 통째로 되돌리고 실패로 남긴다', async () => {
    const law = fake('판중복시험법');
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '301', effective: '20260201', articles: [art('1', '목적', 'a1')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '302', effective: '20260401', articles: [art('1', '목적', 'a2')] };
    law.seedAll([A, B]);
    const lawId = await register(A.mst);
    sql(`INSERT INTO law_versions (id, law_id, mst, kind) VALUES ('${randomUUID()}', '${lawId}', '${B.mst}', 'change');`);

    const r = await run(lawId);
    expect(r.outcome).toBe('failed');
    expect(r.error).toContain(`판 기록에 MST ${B.mst}`);
    expect(externalId(lawId)).toBe(A.mst); // 법령 행 변경도 함께 되돌아갔다
    expect(sql(`SELECT count(*) FROM law_change_events WHERE law_id='${lawId}';`)).toBe('0');
    expect(sql(`SELECT content FROM law_articles WHERE law_id='${lawId}' AND node_key='1//';`)).toBe('a1');
  });

  it('저장 판을 판 목록에서 못 찾으면 아무것도 쓰지 않고 실패 — 짐작으로 이어 가지 않는다', async () => {
    const law = fake('판없음시험법');
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '401', effective: '20260201', articles: [art('1', '목적', 'a1')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '402', effective: '20260401', articles: [art('1', '목적', 'a2')] };
    law.seedAll([A, B]);
    const lawId = await register(A.mst);
    law.seedVersionList([B]); // 목록에서 저장 판(A)이 빠졌다

    const r = await run(lawId);
    expect(r).toMatchObject({ outcome: 'failed', fromMst: A.mst });
    expect(r.error).toContain(`저장된 판(MST ${A.mst})을 법제처 판 목록에서 찾지 못했습니다`);
    expect(externalId(lawId)).toBe(A.mst);
    expect(versions(lawId)).toEqual([`${A.mst}|baseline|-|0`]);
  });

  it('폐지 판 앞에서 멈추고 사람이 할 일을 남긴다', async () => {
    const law = fake('판폐지시험법');
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '501', effective: '20260201', articles: [art('1', '목적', 'a1')] };
    const R: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '502', effective: '20260310', revisionType: '폐지', articles: null };
    law.seedAll([A, R]);
    const lawId = await register(A.mst);

    const r = await run(lawId);
    expect(r).toMatchObject({ outcome: 'failed', fromMst: A.mst });
    expect(r.error).toContain(`폐지 판(MST ${R.mst})`);
    expect(r.error).toContain('추적 해제를 검토하세요');
    expect(externalId(lawId)).toBe(A.mst);
  });

  it('같은 사내 조문이 두 판에서 바뀌면 후보도 판마다 — 예정 시행일은 각 판의 것, 앞 판 후보가 먼저 생긴다', async () => {
    const law = fake('판후보시험법');
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '601', effective: '20260201', articles: [art('60', '연차휴가', '사용자는 근로자에게 15일의 유급휴가를 주어야 한다.')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '602', effective: '20301201', articles: [art('60', '연차휴가', '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.')] };
    const C: FakeVersion = { mst: law.mst(3), promulgated: '20260510', promulgationNo: '603', effective: '20310101', articles: [art('60', '연차휴가', '사용자는 근로자에게 25일의 유급휴가를 주어야 한다.')] };
    law.seedAll([A, B, C]);
    const lawId = await register(A.mst);

    // 회사 조문 — 법령 시행일 전부터 시행 중인 판, 그 법령조항에 확정 연결
    const { article } = await createPolicyWithArticle(pf.token, `VER-${Date.now().toString(36)}`, '취업규칙');
    sql(`DELETE FROM article_versions WHERE article_id='${article.id}';
         INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at)
           VALUES ('${randomUUID()}', '${article.id}', 1, '직원에게는 매년 15일의 연차휴가를 준다.', 'published', '2020-01-01', now());`);
    const lawArticleId = sql(`SELECT id FROM law_articles WHERE law_id='${lawId}' AND node_key='60//';`);
    const link = await api('/law-links', { method: 'POST', token: pf.token, json: { lawArticleId, articleId: article.id, relationType: 'delegation', evidenceText: '연차휴가 일수' } });
    expect(link.status, JSON.stringify(link.body)).toBe(201);

    const r = await run(lawId); // 실행 끝에 후보를 자동으로 만든다
    expect(r).toMatchObject({ outcome: 'updated', toMst: C.mst, events: 2 });
    const cands = sql(`
      SELECT v.mst || '|' || c.planned_effective_date FROM amendment_candidates c
      JOIN law_change_events e ON e.id = c.change_event_id JOIN law_versions v ON v.id = e.law_version_id
      WHERE c.tenant_id=(SELECT tenant_id FROM users WHERE id='${pf.user.id}') AND e.law_id='${lawId}' ORDER BY c.created_at;`).split('\n');
    expect(cands).toEqual([`${B.mst}|2030-12-01`, `${C.mst}|2031-01-01`]);
  }, 90_000);

  it('CLI --plan 은 아무것도 쓰지 않고 반영할 판을 공포 순으로 찍는다', async () => {
    const law = fake('판계획시험법');
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '701', effective: '20260201', articles: [art('1', '목적', 'a1')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '702', effective: '20261201', stages: ['20261201', '20270601'], articles: [art('1', '목적', 'a2')] };
    law.seedAll([A, B]);
    const lawId = await register(A.mst);
    const out = cli(`--plan --law ${lawId}`);
    expect(out.code, out.out).toBe(0);
    expect(out.out).toContain(`저장 MST ${A.mst}`);
    expect(out.out).toContain('반영할 판 1개');
    expect(out.out).toContain('제702호(2026-03-10 공포)[일부개정 · 시행 2026-12-01, 2027-06-01]');
    expect(externalId(lawId)).toBe(A.mst);
    expect(versions(lawId)).toEqual([`${A.mst}|baseline|-|0`]);
  }, 90_000);

  it('법령을 지우면 판 기록과 이벤트가 함께 지워진다(이벤트 → 판 NO ACTION 이 막지 않는다)', async () => {
    const law = fake('판삭제시험법');
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '801', effective: '20260201', articles: [art('1', '목적', 'a1')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '802', effective: '20260401', articles: [art('1', '목적', 'a2')] };
    law.seedAll([A, B]);
    const lawId = await register(A.mst);
    await run(lawId);
    expect(sql(`SELECT count(*) FROM law_change_events WHERE law_id='${lawId}' AND law_version_id IS NOT NULL;`)).toBe('1');
    sql(`DELETE FROM laws WHERE id='${lawId}';`);
    expect(sql(`SELECT (SELECT count(*) FROM law_versions WHERE law_id='${lawId}') + (SELECT count(*) FROM law_change_events WHERE law_id='${lawId}');`)).toBe('0');
  });
});

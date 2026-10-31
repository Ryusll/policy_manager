import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, createTenant, waitForApi } from './helpers';
import { FakeLaw, requireRedis, type FakeVersion } from './lawgokr-seed';
import { sql } from './race';

/**
 * 법령ID 가 없을 때 (T-151 검토) — 가짜 법제처(lawgokr-seed, Redis 캐시 심기)로 돈다.
 *
 * 막고 싶은 사고:
 * 1. 본문에 법령ID 가 빠진 응답으로 새 행을 만들어, 같은 법령의 둘째 행(동기화가 판 목록을 찾지 못하는 행)이 생긴다
 * 2. 법령ID 없이 등록된 옛 행을 짐작으로 채워, 같은 법령의 옛 중복이 있을 때 멈춘 행을 만들거나 등록이 그 행을 돌려받는다
 *    — 동기화는 실패로 알리고(런북 7-5 점검·T-154 정리), 같은 판 다시 등록은 법령ID 를 채우되 같은 법령의 다른 행이 있으면(옛 중복) 409
 */
const art = (no: string, title: string, body: string) => ({ no, title, body });

describe('T-151 법령ID 가 없는 법령', () => {
  let pf: Awaited<ReturnType<typeof createTenant>>;
  const fakes: FakeLaw[] = [];
  const fake = (prefix: string) => {
    const f = new FakeLaw(prefix);
    fakes.push(f);
    return f;
  };
  const register = async (mst: string) => {
    const res = await api('/laws', { method: 'POST', token: pf.token, json: { mst } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.id as string;
  };
  const run = async (lawId: string) => {
    const res = await api('/platform-admin/law-sync/run', { method: 'POST', token: pf.token, json: { lawId } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.results[0];
  };

  beforeAll(async () => {
    await waitForApi();
    pf = await createTenant('lawid-pf');
    sql(`UPDATE users SET platform_role='global_admin' WHERE id='${pf.user.id}';`);
    requireRedis();
  }, 90_000);

  afterAll(() => {
    // 법령ID 가 비어 있는 채로 남은 행도 지우게 MST 로도 찾는다
    const ids = fakes.map((f) => `'${f.lawId}'`).join(',');
    const msts = fakes.flatMap((f) => [1, 2, 3].map((n) => `'${f.mst(n)}'`)).join(',');
    if (ids) {
      const laws = `SELECT id FROM laws WHERE external_law_id IN (${ids}) OR external_id IN (${msts})`;
      sql(`
        DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id IN (${laws}));
        DELETE FROM laws WHERE id IN (${laws});
      `);
    }
    for (const f of fakes) f.cleanup();
  });

  it('본문에 법령ID 가 빠진 응답으로는 새로 등록하지 않는다(502) — 같은 판 다시 등록은 받고 저장된 법령ID 를 지우지 않는다', async () => {
    const law = fake('판법령ID없음시험법');
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '851', effective: '20260201', articles: [art('1', '목적', 'a1')] };
    law.seedBody(A, { noLawId: true });
    const refused = await api('/laws', { method: 'POST', token: pf.token, json: { mst: A.mst } });
    expect(refused.status, JSON.stringify(refused.body)).toBe(502);
    expect(String(refused.body.message)).toContain('법령ID가 없어 새로 등록하지 않았습니다');
    expect(sql(`SELECT count(*) FROM laws WHERE external_id='${A.mst}';`)).toBe('0');

    law.seedBody(A);
    const lawId = await register(A.mst);
    law.seedBody(A, { noLawId: true });
    const again = await api('/laws', { method: 'POST', token: pf.token, json: { mst: A.mst } });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body).toMatchObject({ id: lawId, alreadyTracked: false });
    expect(sql(`SELECT external_law_id FROM laws WHERE id='${lawId}';`)).toBe(law.lawId);
  });

  it('법령ID 없는 옛 행은 동기화하지 않고 실패로 남긴다(짐작으로 채우지 않는다) — 같은 판으로 다시 등록하면 채워지고 다음 동기화가 판을 걷는다', async () => {
    const law = fake('법령ID채우기시험법');
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '861', effective: '20260201', articles: [art('1', '목적', 'a1')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '862', effective: '20260401', articles: [art('1', '목적', 'a2')] };
    law.seedAll([A, B]);
    const lawId = await register(A.mst);
    sql(`UPDATE laws SET external_law_id = NULL WHERE id='${lawId}';`); // 법령ID 없이 등록된 옛 행

    const refused = await run(lawId);
    expect(refused).toMatchObject({ outcome: 'failed', fromMst: A.mst });
    expect(refused.error).toBe('법령ID 가 없는 옛 법령이라 자동으로 확인할 수 없습니다 — 아스트룸에 문의하세요.'); // 고객 화면에도 보이는 문구
    expect(sql(`SELECT coalesce(external_law_id, 'null') || '|' || external_id FROM laws WHERE id='${lawId}';`)).toBe(`null|${A.mst}`);

    expect(await register(A.mst)).toBe(lawId); // 같은 판 다시 등록 — 본문의 법령ID 를 채운다
    expect(sql(`SELECT external_law_id FROM laws WHERE id='${lawId}';`)).toBe(law.lawId);
    const r = await run(lawId);
    expect(r).toMatchObject({ outcome: 'updated', fromMst: A.mst, toMst: B.mst, events: 1 });
    expect(sql(`SELECT count(*) FROM laws WHERE external_law_id='${law.lawId}';`)).toBe('1');
  });

  it('옛 중복(법령ID 없는 옛 행 + 같은 법령의 정상 행) — 옛 행의 같은 판 다시 등록은 409(어느 행인지 짐작하지 않음), 다른 판 등록은 정상 행', async () => {
    const law = fake('법령ID중복시험법');
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '871', effective: '20260201', articles: [art('1', '목적', 'a1')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '872', effective: '20260401', articles: [art('1', '목적', 'a2')] };
    const C: FakeVersion = { mst: law.mst(3), promulgated: '20260510', promulgationNo: '873', effective: '20260601', articles: [art('1', '목적', 'a3')] };
    law.seedAll([A, B, C]);
    const stale = await register(A.mst);
    sql(`UPDATE laws SET external_law_id = NULL WHERE id='${stale}';`); // 법령ID 없는 옛 행(판 A)
    const fresh = await register(B.mst); // 옛 행을 법령ID 로 찾지 못해 생긴 둘째 행(판 B) — 이미 쌓인 옛 중복
    expect(fresh).not.toBe(stale);

    expect((await run(stale)).error).toContain('자동으로 확인할 수 없습니다'); // 동기화는 채우지 않고 실패로 알린다
    const reg = await api('/laws', { method: 'POST', token: pf.token, json: { mst: A.mst } });
    expect(reg.status, JSON.stringify(reg.body)).toBe(409); // MST 로 옛 행, 법령ID 로 정상 행 — 같은 법령의 두 행
    expect(String(reg.body.message)).toContain('여러 행으로 등록돼 있어(옛 중복)');
    // 옛 행은 건드리지 않는다 — 법령ID 를 쓰지 않고, 확인 실패도 지우지 않는다(정리는 T-154)
    expect(sql(`SELECT coalesce(external_law_id, 'null') || '|' || coalesce(last_check_error, 'none') FROM laws WHERE id='${stale}';`)).toContain('null|법령ID 가 없는 옛 법령');

    const again = await api('/laws', { method: 'POST', token: pf.token, json: { mst: C.mst } });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body).toMatchObject({ id: fresh, alreadyTracked: true }); // 옛 행이 아니라 정상 행
  });
});

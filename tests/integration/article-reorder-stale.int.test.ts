import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, login, waitForApi } from './helpers';
import { brief, sleepTrigger, waitForBlockedBy, waitForSleep } from './race';

/**
 * T-225 — 조 순서 저장의 비교 후 교체. 조 순서 저장은 옮기기 전의 (조 번호·가지 번호)만 보내므로, 두 사람이 같은 순서로 창을 열고
 * 한쪽이 먼저 저장하면 늦게 온 저장이 옛 번호로 엉뚱한 조에 적용됐다(번호 묶음이 같아 빠진 조 검사를 지난다). 이제 창을 연 때의 배치
 * 지문(basedOn)을 함께 보내고, 서버는 규정을 잠근 뒤 지금 행으로 다시 만든 지문과 다르면 409(code POLICY_JO_ORDER_STALE)로 거절한다.
 * 지문이 없으면(배포 전에 연 옛 화면) 견줄 수 없어 400(code POLICY_JO_ORDER_BASIS_REQUIRED).
 */
const STALE = 'POLICY_JO_ORDER_STALE';
const BASIS_REQUIRED = 'POLICY_JO_ORDER_BASIS_REQUIRED';
type JoOrder = { order: { chapterId: string; jo: number; branch?: number }[]; basedOn: string };

describe('조 순서 저장 — 창을 연 뒤에 바뀐 배치 (T-225)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let policyId: string;
  let ch1: string;
  let ch2: string;

  /** 제1장에 제1·2조(제2조엔 항 2개), 제2장에 제3조 */
  async function seed() {
    const policy = await api('/policies', { method: 'POST', token: t.token, json: { code: `ROS-${Date.now().toString(36)}`, title: '재정렬 겹침 점검' } });
    policyId = policy.body.id;
    const chapter = async (number: number, title: string) =>
      (await api(`/policies/${policyId}/chapters`, { method: 'POST', token: t.token, json: { number, title } })).body.id as string;
    ch1 = await chapter(1, '총칙');
    ch2 = await chapter(2, '운영');
    const add = (chapterId: string, body: unknown) => api(`/policies/${policyId}/chapters/${chapterId}/articles`, { method: 'POST', token: t.token, json: body });
    await add(ch1, { number: 1, title: '목적', content: '제1조 본문' });
    await add(ch1, { number: 2, title: '적용범위', content: '제2조 본문' });
    await add(ch1, { number: 2, title: '', clauseNumber: 1, content: '제2조 제1항' });
    await add(ch1, { number: 2, title: '', clauseNumber: 2, content: '제2조 제2항' });
    await add(ch2, { number: 3, title: '운영원칙', content: '제3조 본문' });
  }
  const joOrder = async () => (await api(`/policies/${policyId}/jo-order`, { token: t.token })).body as JoOrder;
  const put = (json: unknown, token = t.token) => api(`/policies/${policyId}/jo-order`, { method: 'PUT', token, json });
  /** 행마다 id@장/조 번호 — 어느 행이 몇 번에 붙었는지 */
  const layout = async () => {
    const { body } = await api(`/policies/${policyId}`, { token: t.token });
    return (body.chapters as { id: string; articles: { id: string; number: number }[] }[]).flatMap((c) => c.articles.map((a) => `${a.id}@${c.id}/${a.number}`)).sort();
  };
  const reversed = (o: JoOrder) => [...o.order].reverse();

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('reorder-stale');
    await seed();
  });

  it('GET :id 의 current.joOrderBasis 와 GET :id/jo-order 의 basedOn 은 같은 지문이다', async () => {
    const detail = (await api(`/policies/${policyId}`, { token: t.token })).body;
    const { basedOn } = await joOrder();
    expect(basedOn).toMatch(/^[0-9a-f]{64}$/);
    expect(detail.current.joOrderBasis).toBe(basedOn);
  });

  it('창을 연 뒤에 다른 저장이 순서를 바꿨으면 옛 지문으로 보낸 저장은 409(code) — 배치는 앞 저장 그대로', async () => {
    const opened = await joOrder();
    const first = await put({ order: reversed(opened), basedOn: opened.basedOn });
    expect(first.status, brief(first)).toBe(200);
    const afterFirst = await layout();
    const late = await put({ order: reversed(opened), basedOn: opened.basedOn }); // 같은 옛 화면에서 보낸 저장
    expect(late.status, brief(late)).toBe(409);
    expect(late.body.code).toBe(STALE);
    expect(late.body.message).toContain('창을 연 뒤에');
    expect(await layout()).toEqual(afterFirst);
  });

  it('새 지문으로 다시 보내면 반영된다 — 화면이 싣는 GET :id 의 current.joOrderBasis 로', async () => {
    const now = await joOrder();
    const detail = (await api(`/policies/${policyId}`, { token: t.token })).body;
    expect(detail.current.joOrderBasis).toBe(now.basedOn);
    const r = await put({ order: reversed(now), basedOn: detail.current.joOrderBasis });
    expect(r.status, brief(r)).toBe(200);
    expect(r.body.changed).toBeGreaterThan(0);
  });

  it('지문이 없거나 null 이면 견주지 않고 적용하지 않는다 — 400(code)과 새로 고치라는 문구, 배치 그대로(배포 전에 연 옛 화면)', async () => {
    const now = await joOrder();
    const before = await layout();
    for (const json of [{ order: reversed(now) }, { order: reversed(now), basedOn: null }]) {
      const r = await put(json);
      expect(r.status, brief(r)).toBe(400);
      expect(r.body.code).toBe(BASIS_REQUIRED);
      expect(r.body.message).toMatch(/화면을 새로 고친 뒤 다시 옮기세요\.$/);
    }
    expect(await layout()).toEqual(before);
  });

  it("바뀐 것 없는 차례라도 지문이 낡았으면 409 — '바뀐 것 없음'·계획보다 먼저 견준다", async () => {
    const opened = await joOrder();
    expect((await put({ order: reversed(opened), basedOn: opened.basedOn })).status).toBe(200); // 다른 저장
    const now = await joOrder();
    const r = await put({ order: now.order, basedOn: opened.basedOn }); // 지금 차례 그대로 + 낡은 지문
    expect(r.status, brief(r)).toBe(409);
    expect(r.body.code).toBe(STALE);
  });

  it('지문 형식이 틀리면 400', async () => {
    const now = await joOrder();
    for (const basedOn of ['abc', 'g'.repeat(64), 'A'.repeat(64), 123]) {
      const r = await put({ order: now.order, basedOn });
      expect(r.status, `${String(basedOn)}: ${brief(r)}`).toBe(400);
    }
  });

  it('열람자는 403, 남의 회사는 404 — 낡은 지문을 실어도 지문 판정(409)이 권한·소속을 앞지르지 않는다(규정이 있는지 알리지 않게)', async () => {
    const now = await joOrder();
    const email = `viewer-${t.slug}@example.test`;
    await api('/users', { method: 'POST', token: t.token, json: { email, password: t.password, name: '뷰어', role: 'viewer' } });
    const viewer = await login(email, t.password, t.slug);
    const old = 'f'.repeat(64); // 지금 배치와 다른 지문 — 소속 확인이 늦으면 409 가 난다
    const byViewer = await put({ order: now.order, basedOn: old }, viewer.body.accessToken);
    expect(byViewer.status, brief(byViewer)).toBe(403);
    expect(byViewer.body.code).toBeUndefined();
    const other = await createTenant('reorder-stale-other');
    const byOther = await put({ order: now.order, basedOn: old }, other.token);
    expect(byOther.status, brief(byOther)).toBe(404);
    expect(byOther.body.code).toBeUndefined();
  });

  it('두 저장이 겹치면 먼저 잠근 쪽만 반영되고, 뒤 저장은 잠금이 풀린 뒤 지금 행으로 견줘 409', async () => {
    const opened = await joOrder();
    const detail = (await api(`/policies/${policyId}`, { token: t.token })).body;
    // 먼저 잠근 저장이 고치는 행 하나(뒤집은 차례에서 번호가 바뀌는 조) — 그 행을 고칠 때 멈춰 잠금을 쥔 채로 둔다
    const order = reversed(opened);
    const moved = order.find((target, i) => target.jo !== i + 1);
    const row = (detail.chapters as { articles: { id: string; number: number }[] }[]).flatMap((c) => c.articles).find((a) => a.number === moved?.jo);
    expect(row).toBeTruthy();
    const drop = sleepTrigger('t225stale', 'articles', 'BEFORE', 'UPDATE', `NEW.id = '${row!.id}'`, 2);
    try {
      const first = put({ order, basedOn: opened.basedOn });
      await waitForSleep('t225stale');
      const second = put({ order, basedOn: opened.basedOn }); // 같은 옛 화면의 저장 — 규정 잠금에서 기다린다
      await waitForBlockedBy('t225stale');
      const [a, b] = await Promise.all([first, second]);
      expect(a.status, brief(a)).toBe(200);
      expect(b.status, brief(b)).toBe(409);
      expect(b.body.code).toBe(STALE);
    } finally {
      drop();
    }
  });

  it('다른 사람이 조를 더한 뒤 옛 지문으로 보내면 400(빠진 조)이 아니라 409 — 지문을 계획보다 먼저 본다', async () => {
    const opened = await joOrder();
    const added = await api(`/policies/${policyId}/chapters/${ch2}/articles`, { method: 'POST', token: t.token, json: { number: 9, title: '신설', content: '제9조 본문' } });
    expect(added.status, brief(added)).toBe(201);
    const r = await put({ order: reversed(opened), basedOn: opened.basedOn }); // 새 조가 빠진 옛 차례
    expect(r.status, brief(r)).toBe(409);
    expect(r.body.code).toBe(STALE);
    // 조를 더한 뒤에도 화면이 싣는 지문(GET :id)과 시작점의 지문은 같다
    const detail = (await api(`/policies/${policyId}`, { token: t.token })).body;
    expect(detail.current.joOrderBasis).toBe((await joOrder()).basedOn);
  });

  it('장 번호가 바뀐 뒤 옛 지문으로 보내면 409 — 조문 행은 그대로라도 창이 본 적 없는 장 차례로 번호가 매겨지지 않게', async () => {
    const opened = await joOrder();
    const before = await layout();
    const moved = await api(`/policies/${policyId}/chapters/${ch1}`, { method: 'PUT', token: t.token, json: { number: 5 } }); // 제1장을 뒤로
    expect(moved.status, brief(moved)).toBe(200);
    expect(await layout()).toEqual(before); // 조문 행(장·번호)은 그대로
    const now = await joOrder();
    expect(now.basedOn).not.toBe(opened.basedOn);
    expect((await api(`/policies/${policyId}`, { token: t.token })).body.current.joOrderBasis).toBe(now.basedOn); // 화면이 싣는 지문도 같이 바뀐다
    const r = await put({ order: reversed(opened), basedOn: opened.basedOn });
    expect(r.status, brief(r)).toBe(409);
    expect(r.body.code).toBe(STALE);
    expect(await layout()).toEqual(before);
  });
});

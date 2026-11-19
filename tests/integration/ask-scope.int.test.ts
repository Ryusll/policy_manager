import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, enableAsk, waitForApi } from './helpers';
import { sql } from './race';

/**
 * T-219 질문 범위 선택(SRS SEARCH-11).
 *
 * 지키는 것: 고른 규정 안에서만 조문을 찾고 AI 에 준다(살펴본 조문·근거가 범위 밖에서 나오지 않는다), 그 회사의 활성 규정이
 * 아닌 것이 섞이면 구분 없이 같은 400(응답 본문도 같고, 기록 행도 한도 차감도 없다), 확인 차례는 꺼짐·고지(403) → 범위(400),
 * 범위 안에 시행 중 조문이 없으면 AI 를 부르지 않는다, 고른 범위는 물은 때의 이름 그대로 응답과 지난 질문에 남는다.
 * 값 검증과 기록에 남긴 범위 읽기는 늘 돈다. 범위 확인·꺼짐 먼저·범위 안 조문 없음은 AI 를 부르지 않아 제공사가 설정돼 있기만
 * 하면 돈다(없으면 POST /ask 가 503). 실제로 답을 받는 시험만 모의 AI(`AI_QA_PROVIDER=mock`)가 있어야 한다.
 */
describe('질문 범위 선택 (T-219)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let other: Awaited<ReturnType<typeof createTenant>>;
  let mock = false;
  let configured = false;
  const id: Record<string, string> = {};
  const code: Record<string, string> = {};

  const ask = (json: Record<string, unknown>, token = t.token) => api('/ask', { method: 'POST', token, json });
  const used = async () => (await api('/ask/status', { token: t.token })).body.used as number;
  const logs = () => Number(sql(`SELECT count(*) FROM ai_qa_logs l JOIN tenants x ON x.id = l.tenant_id WHERE x.slug = '${t.slug}'`));
  const policyIds = (body: any) => [...new Set([...body.consulted, ...body.citations].map((c: any) => c.policyId))].sort();

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('askscope');
    const st = (await api('/ask/status', { token: t.token })).body;
    mock = st.provider === 'mock';
    configured = st.configured === true;
    await enableAsk(t.token);
    // '경조금 출장비' 로 물으면 두 규정의 제2조가 모두 후보가 된다(모의 AI 는 목차 줄의 낱말로 고르고 첫 근거만 댄다)
    const make = async (key: string, title: string, articleTitle: string, content: string, publish = true) => {
      code[key] = `${key.toUpperCase()}-${Date.now().toString(36)}`;
      const set = await createPolicyWithArticle(t.token, code[key], title);
      await api(`/policies/${set.policy.id}/chapters/${set.chapter.id}/articles`, {
        method: 'POST',
        token: t.token,
        json: { number: 2, title: articleTitle, content },
      });
      if (publish) {
        const pub = await api(`/policies/${set.policy.id}/publish-drafts`, {
          method: 'POST',
          token: t.token,
          json: { changeNote: '제정', effectiveDate: '2024-01-01' },
        });
        expect(pub.status).toBeLessThan(300);
      }
      return set.policy.id as string;
    };
    id.welfare = await make('wel', '복리후생규정', '경조금', '직원 본인이 결혼하면 경조금 50만원을 지급한다.');
    id.travel = await make('trv', '여비규정', '출장비', '출장비는 실비로 지급하고 7일 안에 정산한다.');
    id.draft = await make('drf', '준비중규정', '초안', '아직 시행 전인 문구.', false);
    id.inactive = await make('off', '폐지예정규정', '경조금', '쓰지 않는 규정의 경조금 문구.');
    sql(`UPDATE policies SET is_active = false WHERE id = '${id.inactive}'`);
    other = await createTenant('askscope2');
    id.foreign = (await createPolicyWithArticle(other.token, `FOR-${Date.now().toString(36)}`, '남의회사규정')).policy.id;
  });

  it('범위 값이 잘못되면 400 — uuid 아님·같은 규정 두 번·100개 넘음·배열 아님', async () => {
    const before = logs();
    for (const policyIds of [['nope'], [id.welfare, id.welfare], Array.from({ length: 101 }, () => randomUUID()), 'x']) {
      expect((await ask({ question: '경조금 규정', policyIds })).status).toBe(400);
    }
    expect(logs()).toBe(before);
  });

  it('그 회사의 활성 규정이 아닌 것이 섞이면 같은 400 — 응답 본문까지 같고, 기록도 한도 차감도 없다', async (ctx) => {
    if (!configured) ctx.skip();
    const before = { used: await used(), logs: logs() };
    const bodies: unknown[] = [];
    for (const bad of [id.inactive, id.foreign, randomUUID()]) {
      const r = await ask({ question: '경조금 규정', policyIds: [id.welfare, bad] });
      expect(r.status, bad).toBe(400);
      expect(r.body.code, bad).toBe('AI_QA_SCOPE_INVALID');
      bodies.push(r.body);
    }
    // 무엇이 있는지 알려 주지 않는다 — 비활성·다른 회사·없는 규정이 같은 답이다
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(JSON.stringify(bodies)).not.toContain('남의회사규정');
    expect({ used: await used(), logs: logs() }).toEqual(before);
  });

  it('꺼진 회사는 범위가 틀려도 꺼짐(403)이 먼저다 — 범위가 있는지도 알려 주지 않는다', async (ctx) => {
    if (!configured) ctx.skip();
    const r = await ask({ question: '경조금 규정', policyIds: [id.welfare] }, other.token);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('AI_QA_DISABLED');
  });

  it('범위 안에 시행 중인 조문이 없으면 AI 를 부르지 않고 한도에서 돌려준다 — 응답에 고른 범위', async (ctx) => {
    if (!configured) ctx.skip();
    const before = await used();
    const r = await ask({ question: '초안 규정', policyIds: [id.draft] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ answerable: false, reason: 'no_regulations' });
    expect(r.body.scope).toEqual([{ id: id.draft, title: '준비중규정', code: code.drf }]);
    expect(await used()).toBe(before);
  });

  it('범위 없이 물으면 회사 전체에서 찾는다', async (ctx) => {
    if (!mock) ctx.skip();
    const r = await ask({ question: '경조금 출장비' });
    expect(r.status).toBe(200);
    expect(r.body.scope).toEqual([]);
    expect(policyIds(r.body)).toEqual([id.travel, id.welfare].sort());
  });

  it('고른 규정 안에서만 조문을 찾고 근거를 대며, 한도에는 한 번 센다', async (ctx) => {
    if (!mock) ctx.skip();
    const before = await used();
    const travel = await ask({ question: '경조금 출장비', policyIds: [id.travel] });
    expect(travel.status).toBe(200);
    expect(policyIds(travel.body)).toEqual([id.travel]);
    expect(travel.body.scope).toEqual([{ id: id.travel, title: '여비규정', code: code.trv }]);
    expect(await used()).toBe(before + 1);
    const welfare = await ask({ question: '경조금 출장비', policyIds: [id.welfare] });
    expect(policyIds(welfare.body)).toEqual([id.welfare]);
    expect(welfare.body.answerable).toBe(true);
    expect(welfare.body.citations[0].content).toContain('50만원');
  });

  it('고른 범위는 물은 때 이름 그대로 지난 질문에 남는다 — 그 뒤 규정 이름을 바꿔도', async (ctx) => {
    if (!mock) ctx.skip();
    const question = `출장비 정산 ${Date.now().toString(36)}`;
    expect((await ask({ question, policyIds: [id.travel] })).status).toBe(200);
    sql(`UPDATE policies SET title = '여비지급규정' WHERE id = '${id.travel}'`);
    const list = (await api('/ask/history', { token: t.token })).body.items;
    const scoped = list.find((i: any) => i.question === question);
    expect(scoped, '방금 물은 질문이 목록에 있다').toBeTruthy();
    expect(scoped).not.toHaveProperty('scope'); // 목록에는 싣지 않는다 — 다시 보기에만
    const d = await api(`/ask/history/${scoped.id}`, { token: t.token });
    expect(d.body.scope).toEqual([{ id: id.travel, title: '여비규정', code: code.trv }]);
  });

  it('기록에 남긴 범위를 지난 질문이 그대로 읽는다(모의 AI 없이 — 기록 행을 심는다)', async () => {
    const tenant = sql(`SELECT id FROM tenants WHERE slug = '${t.slug}'`);
    const user = sql(`SELECT id FROM users WHERE email = '${t.email}'`);
    const row = randomUUID();
    const scope = JSON.stringify([{ id: id.welfare, title: '그때이름', code: 'OLD-1' }]);
    sql(`INSERT INTO ai_qa_logs (id, tenant_id, user_id, question, answerable, cited_article_ids, ai_called, reason, citations, law_citations, consulted, scope)
         VALUES ('${row}', '${tenant}', '${user}', '심은 범위 질문', false, '{}', false, 'no_regulations', '[]', '[]', '[]', '${scope}');`);
    const list = (await api('/ask/history', { token: t.token })).body.items;
    expect(list.map((i: any) => i.id)).toContain(row);
    expect((await api(`/ask/history/${row}`, { token: t.token })).body.scope).toEqual([{ id: id.welfare, title: '그때이름', code: 'OLD-1' }]);
  });
});

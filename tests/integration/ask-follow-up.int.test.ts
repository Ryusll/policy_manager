import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, enableAsk, login, waitForApi } from './helpers';
import { sql } from './race';

/**
 * T-220 이어서 묻기(SRS SEARCH-12).
 *
 * 지키는 것: 앞 질문(부모)은 본인·같은 회사·보관 기간 안·답을 냈고 근거를 남긴 기록만 — 아니면 구분 없이 같은 400(응답 본문도
 * 같고 기록도 한도 차감도 없다), 꺼진 회사는 부모가 틀려도 403 이 먼저, 이어 물으면 앞 답의 근거 조문이 **지금** 든 조를 이번
 * 후보로 이어받는다(낱말이 없는 질문도 찾는다 — 조 번호가 바뀌어도 같은 조문, 이번 범위 밖이면 이어받지 않는다), 앞 질문·답의
 * 글은 보내지 않는다, 한도는 한 번, 응답에 기록 id·parentId, 지난 질문 목록에 parentId·다시 보기에 앞 질문(지워졌으면 null).
 * 값 검증은 늘, 부모 거절·꺼짐 차례는 제공사만 있으면, 실제로 답을 받는 시험은 모의 AI(`AI_QA_PROVIDER=mock`)가 있어야 돈다.
 */
describe('이어서 묻기 (T-220)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let other: Awaited<ReturnType<typeof createTenant>>;
  let mock = false;
  let configured = false;
  let asker = '';
  const id: Record<string, string> = {};
  const parent: { id: string; question: string } = { id: '', question: '' };

  const ask = (json: Record<string, unknown>, token = asker) => api('/ask', { method: 'POST', token, json });
  const used = async () => (await api('/ask/status', { token: asker })).body.userUsed as number;
  const logs = () => Number(sql(`SELECT count(*) FROM ai_qa_logs l JOIN tenants x ON x.id = l.tenant_id WHERE x.slug = '${t.slug}'`));
  const policyIds = (body: any) => [...new Set(body.consulted.map((c: any) => c.policyId))];
  const tenantId = (slug: string) => sql(`SELECT id FROM tenants WHERE slug = '${slug}'`);
  const userId = (email: string) => sql(`SELECT id FROM users WHERE email = '${email}'`);
  /** 기록 한 행을 바로 심는다 — 부모로 쓸 수 없는 경우들 */
  const seed = (tenant: string, user: string, o: { answerable: boolean; citations: string | null; daysAgo?: number }) => {
    const row = randomUUID();
    const citations = o.citations === null ? 'NULL' : `'${o.citations}'`;
    sql(`INSERT INTO ai_qa_logs (id, tenant_id, user_id, question, answerable, cited_article_ids, ai_called, citations, law_citations, consulted, created_at)
         VALUES ('${row}', '${tenant}', '${user}', '심은 앞 질문', ${o.answerable}, '{}', true, ${citations}, '[]', '[]', now() - interval '${o.daysAgo ?? 0} days');`);
    return row;
  };

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('askfollow');
    const st = (await api('/ask/status', { token: t.token })).body;
    mock = st.provider === 'mock';
    configured = st.configured === true;
    await enableAsk(t.token);
    const email = `asker-${t.slug}@example.test`;
    await api('/users', { method: 'POST', token: t.token, json: { email, password: t.password, name: 'asker', role: 'viewer' } });
    asker = (await login(email, t.password, t.slug)).body.accessToken as string;
    id.asker = userId(email);
    const make = async (code: string, title: string, articleTitle: string, content: string) => {
      const set = await createPolicyWithArticle(t.token, `${code}-${Date.now().toString(36)}`, title);
      const art = await api(`/policies/${set.policy.id}/chapters/${set.chapter.id}/articles`, {
        method: 'POST',
        token: t.token,
        json: { number: 2, title: articleTitle, content },
      });
      const pub = await api(`/policies/${set.policy.id}/publish-drafts`, {
        method: 'POST',
        token: t.token,
        json: { changeNote: '제정', effectiveDate: '2024-01-01' },
      });
      expect(pub.status).toBeLessThan(300);
      return { policy: set.policy.id as string, article: art.body.id as string };
    };
    const leave = await make('LEV', '휴가규정', '경조휴가', '직원 본인이 결혼하면 5일의 경조휴가를 준다.');
    const travel = await make('TRV', '여비규정', '출장비', '출장비는 실비로 지급하고 7일 안에 정산한다.');
    Object.assign(id, { leave: leave.policy, leaveArticle: leave.article, travel: travel.policy });
    other = await createTenant('askfollow2');
  });

  it('앞 질문 값이 uuid 가 아니면 400', async () => {
    const before = logs();
    for (const parentId of ['nope', 3, '']) expect((await ask({ question: '경조휴가 결혼', parentId })).status).toBe(400);
    expect(logs()).toBe(before);
  });

  it('남의 것·다른 회사 것·보관 기간 밖·답하지 못한 것·근거를 남기기 전 기록·없는 것은 같은 400 — 기록도 한도 차감도 없다', async (ctx) => {
    if (!configured) ctx.skip();
    const mine = id.asker;
    const tid = tenantId(t.slug);
    const cited = JSON.stringify([{ articleId: id.leaveArticle }]);
    const bad = [
      seed(tid, userId(t.email), { answerable: true, citations: cited }), // 같은 회사 다른 사람
      seed(tenantId(other.slug), userId(other.email), { answerable: true, citations: cited }), // 다른 회사
      seed(tid, mine, { answerable: true, citations: cited, daysAgo: 91 }), // 보관 기간 밖
      seed(tid, mine, { answerable: false, citations: '[]' }), // 답하지 못함
      seed(tid, mine, { answerable: true, citations: null }), // 근거를 남기기 전(T-218 전)
      randomUUID(), // 없음
    ];
    const before = { used: await used(), logs: logs() };
    const bodies: unknown[] = [];
    for (const parentId of bad) {
      const r = await ask({ question: '경조휴가 결혼', parentId });
      expect(r.status, parentId).toBe(400);
      expect(r.body.code, parentId).toBe('AI_QA_PARENT_INVALID');
      bodies.push(r.body);
    }
    for (const b of bodies) expect(b).toEqual(bodies[0]);
    expect({ used: await used(), logs: logs() }).toEqual(before);
  });

  it('범위와 앞 질문이 모두 틀리면 범위 거절(400 AI_QA_SCOPE_INVALID)이 먼저다', async (ctx) => {
    if (!configured) ctx.skip();
    const r = await ask({ question: '경조휴가 결혼', policyIds: [randomUUID()], parentId: randomUUID() });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('AI_QA_SCOPE_INVALID');
  });

  it('꺼진 회사는 앞 질문이 틀려도 꺼짐(403)이 먼저다', async (ctx) => {
    if (!configured) ctx.skip();
    const r = await ask({ question: '경조휴가 결혼', parentId: randomUUID() }, other.token);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('AI_QA_DISABLED');
  });

  it('이어 물으면 앞 답의 근거 조를 이어받아, 낱말이 없는 질문도 찾는다 — 한도는 한 번, 응답에 id·parentId', async (ctx) => {
    if (!mock) ctx.skip();
    // 앞 질문 글에 다른 규정(여비규정)의 낱말을 섞고 휴가규정 범위 안에서 묻는다 — 앞 답의 근거는 휴가규정뿐이다. 이어 물을 때
    // 앞 질문 글이 고르기·낱말 찾기로 새면 여비규정 조문이 따라 나와 아래 단언이 깨진다(SEARCH-12 ② — 앞 질문 글은 보내지 않는다)
    parent.question = '경조휴가 결혼 출장비';
    const first = await ask({ question: parent.question, policyIds: [id.leave] });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ answerable: true, parentId: null });
    expect(typeof first.body.id).toBe('string');
    parent.id = first.body.id;

    // 같은 질문을 잇지 않고 물으면 찾을 조가 없다(낱말이 목차·본문에 없다)
    const alone = await ask({ question: '그건 며칠까지 되나요?' });
    expect(alone.body).toMatchObject({ answerable: false, reason: 'no_candidates', parentId: null });

    const before = await used();
    const follow = await ask({ question: '그건 며칠까지 되나요?', parentId: parent.id });
    expect(follow.status).toBe(200);
    expect(follow.body.parentId).toBe(parent.id);
    expect(follow.body.id).not.toBe(parent.id);
    expect(policyIds(follow.body)).toEqual([id.leave]); // 범위 없이 물었는데도 여비규정이 없다 — 앞 질문 글이 새지 않았다
    expect(follow.body.consulted.map((c: any) => c.label)).toContain('제2조(경조휴가)');
    expect(follow.body.answerable).toBe(true);
    expect(await used()).toBe(before + 1);
    // 기록에는 질문 글만 — 앞 질문 글을 함께 남기지 않는다
    expect(sql(`SELECT question || '|' || parent_id FROM ai_qa_logs WHERE id = '${follow.body.id}'`)).toBe(`그건 며칠까지 되나요?|${parent.id}`);
  });

  it('이번 범위 밖이면 앞 답의 근거를 이어받지 않는다', async (ctx) => {
    if (!mock) ctx.skip();
    const r = await ask({ question: '그건 며칠까지 되나요?', parentId: parent.id, policyIds: [id.travel] });
    expect(r.status).toBe(200);
    expect(policyIds(r.body)).not.toContain(id.leave);
    expect(r.body).toMatchObject({ answerable: false, reason: 'no_candidates', parentId: parent.id });
  });

  it('조 번호가 바뀌어도 같은 조문을 따라간다', async (ctx) => {
    if (!mock) ctx.skip();
    sql(`UPDATE articles SET number = 7 WHERE id = '${id.leaveArticle}'`);
    const r = await ask({ question: '그건 며칠까지 되나요?', parentId: parent.id });
    expect(r.body.consulted.map((c: any) => c.label)).toEqual(['제7조(경조휴가)']);
  });

  it('지난 질문 — 목록에 parentId, 다시 보기에 앞 질문, 앞 질문이 지워지면 null', async (ctx) => {
    if (!mock) ctx.skip();
    const list = (await api('/ask/history', { token: asker })).body.items;
    const follows = list.filter((i: any) => i.parentId === parent.id);
    expect(follows.length).toBeGreaterThanOrEqual(3);
    expect(list.find((i: any) => i.id === parent.id).parentId).toBeNull();
    const d = await api(`/ask/history/${follows[0].id}`, { token: asker });
    expect(d.body).toMatchObject({ parentId: parent.id, parent: { id: parent.id, question: parent.question } });
    sql(`DELETE FROM ai_qa_logs WHERE id = '${parent.id}'`);
    const gone = await api(`/ask/history/${follows[0].id}`, { token: asker });
    expect(gone.body).toMatchObject({ parentId: parent.id, parent: null });
    // 지워진 앞 질문에는 더 잇지 못한다
    expect((await ask({ question: '그건 며칠까지 되나요?', parentId: parent.id })).body.code).toBe('AI_QA_PARENT_INVALID');
  });

  it('한도를 다 쓴 사람도 앞 질문이 틀리면 앞 질문 거절(400)이 한도(429)보다 먼저다', async (ctx) => {
    if (!configured) ctx.skip();
    const st = (await api('/ask/status', { token: asker })).body;
    const fill = Math.max(st.userLimit - st.userUsed, 0);
    const tid = tenantId(t.slug);
    sql(`INSERT INTO ai_qa_logs (id, tenant_id, user_id, question, answerable, cited_article_ids, ai_called)
         SELECT gen_random_uuid()::text, '${tid}', '${id.asker}', '한도 채움', false, '{}', true FROM generate_series(1, ${fill});`);
    try {
      const bad = await ask({ question: '경조휴가 결혼', parentId: randomUUID() });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('AI_QA_PARENT_INVALID');
      expect((await ask({ question: '경조휴가 결혼' })).status).toBe(429); // 앞 질문 없이는 한도에 걸린다
    } finally {
      sql(`DELETE FROM ai_qa_logs WHERE tenant_id = '${tid}' AND question = '한도 채움';`);
    }
  });
});

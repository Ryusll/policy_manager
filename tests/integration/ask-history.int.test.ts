import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, enableAsk, login, waitForApi } from './helpers';
import { sql } from './race';

/**
 * T-218 내 지난 질문(SRS SEARCH-10).
 *
 * 지키는 것: 본인 것만(관리자도 남의 질문은 404), 보관 기간(90일) 안만, 다시 보기는 **물은 때의 답과 근거 원문 그대로**
 * (그 뒤 규정을 고쳐도), 다시 보기는 한도에 세지 않는다, 답하지 못한 질문도 그 사실과 함께 보이되 기록의 오류 문구는
 * 내보내지 않는다, 꺼진 회사·고지 재확인을 기다리는 회사는 지난 질문도 열지 않는다.
 * 격리·보관 기간·쪽 나눔·닫힘은 기록 행을 바로 심어 모의 AI 없이도 돈다. 실제로 물어 남긴 기록을 보는 시험만 모의 AI
 * (`AI_QA_PROVIDER=mock`)가 있어야 한다 — 없으면 그 시험만 건너뛴다.
 */
describe('내 지난 질문 (T-218)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let other: Awaited<ReturnType<typeof createTenant>>;
  let mock = false;
  let asker = ''; // 모의 AI 로 실제로 묻는 직원
  let reader = ''; // 심은 기록을 읽는 직원
  let editor = '';
  let clauseId = '';
  const ids: Record<string, string> = {};
  let seeded: string[] = []; // reader 의 기록, 최신순
  let otherSeeded = '';

  const ask = (question: string, token: string) => api('/ask', { method: 'POST', token, json: { question } });
  const history = (token: string, query = '') => api(`/ask/history${query}`, { token });
  const item = (token: string, id: string) => api(`/ask/history/${id}`, { token });
  const userToken = async (role: 'editor' | 'viewer', name: string) => {
    const email = `${name}-${t.slug}@example.test`;
    await api('/users', { method: 'POST', token: t.token, json: { email, password: t.password, name, role } });
    return (await login(email, t.password, t.slug)).body.accessToken as string;
  };
  const tenantId = (slug: string) => sql(`SELECT id FROM tenants WHERE slug = '${slug}'`);
  const userId = (email: string) => sql(`SELECT id FROM users WHERE email = '${email}'`);
  /** 기록 한 행을 바로 심는다 — AI 를 부르지 않은 질문(시행 중 규정 없음)이라 한도에도 세지 않는다 */
  const seed = (tenant: string, user: string, question: string, minutesAgo: number) => {
    const id = randomUUID();
    sql(`INSERT INTO ai_qa_logs (id, tenant_id, user_id, question, answerable, cited_article_ids, ai_called, reason,
           citations, law_citations, consulted, created_at)
         VALUES ('${id}', '${tenant}', '${user}', '${question}', false, '{}', false, 'no_regulations',
           '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now() - interval '${minutesAgo} minutes');`);
    return id;
  };
  const age = (id: string) => sql(`UPDATE ai_qa_logs SET created_at = now() - interval '91 days' WHERE id = '${id}';`);

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('askhist');
    mock = (await api('/ask/status', { token: t.token })).body.provider === 'mock';
    await enableAsk(t.token);
    asker = await userToken('viewer', 'asker');
    reader = await userToken('viewer', 'reader');
    editor = await userToken('editor', 'editor');
    const readerId = userId(`reader-${t.slug}@example.test`);
    seeded = [10, 20, 30, 40].map((m) => seed(tenantId(t.slug), readerId, `심은 질문 ${m}분 전`, m));
    other = await createTenant('askhist2');
    await enableAsk(other.token);
    otherSeeded = seed(tenantId(other.slug), userId(other.email), '다른 회사 질문', 5);
    if (!mock) return;
    const set = await createPolicyWithArticle(t.token, `HIST-${Date.now().toString(36)}`, '복리후생규정');
    const add = async (json: Record<string, unknown>) =>
      (await api(`/policies/${set.policy.id}/chapters/${set.chapter.id}/articles`, { method: 'POST', token: t.token, json })).body;
    // 모의 AI 는 첫 근거 하나만 댄다 — 조 머리에 본문이 있는 한 행으로 만들어 그 행이 근거가 되게 한다
    clauseId = (await add({ number: 2, title: '경조금', content: '직원 본인이 결혼하면 경조금 50만원을 지급한다.' })).id;
    const pub = await api(`/policies/${set.policy.id}/publish-drafts`, {
      method: 'POST',
      token: t.token,
      json: { changeNote: '제정', effectiveDate: '2024-01-01' },
    });
    expect(pub.status).toBeLessThan(300);
  });

  it('물은 질문이 최신순으로 보이고, 다시 보기는 물은 때의 답과 근거 원문 그대로다', async (ctx) => {
    if (!mock) ctx.skip();
    const answered = await ask('경조금 결혼', asker);
    expect(answered.status).toBe(200);
    expect(answered.body.answerable).toBe(true);
    const noBasis = await ask('[모름] 경조금', asker);
    expect(noBasis.body.answerable).toBe(false);

    const list = await history(asker);
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: any) => [i.question, i.outcome])).toEqual([
      ['[모름] 경조금', 'no_basis'],
      ['경조금 결혼', 'answered'],
    ]);
    expect(list.body.nextCursor).toBeNull();
    ids.answered = list.body.items[1].id;
    ids.noBasis = list.body.items[0].id;

    const d = await item(asker, ids.answered);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ id: ids.answered, question: '경조금 결혼', outcome: 'answered', snapshot: true });
    expect(d.body.result.blocks).toEqual(answered.body.blocks);
    expect(d.body.result.citations).toEqual(answered.body.citations);
    expect(d.body.result.lawCitations).toEqual(answered.body.lawCitations);
    expect(d.body.result.consulted).toEqual(answered.body.consulted);
    expect(d.body.result.citations[0].content).toContain('50만원');
    expect(d.body.result).not.toHaveProperty('usage');

    // 답하지 못한 결과도 물은 때 받은 것과 같다(답 본문·근거는 그때도 비어 있었다)
    const nb = await item(asker, ids.noBasis);
    expect(nb.body).toMatchObject({ outcome: 'no_basis', snapshot: true });
    expect(nb.body.result).toEqual({ ...noBasis.body, usage: undefined });
    expect(nb.body.result.consulted.map((c: any) => c.label)).toContain('제2조(경조금)');
  });

  it('물은 뒤 규정 문구가 바뀌어도 다시 보기의 근거는 그때 그대로다', async (ctx) => {
    if (!mock) ctx.skip();
    sql(`UPDATE article_versions SET content = '직원 본인이 결혼하면 경조금 70만원을 지급한다.' WHERE article_id = '${clauseId}'`);
    const d = await item(asker, ids.answered);
    expect(d.body.result.citations[0].content).toContain('50만원');
    expect(d.body.result.citations[0].content).not.toContain('70만원');
  });

  it('답을 받지 못한 질문도 그 사실과 함께 보이고, 기록의 오류 문구는 내보내지 않는다', async (ctx) => {
    if (!mock) ctx.skip();
    expect((await ask('[실패] 경조금', asker)).status).toBe(502);
    expect((await ask('[거절] 경조금', asker)).status).toBe(200);
    const list = await history(asker);
    const [refused, failed] = list.body.items;
    expect([refused.question, refused.outcome]).toEqual(['[거절] 경조금', 'refused']);
    expect([failed.question, failed.outcome]).toEqual(['[실패] 경조금', 'failed']);
    const stored = sql(`SELECT failure FROM ai_qa_logs WHERE id = '${failed.id}'`);
    expect(stored).toContain('모의 AI 호출 실패');
    const d = await item(asker, failed.id);
    expect(d.status).toBe(200);
    // T-218 뒤의 기록은 답하지 못했어도 근거 칸을 남겨 옛 기록(snapshot:false)과 갈린다
    expect(d.body).toMatchObject({ outcome: 'failed', snapshot: true, result: null });
    expect(JSON.stringify(d.body)).not.toContain('모의 AI 호출 실패');
    expect(JSON.stringify(list.body)).not.toContain('모의 AI 호출 실패');
    const r = await item(asker, refused.id);
    expect(r.body).toMatchObject({ snapshot: true, result: { answerable: false, reason: 'refused' } });
  });

  it('목록·다시 보기는 AI 를 부르지 않아 월 한도에 세지 않는다', async () => {
    const before = (await api('/ask/status', { token: reader })).body;
    for (let i = 0; i < 3; i += 1) {
      expect((await history(reader)).status).toBe(200);
      expect((await item(reader, seeded[0])).status).toBe(200);
    }
    const after = (await api('/ask/status', { token: reader })).body;
    expect([after.used, after.userUsed]).toEqual([before.used, before.userUsed]);
  });

  it('본인 것만 — 같은 회사 편집자·관리자에게도 남의 질문은 목록에 없고 다시 보기는 404', async () => {
    const mine = await history(reader);
    expect(mine.body.items.map((i: any) => i.id)).toEqual(seeded);
    expect((await item(reader, seeded[0])).body).toMatchObject({ outcome: 'no_regulations', snapshot: true });
    for (const token of [editor, t.token]) {
      const list = await history(token);
      expect(list.status).toBe(200);
      expect(list.body.items).toEqual([]);
      const d = await item(token, seeded[0]);
      expect(d.status).toBe(404);
      expect(d.body.code).toBe('AI_QA_HISTORY_NOT_FOUND');
      expect(JSON.stringify(d.body)).not.toContain('심은 질문');
    }
  });

  it('다른 회사 사람에게도 404, 다른 회사의 기록도 이 회사 사람에게 404', async () => {
    const d = await item(other.token, seeded[0]);
    expect(d.status).toBe(404);
    expect(d.body.code).toBe('AI_QA_HISTORY_NOT_FOUND');
    expect((await item(t.token, otherSeeded)).status).toBe(404);
    expect((await item(other.token, otherSeeded)).status).toBe(200);
  });

  it('쪽 나눔 — limit·nextCursor 로 겹치지 않게 끝까지, 남의 cursor·잘못된 값은 400', async () => {
    const first = await history(reader, '?limit=3');
    expect(first.body.items.map((i: any) => i.id)).toEqual(seeded.slice(0, 3));
    expect(first.body.nextCursor).toBe(seeded[2]);
    const second = await history(reader, `?limit=3&cursor=${first.body.nextCursor}`);
    expect(second.body.items.map((i: any) => i.id)).toEqual([seeded[3]]);
    expect(second.body.nextCursor).toBeNull();
    const foreign = await history(editor, `?cursor=${seeded[0]}`);
    expect(foreign.status).toBe(400);
    expect(foreign.body.code).toBe('AI_QA_HISTORY_CURSOR');
    expect((await history(reader, `?cursor=${randomUUID()}`)).status).toBe(400);
    expect((await history(reader, '?limit=51')).status).toBe(400);
    expect((await history(reader, '?limit=0')).status).toBe(400);
    expect((await history(reader, '?cursor=nope')).status).toBe(400);
    expect((await item(reader, 'not-a-uuid')).status).toBe(400);
  });

  it('보관 기간(90일)이 지난 기록은 목록에 없고 다시 보기도 404 — 앞 쪽의 마지막 기록이 기간을 넘겨도 다음 쪽은 빈 쪽', async () => {
    const first = await history(reader, '?limit=3');
    expect(first.body.nextCursor).toBe(seeded[2]);
    age(seeded[2]);
    age(seeded[3]);
    const next = await history(reader, `?limit=3&cursor=${first.body.nextCursor}`);
    expect(next.status).toBe(200);
    expect(next.body).toEqual({ items: [], nextCursor: null });
    const list = await history(reader);
    expect(list.body.items.map((i: any) => i.id)).toEqual(seeded.slice(0, 2));
    expect((await item(reader, seeded[3])).status).toBe(404);
  });

  it('꺼진 회사는 지난 질문도 열지 않는다(질문과 같은 403)', async () => {
    expect((await history(other.token)).body.items.map((i: any) => i.id)).toEqual([otherSeeded]);
    const off = await api('/ask/settings', { method: 'PATCH', token: other.token, json: { enabled: false } });
    expect(off.status).toBe(200);
    for (const res of [await history(other.token), await item(other.token, otherSeeded)]) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('AI_QA_DISABLED');
    }
  });

  it('고지가 바뀌어 관리자의 다시 확인을 기다리는 회사도 지난 질문을 열지 않고, 다시 확인하면 연다', async () => {
    await enableAsk(other.token);
    expect((await history(other.token)).status).toBe(200);
    // 지금 판이 아닌 판에 동의한 회사 — 판을 올려 배포한 것과 같다(ask-consent 시험과 같은 방법)
    sql(`UPDATE tenants SET ai_qa_enabled = true, ai_qa_notice_version = ai_qa_notice_version + 1 WHERE slug = '${other.slug}';`);
    for (const res of [await history(other.token), await item(other.token, otherSeeded)]) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('AI_QA_NOTICE_CHANGED');
    }
    await enableAsk(other.token);
    expect((await item(other.token, otherSeeded)).status).toBe(200);
  });
});

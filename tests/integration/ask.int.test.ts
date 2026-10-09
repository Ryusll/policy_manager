import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';

/**
 * T-130 규정 근거 AI 질의응답.
 *
 * 실제 AI 를 부르지 않는다 — API 를 `AI_QA_PROVIDER=mock` 으로 띄우면 모의 AI 가 정해진 규칙으로 답한다
 * (`apps/api/src/ask/ask-provider.ts`). 모의 AI 가 없는 API(설정 안 됨)에서는 "설정 안 됨" 응답만 보고
 * 나머지는 건너뛴다.
 *
 * 지키는 것: 근거는 **지금 시행 중인 본문**뿐(초안·미래 시행·폐지 조문은 후보조차 아니다), 준 적 없는
 * 근거는 버리고 근거가 없으면 답하지 않는다, 회사 관리자가 끌 수 있다, 회사 사이는 섞이지 않는다.
 */
describe('규정 질문(AI) — 근거는 시행 중 본문뿐', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let mock = false;
  let policyId = '';
  const ids: Record<string, string> = {};

  const ask = (question: string, token = t.token) => api('/ask', { method: 'POST', token, json: { question } });
  const userToken = async (role: 'editor' | 'viewer') => {
    const email = `${role}-${t.slug}@example.test`;
    await api('/users', { method: 'POST', token: t.token, json: { email, password: t.password, name: role, role } });
    return (await login(email, t.password, t.slug)).body.accessToken as string;
  };

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('ask');
    const st = await api('/ask/status', { token: t.token });
    mock = st.body.provider === 'mock';
    if (!mock) return;

    // 제1조(목적) + 제2조(경조금) ① + 제5조(폐지할 조) → 2024-01-01 시행
    const set = await createPolicyWithArticle(t.token, `ASK-${Date.now().toString(36)}`, '복리후생규정');
    policyId = set.policy.id;
    const chapterId = set.chapter.id;
    const add = async (json: Record<string, unknown>) =>
      (await api(`/policies/${policyId}/chapters/${chapterId}/articles`, { method: 'POST', token: t.token, json })).body;
    ids.jo2 = (await add({ number: 2, title: '경조금' })).id;
    ids.jo2h1 = (await add({ number: 2, clauseNumber: 1, title: '', content: '직원 본인이 결혼하면 경조금 50만원을 지급한다.' })).id;
    ids.jo5 = (await add({ number: 5, title: '폐지된 휴양소', content: '휴양소 이용 규칙은 폐지 전 문구이다.' })).id;
    const pub = (effectiveDate: string) =>
      api(`/policies/${policyId}/publish-drafts`, { method: 'POST', token: t.token, json: { changeNote: '제정', effectiveDate } });
    expect((await pub('2024-01-01')).body.published).toBe(3); // 제목만 있는 조 머리는 버전이 없다

    // 제4조 — 미래에 시행
    ids.jo4 = (await add({ number: 4, title: '미래 수당', content: '2099년부터 우주 수당을 지급한다.' })).id;
    expect((await pub('2099-01-01')).body.published).toBe(1);

    // 제3조 — 초안만(시행 전)
    ids.jo3 = (await add({ number: 3, title: '비밀 초안', content: '아직 시행 전인 기밀 보너스 문구.' })).id;

    // 제5조 폐지
    const v5 = (await api(`/articles/${ids.jo5}/versions`, { token: t.token })).body.find((v: any) => v.status === 'published');
    expect((await api(`/versions/${v5.id}/archive`, { method: 'POST', token: t.token })).status).toBeLessThan(300);
  });

  it('상태: 서버 설정·회사 켜짐·이번 달 사용량을 알려 준다(키는 내보내지 않는다)', async () => {
    const { status, body } = await api('/ask/status', { token: t.token });
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['configured', 'enabled', 'limit', 'provider', 'used']);
    if (!mock) {
      expect((await ask('경조금은 얼마인가요')).status).toBe(503);
      return;
    }
    expect(body).toMatchObject({ configured: true, provider: 'mock', enabled: true, used: 0 });
  });

  it('시행 중 조문을 근거로 답하고, 준 적 없는 근거는 버린다', async (ctx) => {
    if (!mock) ctx.skip();
    const { status, body } = await ask('경조금 결혼');
    expect(status).toBe(200);
    expect(body.answerable).toBe(true);
    expect(body.blocks[0].type).toBe('paragraph');
    expect(body.blocks[0].text).toMatch(/^모의 답변/);
    expect(body.blocks[0].text).not.toMatch(/\[R\d+\]/); // 본문 속 참조 표기는 지운다
    // 모의 AI 는 R999 를 섞어 낸다 — 준 적 없는 번호라 버려진다
    expect(body.citations.map((c: any) => c.ref)).toEqual(['R1']);
    expect(body.citations[0]).toMatchObject({ policyId, label: '제2조', joTitle: '경조금', number: 2 });
    expect(body.consulted.map((c: any) => c.label)).toContain('제2조(경조금)');
    expect(body.usage.used).toBe(1);
  });

  it('근거 표시는 AI 가 옮긴 글이 아니라 DB 의 시행 중 본문이다', async (ctx) => {
    if (!mock) ctx.skip();
    const { body } = await ask('결혼 경조금');
    const cited = body.citations.find((c: any) => c.articleId === ids.jo2h1) ?? body.citations[0];
    if (cited.articleId === ids.jo2h1) expect(cited.content).toBe('직원 본인이 결혼하면 경조금 50만원을 지급한다.');
    expect(JSON.stringify(body)).not.toContain('기밀 보너스');
  });

  it('초안·미래 시행·폐지된 조문은 근거 후보조차 아니다', async (ctx) => {
    if (!mock) ctx.skip();
    for (const q of ['비밀 초안 기밀 보너스', '미래 수당 우주', '폐지된 휴양소']) {
      const { status, body } = await ask(q);
      expect(status).toBe(200);
      expect(body).toMatchObject({ answerable: false, reason: 'no_candidates', blocks: [], citations: [], consulted: [] });
      const text = JSON.stringify(body);
      expect(text).not.toContain('기밀 보너스');
      expect(text).not.toContain('우주 수당');
      expect(text).not.toContain('폐지 전 문구');
    }
  });

  it('근거가 남지 않거나 AI 가 모른다고 하면 답하지 않는다', async (ctx) => {
    if (!mock) ctx.skip();
    for (const q of ['경조금 [근거밖]', '경조금 [모름]']) {
      const { body } = await ask(q);
      expect(body).toMatchObject({ answerable: false, reason: 'no_basis', blocks: [], citations: [] });
      expect(body.consulted.length).toBeGreaterThan(0); // 무엇을 살펴봤는지는 알려 준다
    }
  });

  it('열람자도 물을 수 있다', async (ctx) => {
    if (!mock) ctx.skip();
    const { status, body } = await ask('경조금 결혼', await userToken('viewer'));
    expect(status).toBe(200);
    expect(body.answerable).toBe(true);
  });

  it('질문은 2~500자', async (ctx) => {
    if (!mock) ctx.skip();
    expect((await ask(' ')).status).toBe(400);
    expect((await ask('가'.repeat(501))).status).toBe(400);
  });

  it('회사 관리자만 끄고 켤 수 있고, 꺼 두면 묻지 못한다', async (ctx) => {
    if (!mock) ctx.skip();
    const editor = await userToken('editor');
    expect((await api('/ask/settings', { method: 'PATCH', token: editor, json: { enabled: false } })).status).toBe(403);

    const off = await api('/ask/settings', { method: 'PATCH', token: t.token, json: { enabled: false } });
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);
    const denied = await ask('경조금 결혼');
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('AI_QA_DISABLED');

    // 외부 AI 로 조문을 보낼지 말지를 바꾼 것이라 감사 기록을 남긴다
    const logs = await api('/audit-logs?action=ai_qa.settings_change', { token: t.token });
    expect(logs.body.total).toBe(1);
    const detail = (await api(`/audit-logs/${logs.body.rows[0].id}`, { token: t.token })).body;
    expect(detail.details).toEqual({ enabled: false });

    await api('/ask/settings', { method: 'PATCH', token: t.token, json: { enabled: true } });
    expect((await ask('경조금 결혼')).status).toBe(200);
  });

  it('다른 회사의 규정은 근거가 되지 않는다', async (ctx) => {
    if (!mock) ctx.skip();
    const other = await createTenant('ask-other');
    const { body } = await ask('경조금 결혼', other.token);
    expect(body).toMatchObject({ answerable: false, reason: 'no_regulations' });
    expect(JSON.stringify(body)).not.toContain('50만원');
    // AI 를 부르지 않았으니 한도에도 세지 않는다
    expect(body.usage.used).toBe(0);
  });

  it('이번 달 한도를 넘으면 429', async (ctx) => {
    if (!mock) ctx.skip();
    const other = await createTenant('ask-limit');
    const st = (await api('/ask/status', { token: other.token })).body;
    if (st.limit > 20) ctx.skip(); // 한도를 작게 띄운 API(AI_QA_MONTHLY_LIMIT)에서만 끝까지 채워 본다
    const set = await createPolicyWithArticle(other.token, `ASKL-${Date.now().toString(36)}`, '한도시험규정');
    await api(`/policies/${set.policy.id}/publish-drafts`, {
      method: 'POST',
      token: other.token,
      json: { changeNote: '제정', effectiveDate: '2024-01-01' },
    });
    for (let i = 0; i < st.limit; i++) await ask('목적 통합테스트', other.token);
    const over = await ask('목적 통합테스트', other.token);
    expect(over.status).toBe(429);
    expect(over.body.code).toBe('AI_QA_MONTHLY_LIMIT');
  });
});

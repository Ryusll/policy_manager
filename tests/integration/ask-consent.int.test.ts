import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { api, createTenant, createPolicyWithArticle, enableAsk, login, waitForApi } from './helpers';
import { sleepTrigger, waitForSleep } from './race';

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

/**
 * T-146 규정 질문 국외이전 대응 (D-09 재결정 2026-10-14, ADR-0025).
 *
 * 규정 질문은 질문할 때 관련 조문을 외부 AI(Anthropic, 미국)로 보낸다. 고객사는 개인정보처리자이고 VEDA 는 수탁자라,
 * 외부로 다시 맡기려면 고객사 동의가 있어야 한다. 그래서
 * - 회사마다 꺼진 채 시작한다. 관리자가 외부 전송 고지(받는 곳·국가·보내는 항목·보관 기간)를 확인해야 켜지고,
 *   확인한 사람·시각·고지 판이 남는다. 고지 판이 바뀌면 관리자가 다시 확인할 때까지 꺼진 것으로 본다.
 * - 질문 기록은 보관 기간(90일 — 고지에 실리는 코드 상수)이 지나면 서버 cron 이 부르는 CLI 가 지운다.
 *
 * 켜고 끄는 시험은 AI 설정이 없는 서버(CI)에서도 돈다. 실제로 묻는 부분만 모의 AI(`AI_QA_PROVIDER=mock`)일 때 본다.
 */
describe('규정 질문 — 기본 꺼짐과 관리자 동의 (T-146)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let mock = false;
  let version = 0;
  const ask = (question: string, token = t.token) => api('/ask', { method: 'POST', token, json: { question } });
  const settings = (json: Record<string, unknown>, token = t.token) => api('/ask/settings', { method: 'PATCH', token, json });
  const status = async (token = t.token) => (await api('/ask/status', { token })).body;
  const auditTotal = async () => (await api('/audit-logs?action=ai_qa.settings_change', { token: t.token })).body.total;
  const staffToken = async (role: 'editor' | 'viewer') => {
    const email = `${role}-${t.slug}@example.test`;
    await api('/users', { method: 'POST', token: t.token, json: { email, password: t.password, name: role, role } });
    return (await login(email, t.password, t.slug)).body.accessToken as string;
  };

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('ask-consent');
    const st = await status();
    mock = st.provider === 'mock';
    version = st.notice.version;
    const set = await createPolicyWithArticle(t.token, `ASKC-${Date.now().toString(36)}`, '복리후생규정');
    await api(`/policies/${set.policy.id}/publish-drafts`, {
      method: 'POST',
      token: t.token,
      json: { changeNote: '제정', effectiveDate: '2024-01-01' },
    });
  });

  it('새 회사는 꺼진 채 시작하고, 상태에 외부 전송 고지가 함께 온다', async () => {
    const st = await status();
    expect(st).toMatchObject({ enabled: false, needsConsent: false, consent: null });
    expect(st.notice).toMatchObject({ version: expect.any(Number), recipient: 'Anthropic, PBC' });
    expect(st.notice.country).toContain('미국');
    expect(st.notice.sent.join(' ')).toContain('조 목차');
    expect(st.notice.retention.join(' ')).toContain('90일');
    expect(sql(`SELECT ai_qa_enabled FROM tenants WHERE slug = '${t.slug}'`)).toBe('f');
  });

  it('꺼진 회사의 질문은 403 — 기록도 사용량도 늘지 않는다', async (ctx) => {
    if (!mock) ctx.skip();
    const r = await ask('목적 통합테스트');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('AI_QA_DISABLED');
    expect(sql(`SELECT count(*) FROM ai_qa_logs l JOIN tenants n ON n.id = l.tenant_id WHERE n.slug = '${t.slug}'`)).toBe('0');
    expect((await status()).used).toBe(0);
  });

  it('고지를 확인하지 않고는 켜지 못한다 — 판이 없거나 지금 판이 아니면 400, 아무것도 바뀌지 않는다', async () => {
    for (const json of [{ enabled: true }, { enabled: true, noticeVersion: version + 1 }]) {
      const r = await settings(json);
      expect(r.status, JSON.stringify(json)).toBe(400);
      expect(r.body.code).toBe('AI_QA_NOTICE_REQUIRED');
    }
    expect((await settings({ enabled: true, noticeVersion: 0 })).status).toBe(400); // 판 번호는 1 이상
    expect(await status()).toMatchObject({ enabled: false, consent: null });
    expect(await auditTotal()).toBe(0);
  });

  it('편집자는 켜지 못한다 — 회사 관리자만', async () => {
    const editor = await staffToken('editor');
    expect((await settings({ enabled: true, noticeVersion: version }, editor)).status).toBe(403);
    expect((await status()).enabled).toBe(false);
  });

  it('고지를 확인하고 켜면 확인한 사람·시각·판이 남는다', async (ctx) => {
    const before = Date.now() - 5_000;
    const res = await enableAsk(t.token);
    expect(res.body).toMatchObject({ enabled: true, needsConsent: false, consent: { noticeVersion: version } });
    expect(new Date(res.body.consent.consentedAt).getTime()).toBeGreaterThan(before);
    expect(sql(`SELECT ai_qa_consented_by || '|' || ai_qa_notice_version FROM tenants WHERE slug = '${t.slug}'`)).toBe(
      `${t.user.id}|${version}`,
    );
    const logs = await api('/audit-logs?action=ai_qa.settings_change', { token: t.token });
    expect(logs.body.total).toBe(1);
    const detail = (await api(`/audit-logs/${logs.body.rows[0].id}`, { token: t.token })).body;
    expect(detail.details).toEqual({ enabled: true, noticeVersion: version, consentedBy: { name: '통합테스트', email: t.email } });
    // 이미 켜진 채 같은 판을 다시 확인하면 바뀐 것이 없어 기록도 늘지 않는다
    await enableAsk(t.token);
    expect(await auditTotal()).toBe(1);
    if (!mock) ctx.skip();
    expect((await ask('목적 통합테스트')).status).toBe(200);
  });

  // 지금 판이 아닌 판에 동의한 회사 — 판을 올려 배포한 것과 같다. 0 이 아니라 다른 판 번호로 둔다(빈 값과 구분)
  const consentToOtherVersion = () =>
    sql(`UPDATE tenants SET ai_qa_enabled = true, ai_qa_notice_version = ${version + 1} WHERE slug = '${t.slug}';`);

  it('고지 판이 바뀌면 관리자가 다시 확인할 때까지 꺼진 것으로 본다', async () => {
    consentToOtherVersion();
    expect(await status()).toMatchObject({ enabled: false, needsConsent: true, consent: { noticeVersion: version + 1 } });
    const before = await auditTotal();
    await enableAsk(t.token);
    expect(await status()).toMatchObject({ enabled: true, needsConsent: false, consent: { noticeVersion: version } });
    expect(await auditTotal()).toBe(before + 1); // 다시 확인한 것도 남는다
  });

  it('고지 판이 바뀐 회사는 관리자도 직원도 묻지 못하고, 다시 확인하면 묻는다', async (ctx) => {
    if (!mock) ctx.skip();
    consentToOtherVersion();
    const viewer = await staffToken('viewer');
    for (const token of [t.token, viewer]) {
      const r = await ask('목적 통합테스트', token);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('AI_QA_NOTICE_CHANGED');
    }
    await enableAsk(t.token);
    expect((await ask('목적 통합테스트', viewer)).status).toBe(200);
  });

  it('고르는 사이 관리자가 끄면 조문 본문은 보내지 않는다 — 403 으로 끝나고 기록에 사유가 남는다', async (ctx) => {
    if (!mock) ctx.skip();
    // 모의 AI 는 "[느림]"이면 고르기에 1.5초 걸린다. 예약(한도에 셈)이 끝난 것을 본 뒤 그 사이에 끈다 —
    // 고정 대기만 두면 부하 때 예약보다 먼저 꺼서 예약 단계의 403 으로 엉뚱하게 실패한다
    const before = (await status()).used;
    const pending = ask('[느림] 목적 통합테스트');
    for (let i = 0; i < 200 && (await status()).used === before; i++) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 200)); // 목차를 읽고 고르기에 들어갈 틈
    expect((await settings({ enabled: false })).status).toBe(200);
    const r = await pending;
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('AI_QA_DISABLED');
    const row = sql(
      `SELECT l.ai_called || '|' || coalesce(l.failure, '') FROM ai_qa_logs l JOIN tenants n ON n.id = l.tenant_id
       WHERE n.slug = '${t.slug}' AND l.question LIKE '[느림]%' ORDER BY l.created_at DESC LIMIT 1`,
    );
    // 보통은 고르는 중에 꺼져 답하기 직전에 막힌다(true — 고르기는 불렀으니 한도에 센다). 부하로 고르기 전에
    // 꺼졌으면 고르기 직전에 막힌다(false — 한도에서 돌려준다). 어느 쪽이든 끈 사유가 남고, 한도는 그에 맞게 센다
    expect(row).toMatch(/^(true|false)\|.*켜지 않았습니다/);
    expect((await status()).used).toBe(before + (row.startsWith('true') ? 1 : 0));
    await enableAsk(t.token);
  });

  it('예약 직후(고르기 전) 관리자가 끄면 AI 를 부르지 않는다 — 403, 기록에 사유, 한도에서 돌려준다', async (ctx) => {
    if (!mock) ctx.skip();
    const before = (await status()).used;
    // 예약 행을 넣는 트랜잭션 안(예약 단계의 확인은 지난 뒤)에서 멈춰 세우고 그사이 끈다 — 고르기 직전 확인이 막아야 한다
    const drop = sleepTrigger('askc_reserved', 'ai_qa_logs', 'AFTER', 'INSERT', `NEW.question LIKE '[예약멈춤]%'`, 2);
    try {
      const pending = ask('[예약멈춤] 목적 통합테스트');
      await waitForSleep('askc_reserved');
      expect((await settings({ enabled: false })).status).toBe(200);
      const r = await pending;
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('AI_QA_DISABLED');
    } finally {
      drop();
    }
    // model 이 비어 있다 = 고르기를 한 번도 부르지 않았다(불렀으면 모의 AI 의 model 이 남는다) — 고르기 직전 확인이 막았다
    const row = sql(
      `SELECT l.ai_called || '|' || coalesce(l.model, '-') || '|' || coalesce(l.failure, '') FROM ai_qa_logs l
       JOIN tenants n ON n.id = l.tenant_id WHERE n.slug = '${t.slug}' AND l.question LIKE '[예약멈춤]%'`,
    );
    expect(row).toMatch(/^false\|-\|.*켜지 않았습니다/);
    expect((await status()).used).toBe(before); // AI 를 한 번도 부르지 않았으니 한도에서 돌려준다
    await enableAsk(t.token);
  });

  it('끄기는 확인 없이 되고, 다시 켤 때는 또 확인해야 한다 — 고지가 바뀐 채로도 끌 수 있다', async () => {
    const before = await auditTotal();
    const off = await settings({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);
    const blind = await settings({ enabled: true });
    expect(blind.status).toBe(400);
    expect(blind.body.code).toBe('AI_QA_NOTICE_REQUIRED');
    expect((await status()).enabled).toBe(false);
    expect(await auditTotal()).toBe(before + 1);
    // 고지가 바뀌어 다시 확인을 기다리는 회사(저장값은 켜짐)도 확인 없이 끈다
    consentToOtherVersion();
    const offStale = await settings({ enabled: false });
    expect(offStale.body).toMatchObject({ enabled: false, needsConsent: false });
    expect(sql(`SELECT ai_qa_enabled FROM tenants WHERE slug = '${t.slug}'`)).toBe('f');
  });
});

/**
 * 파기 CLI 는 서버에서 API 컨테이너 안에서 돈다(`scripts/oracle/ai-qa-purge.sh`). 시험도 같은 자리에서 부른다.
 * 따로 띄운 API 로 시험할 때는 `AI_QA_PURGE_CMD` 로 같은 DB 를 보는 명령을 준다.
 */
describe('질문 기록 파기 (T-146)', () => {
  const purge = () =>
    execSync(process.env.AI_QA_PURGE_CMD ?? 'docker compose exec -T api node dist/ask/ask-purge.cli.js', {
      encoding: 'utf8',
    });
  const insertLog = (slug: string, daysAgo: number, question: string) =>
    `INSERT INTO ai_qa_logs (id, tenant_id, question, answerable, ai_called, cited_article_ids, created_at)
     SELECT gen_random_uuid(), id, '${question}', false, true, '{}', now() - interval '${daysAgo} days' FROM tenants WHERE slug = '${slug}';`;

  beforeAll(async () => {
    await waitForApi();
  });

  it('보관 기간(90일)이 지난 기록만 모든 회사에서 지운다 — 이번 달 사용량은 그대로', async () => {
    const a = await createTenant('ask-purge-a');
    const b = await createTenant('ask-purge-b');
    sql(
      insertLog(a.slug, 91, '오래된 질문 A') +
        insertLog(a.slug, 89, '남을 질문 A') +
        insertLog(a.slug, 0, '오늘 질문 A') +
        insertLog(b.slug, 120, '오래된 질문 B'),
    );
    const usedBefore = (await api('/ask/status', { token: a.token })).body.used;
    const out = purge();
    expect(out).toMatch(/90일 지난 기록 \d+건 삭제/);
    expect(out).not.toContain('오래된 질문'); // 지운 내용은 찍지 않는다
    const left = sql(
      `SELECT l.question FROM ai_qa_logs l JOIN tenants n ON n.id = l.tenant_id
       WHERE n.slug IN ('${a.slug}', '${b.slug}') ORDER BY l.created_at`,
    );
    expect(left.split('\n')).toEqual(['남을 질문 A', '오늘 질문 A']);
    expect((await api('/ask/status', { token: a.token })).body.used).toBe(usedBefore);
  });
});

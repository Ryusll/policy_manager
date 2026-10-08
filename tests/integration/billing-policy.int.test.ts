import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { api, createTenant, waitForApi } from './helpers';

/**
 * 결제 사용 여부와 요금제 변경 권한 (T-125) — 가격 확정 전 임시 운영 방침.
 *
 * 운영 서버에는 `PAYMENT_PROVIDER` 를 넣지 않는다(결제 미사용). 이 상태에서
 * 1. 고객사 관리자가 결제를 시작해도 **요금제·구독·결제 기록이 하나도 바뀌지 않아야** 하고
 * 2. 로그인 없이 열린 결제 웹훅으로도 요금제를 바꿀 수 없어야 하며
 * 3. 요금제는 통합 관리의 플랫폼 관리자만 바꾼다 — 그 길은 그대로 동작해야 한다.
 *
 * 예전에는 설정이 빠지면 mock 으로 떨어져 버튼 한 번에 결제 없이 요금제가 올라갔고, 웹훅은
 * 비밀키가 설정되지 않으면 검사를 건너뛰었다.
 *
 * 개발·CI 의 docker API 도 `PAYMENT_PROVIDER` 를 넘기지 않으므로 첫 블록이 기본으로 돈다.
 * 결제를 켠 서버는 API 를 그 설정으로 띄우고 `BILLING_TEST_PROVIDER` 를 맞춰 돌린다:
 * - `external` — API: `PAYMENT_PROVIDER=testpg`, `PAYMENT_WEBHOOK_SECRET`, `PAYMENT_HOSTED_CHECKOUT_URL`
 *   / 테스트: `BILLING_TEST_WEBHOOK_SECRET` 에 같은 비밀키
 * - `external-nosecret` — API: `PAYMENT_PROVIDER=testpg` 만
 * - `mock` — `billing-records.int.test.ts`(T-17)
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

/** 요금제·청구 상태·만료일 + 결제 고객·구독·결제·요금제 변경 감사 기록 수. 막힌 요청 전후가 같아야 한다 */
function billingSnapshot(tenantId: string): string {
  return sql(`
    SELECT t.plan || '|' || t.billing_status || '|' || coalesce(t.plan_expires_at::text, '-')
      || '|customers=' || (SELECT count(*) FROM billing_customers WHERE tenant_id = t.id)
      || '|subscriptions=' || (SELECT count(*) FROM billing_subscriptions WHERE tenant_id = t.id)
      || '|payments=' || (SELECT count(*) FROM billing_payments WHERE tenant_id = t.id)
      || '|planAudits=' || (SELECT count(*) FROM audit_logs WHERE tenant_id = t.id AND action LIKE '%plan%')
    FROM tenants t WHERE t.id = '${tenantId}';`);
}

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const checkout = (token: string, targetPlan: 'pro' | 'enterprise') =>
  api('/billing/checkout', { method: 'POST', token, json: { targetPlan } });

/** 결제사가 보내는 모양 그대로 — 검증을 통과해야 차단 로직까지 닿는다 */
const paymentSucceeded = (tenantSlug: string, targetPlan: 'pro' | 'enterprise', amount = 12_345) => ({
  type: 'payment.succeeded',
  data: { tenantSlug, targetPlan, paymentId: `pay_${stamp()}`, orderId: `ord_${stamp()}`, amount },
});

/** 현재 사용자 — 요금제를 매 요청 DB 에서 다시 읽어 담는다 */
const currentUser = (token: string) => api('/auth/me', { method: 'POST', token });

const webhook = (json: unknown, secret?: string) =>
  api('/billing/webhook', {
    method: 'POST',
    json,
    headers: secret === undefined ? undefined : { 'x-billing-secret': secret },
  });

const mode = process.env.BILLING_TEST_PROVIDER ?? '';
// 가입으로 회사를 만들어 준비한다 — 가입이 닫힌 서버(운영 설정)에서는 건너뛴다
const signupClosed = process.env.EXPECT_SIGNUP_CLOSED === '1';

describe.skipIf(mode !== '' || signupClosed)('T-125 결제 미사용 서버 — 요금제는 플랫폼 관리자만', () => {
  let platform: Awaited<ReturnType<typeof createTenant>>;
  let customer: Awaited<ReturnType<typeof createTenant>>;
  let tenantId: string;
  let before: string;

  beforeAll(async () => {
    await waitForApi();
    platform = await createTenant('bill-pf');
    customer = await createTenant('bill-ca');
    tenantId = customer.user.tenantId;
    sql(`UPDATE users SET platform_role='global_admin' WHERE id='${platform.user.id}';`);
    before = billingSnapshot(tenantId);
  }, 90_000);

  it('준비 상태 — Starter, 결제 기록 없음', () => {
    expect(before).toMatch(/^starter\|/);
    expect(before).toContain('|customers=0|subscriptions=0|payments=0|planAudits=0');
  });

  it('고객사 관리자가 결제를 시작하면 403 BILLING_CLOSED — 요금제·구독·결제 기록이 그대로다', async () => {
    for (const plan of ['pro', 'enterprise'] as const) {
      const r = await checkout(customer.token, plan);
      expect(r.status, plan).toBe(403);
      expect(r.body.code, plan).toBe('BILLING_CLOSED');
      expect(r.body.message, plan).toContain('아스트룸');
    }
    expect(billingSnapshot(tenantId)).toBe(before);

    const me = await currentUser(customer.token);
    expect(me.body.plan).toBe('starter');
    const history = await api('/billing/history', { token: customer.token });
    expect(history.body.currentSubscription).toBeNull();
    expect(history.body.payments).toEqual([]);
  });

  it('로그인 없는 결제 웹훅 — 비밀키가 없어도, 아무 값을 대도 403 이고 아무것도 바뀌지 않는다', async () => {
    for (const secret of [undefined, '', 'guess', 'x'.repeat(64)]) {
      const r = await webhook(paymentSucceeded(customer.slug, 'enterprise'), secret);
      expect(r.status, String(secret)).toBe(403);
      expect(r.body.code, String(secret)).toBe('PAYMENT_DISABLED');
    }
    expect(billingSnapshot(tenantId)).toBe(before);
  });

  /** 예전에는 비밀키 미설정이면 검사를 건너뛰어 아무나 보낸 요청이 `ok` 로 받아들여졌다 */
  it('결제가 아닌 이벤트도 받지 않는다 — 본문을 보기 전에 거절한다', async () => {
    const r = await webhook({ type: 'ping' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('PAYMENT_DISABLED');
  });

  it('고객사 관리자는 통합 관리 API 로도 요금제를 못 바꾼다', async () => {
    const r = await api(`/platform-admin/tenants/${tenantId}/plan`, {
      method: 'PATCH',
      token: customer.token,
      json: { plan: 'enterprise', billingStatus: 'active' },
    });
    expect(r.status).toBe(403);
    expect(billingSnapshot(tenantId)).toBe(before);
  });

  it('플랫폼 관리자는 통합 관리에서 바꿀 수 있고, 다음 요청부터 그 요금제로 동작한다', async () => {
    expect((await api('/templates', { token: customer.token })).status).toBe(403);

    const r = await api(`/platform-admin/tenants/${tenantId}/plan`, {
      method: 'PATCH',
      token: platform.token,
      json: { plan: 'pro', billingStatus: 'active', planExpiresAt: '2027-10-31T00:00:00.000Z' },
    });
    expect(r.status).toBe(200);
    expect(r.body.plan).toBe('pro');

    const me = await currentUser(customer.token);
    expect(me.body.plan).toBe('pro');
    expect(String(me.body.planExpiresAt)).toMatch(/^2027-10-31/);
    // Pro 기능이 바로 열린다 — 다시 로그인하지 않아도
    expect((await api('/templates', { token: customer.token })).status).toBe(200);

    // 고객사 쪽 감사 로그에 남는다
    const logs = await api('/audit-logs?action=platform_admin.', { token: customer.token });
    expect(logs.body.rows.map((x: any) => x.action)).toContain('platform_admin.tenant_plan.update');

    // 결제가 아니므로 결제·구독 기록은 만들지 않는다
    const history = await api('/billing/history', { token: customer.token });
    expect(history.body.currentSubscription).toBeNull();
    expect(history.body.payments).toEqual([]);
  });

  it('플랫폼 관리자가 되돌리는 것도 된다 — Starter 로 내리면 Pro 기능이 다시 닫힌다', async () => {
    const r = await api(`/platform-admin/tenants/${tenantId}/plan`, {
      method: 'PATCH',
      token: platform.token,
      json: { plan: 'starter', billingStatus: 'active' },
    });
    expect(r.status).toBe(200);
    expect((await currentUser(customer.token)).body.plan).toBe('starter');
    expect((await api('/templates', { token: customer.token })).status).toBe(403);
  });
});

describe.runIf(mode === 'external')('결제를 켠 서버 — 요금제는 서명된 웹훅으로만 바뀐다', () => {
  const secret = process.env.BILLING_TEST_WEBHOOK_SECRET ?? '';
  let customer: Awaited<ReturnType<typeof createTenant>>;
  let tenantId: string;
  let before: string;

  beforeAll(async () => {
    expect(secret, 'BILLING_TEST_WEBHOOK_SECRET 에 API 와 같은 비밀키를 넣으세요').not.toBe('');
    await waitForApi();
    customer = await createTenant('bill-ext');
    tenantId = customer.user.tenantId;
    before = billingSnapshot(tenantId);
  }, 90_000);

  it('결제 시작은 결제창 주소만 돌려주고 요금제는 그대로다', async () => {
    const r = await checkout(customer.token, 'pro');
    expect(r.status).toBe(201);
    expect(r.body.upgraded).toBe(false);
    expect(r.body.checkoutUrl).toContain(`tenantSlug=${customer.slug}`);
    expect(billingSnapshot(tenantId)).toBe(before);
  });

  it('비밀키가 없거나 틀리면 401 — 아무것도 바뀌지 않는다', async () => {
    for (const s of [undefined, '', 'guess', `${secret}x`, secret.slice(0, -1)]) {
      const r = await webhook(paymentSucceeded(customer.slug, 'enterprise'), s);
      expect(r.status, String(s)).toBe(401);
      expect(r.body.code, String(s)).toBe('INVALID_WEBHOOK_SECRET');
    }
    expect(billingSnapshot(tenantId)).toBe(before);
  });

  it('맞는 비밀키의 결제 성공 웹훅이면 요금제가 바뀌고 결제사 금액으로 기록된다', async () => {
    const r = await webhook(paymentSucceeded(customer.slug, 'pro', 12_345), secret);
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);

    expect((await currentUser(customer.token)).body.plan).toBe('pro');
    const { body } = await api('/billing/history', { token: customer.token });
    expect(body.currentSubscription.plan).toBe('pro');
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0].amount).toBe(12_345);
    expect(body.payments[0].provider).toBe('testpg');
    expect(body.payments[0].metadata.mock).toBe(false);
  });
});

describe.runIf(mode === 'external-nosecret')('결제사는 정했지만 웹훅 비밀키가 없는 서버', () => {
  let customer: Awaited<ReturnType<typeof createTenant>>;
  let before: string;

  beforeAll(async () => {
    await waitForApi();
    customer = await createTenant('bill-nosecret');
    before = billingSnapshot(customer.user.tenantId);
  }, 90_000);

  it('누가 보냈는지 확인할 방법이 없으므로 어떤 웹훅도 받지 않는다', async () => {
    for (const s of [undefined, '', 'anything']) {
      const r = await webhook(paymentSucceeded(customer.slug, 'enterprise'), s);
      expect(r.status, String(s)).toBe(403);
      expect(r.body.code, String(s)).toBe('WEBHOOK_SECRET_NOT_CONFIGURED');
    }
    expect(billingSnapshot(customer.user.tenantId)).toBe(before);
  });
});

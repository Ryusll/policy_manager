import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, login, waitForApi } from './helpers';

/**
 * 결제·구독 기록 (T-17).
 *
 * 예전에는 결제가 `tenant.plan` 한 칸만 바꿨다. 누가 언제 무엇을 샀는지, 이 요금제가
 * 언제까지인지 남는 곳이 없었고 이력 테이블 셋은 만들어만 두고 쓰이지 않았다.
 *
 * 개발 환경은 `PAYMENT_PROVIDER=mock` 이라 결제가 즉시 성공한다.
 */
describe('결제·구독 기록 (T-17)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('billing');
  });

  it('결제 전에는 이력이 비어 있다', async () => {
    const { status, body } = await api('/billing/history', { token: t.token });
    expect(status).toBe(200);
    expect(body.currentSubscription).toBeNull();
    expect(body.subscriptions).toEqual([]);
    expect(body.payments).toEqual([]);
  });

  it('결제하면 구독과 결제 기록이 남는다', async () => {
    const checkout = await api('/billing/checkout', {
      method: 'POST',
      token: t.token,
      json: { targetPlan: 'pro' },
    });
    expect(checkout.status).toBe(201);
    expect(checkout.body.upgraded).toBe(true);

    const { body } = await api('/billing/history', { token: t.token });
    expect(body.currentSubscription).toBeTruthy();
    expect(body.currentSubscription.plan).toBe('pro');
    expect(body.currentSubscription.status).toBe('active');
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0].status).toBe('succeeded');
  });

  /** 요금표를 지어내 넣으면 이력이 그럴듯하게 거짓이 된다 */
  it('mock 결제는 0원으로 남고 mock 임이 표시된다', async () => {
    const { body } = await api('/billing/history', { token: t.token });
    expect(body.payments[0].amount).toBe(0);
    expect(body.payments[0].metadata.mock).toBe(true);
    expect(body.payments[0].provider).toBe('mock');
  });

  /** 구독 기간이 곧 요금제 유효기간이다 — 예전에는 플랫폼 관리자가 손으로 넣어야 했다 */
  it('요금제 유효기간이 구독 기간으로 채워진다', async () => {
    const fresh = await login(t.email, t.password, t.slug);
    expect(fresh.body.user.plan).toBe('pro');
    expect(fresh.body.user.planExpiresAt).toBeTruthy();

    const { body } = await api('/billing/history', { token: fresh.body.accessToken });
    expect(new Date(body.currentSubscription.currentPeriodEnd).toISOString()).toBe(
      new Date(fresh.body.user.planExpiresAt).toISOString(),
    );
  });

  /** 새로 만들면 이력이 쪼개져 언제부터 써 왔는지 알 수 없게 된다 */
  it('같은 요금제를 다시 사면 구독을 연장한다', async () => {
    const before = await api('/billing/history', { token: t.token });
    const subId = before.body.currentSubscription.id;

    await api('/billing/checkout', { method: 'POST', token: t.token, json: { targetPlan: 'pro' } });

    const after = await api('/billing/history', { token: t.token });
    expect(after.body.currentSubscription.id).toBe(subId);
    expect(after.body.subscriptions).toHaveLength(1);
    // 결제 기록은 매번 쌓인다
    expect(after.body.payments.length).toBe(before.body.payments.length + 1);
  });

  /** 활성 구독이 둘이면 어느 쪽이 유효한지 판단할 근거가 없다 */
  it('요금제를 바꾸면 이전 구독을 닫고 새로 연다', async () => {
    const before = await api('/billing/history', { token: t.token });
    const oldId = before.body.currentSubscription.id;

    await api('/billing/checkout', {
      method: 'POST',
      token: t.token,
      json: { targetPlan: 'enterprise' },
    });

    const { body } = await api('/billing/history', { token: t.token });
    expect(body.currentSubscription.plan).toBe('enterprise');
    expect(body.currentSubscription.id).not.toBe(oldId);

    const active = body.subscriptions.filter((s: any) => s.status === 'active');
    expect(active).toHaveLength(1);
    const old = body.subscriptions.find((s: any) => s.id === oldId);
    expect(old.status).toBe('canceled');
    expect(old.canceledAt).toBeTruthy();
  });

  it('요금제 변경이 감사 로그에 금액·기간과 함께 남는다', async () => {
    const { body } = await api('/audit-logs?action=tenant.', { token: t.token });
    const row = body.rows.find((r: any) => r.action === 'tenant.plan_changed');
    expect(row).toBeTruthy();
    const detail = await api(`/audit-logs/${row.id}`, { token: t.token });
    expect(detail.body.details.provider).toBe('mock');
    expect(detail.body.details.periodEnd).toBeTruthy();
  });

  describe('격리·권한', () => {
    it('남의 회사 이력은 보이지 않는다', async () => {
      const other = await createTenant('billing-b');
      const { body } = await api('/billing/history', { token: other.token });
      expect(body.payments).toEqual([]);
      expect(body.currentSubscription).toBeNull();
    });

    it('editor 는 이력을 볼 수 없다', async () => {
      const email = `editor-${t.slug}@example.test`;
      await api('/users', {
        method: 'POST',
        token: t.token,
        json: { email, password: t.password, name: '편집자', role: 'editor' },
      });
      const r = await login(email, t.password, t.slug);
      const { status } = await api('/billing/history', { token: r.body.accessToken });
      expect(status).toBe(403);
    });
  });
});

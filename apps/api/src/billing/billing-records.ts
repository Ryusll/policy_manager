/**
 * 결제·구독 기록 계산 (T-17).
 *
 * 지금까지 결제는 `tenant.plan` 한 칸만 바꿨다. 누가 언제 무엇을 샀는지, 이 요금제가
 * 언제까지인지 남는 곳이 없었고, `BillingCustomer`·`BillingSubscription`·`BillingPayment`
 * 세 테이블은 만들어만 두고 한 번도 쓰이지 않았다([ADR-0004](../../../docs)).
 *
 * DB 쓰기와 분리해 둔 이유는 **기간 계산이 조용히 틀리기 쉬워서**다.
 */

export type PlanTierName = 'starter' | 'pro' | 'enterprise';

export type BillingPeriod = { start: Date; end: Date };

/**
 * 다음 청구 기간. 기본 한 달.
 *
 * `setMonth` 를 그대로 쓰면 **1월 31일 + 1개월 = 3월 3일**이 된다(2월에 31일이 없어서
 * 넘쳐 흐른다). 청구 기간이 이러면 2월 한 달이 통째로 사라진다. 말일을 넘기면
 * 그 달의 마지막 날로 붙인다.
 */
export function nextPeriod(from: Date, months = 1): BillingPeriod {
  const start = new Date(from.getTime());
  const day = start.getUTCDate();

  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDayOfEndMonth = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
  ).getUTCDate();
  end.setUTCDate(Math.min(day, lastDayOfEndMonth));
  end.setUTCHours(
    start.getUTCHours(),
    start.getUTCMinutes(),
    start.getUTCSeconds(),
    start.getUTCMilliseconds(),
  );

  return { start, end };
}

export type SubscriptionSnapshot = {
  id: string;
  plan: PlanTierName;
  status: 'active' | 'trial' | 'canceled' | 'expired';
};

export type SubscriptionTransition =
  | { kind: 'create' }
  | { kind: 'extend'; subscriptionId: string }
  | { kind: 'replace'; cancelSubscriptionId: string };

/**
 * 기존 구독을 어떻게 할지 정한다.
 *
 * 같은 요금제를 다시 사면 **연장**이다(구독을 새로 만들면 이력이 쪼개져, 언제부터
 * 써 왔는지 알 수 없게 된다). 요금제가 바뀌면 이전 것을 닫고 새로 연다 —
 * 한 테넌트에 활성 구독이 둘이면 어느 쪽이 유효한지 판단할 근거가 없다.
 */
export function planSubscriptionTransition(
  current: SubscriptionSnapshot | null,
  targetPlan: PlanTierName,
): SubscriptionTransition {
  if (!current) return { kind: 'create' };
  if (current.status !== 'active' && current.status !== 'trial') return { kind: 'create' };
  if (current.plan === targetPlan) return { kind: 'extend', subscriptionId: current.id };
  return { kind: 'replace', cancelSubscriptionId: current.id };
}

/**
 * 결제 기록에 남길 금액.
 *
 * mock 결제는 **실제로 돈이 오가지 않는다**. 요금표를 지어내 넣으면 이력이 그럴듯하게
 * 거짓이 되므로 0으로 남기고 metadata 에 mock 임을 적는다. 실 PG 를 붙이면 결제사가
 * 알려 준 금액을 그대로 쓴다(요금 정책 확정은 D-03).
 */
export function resolvePaymentAmount(
  provider: string,
  webhookAmount: unknown,
): { amount: number; mock: boolean } {
  if (provider === 'mock') return { amount: 0, mock: true };
  const n = Number(webhookAmount);
  return { amount: Number.isFinite(n) && n >= 0 ? Math.round(n) : 0, mock: false };
}

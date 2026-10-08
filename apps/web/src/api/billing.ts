import client from './client';

export type BillingSubscription = {
  id: string;
  plan: 'starter' | 'pro' | 'enterprise';
  status: 'active' | 'trial' | 'canceled' | 'expired';
  provider: string;
  startedAt: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
};

export type BillingPayment = {
  id: string;
  provider: string;
  amount: number;
  currency: string;
  status: 'succeeded' | 'failed' | 'refunded';
  paidAt: string | null;
  createdAt: string;
  /** `mock: true` 면 실제로 돈이 오가지 않은 기록이다 (T-17) */
  metadata: { source?: string; targetPlan?: string; mock?: boolean } | null;
};

export type BillingHistory = {
  currentSubscription: BillingSubscription | null;
  subscriptions: BillingSubscription[];
  payments: BillingPayment[];
};

/**
 * 결제 시작(`POST /billing/checkout`)은 부르지 않는다 — 가격 확정 전에는 요금제를 통합 관리의
 * 플랫폼 관리자만 바꾼다(T-125). 실 PG 를 붙일 때 다시 연다.
 */
export const billingApi = {
  history: (): Promise<BillingHistory> => client.get('/billing/history').then((r) => r.data),
};

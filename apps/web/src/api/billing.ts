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

export const billingApi = {
  checkout: (targetPlan: 'pro' | 'enterprise') =>
    client.post('/billing/checkout', { targetPlan }).then((r) => r.data),
  history: (): Promise<BillingHistory> => client.get('/billing/history').then((r) => r.data),
};

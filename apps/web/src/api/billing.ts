import client from './client';

export const billingApi = {
  checkout: (targetPlan: 'pro' | 'enterprise') =>
    client.post('/billing/checkout', { targetPlan }).then((r) => r.data),
};

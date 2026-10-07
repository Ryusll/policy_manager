import client from './client';

export type CreateTenantPayload = {
  name: string;
  slug: string;
  plan: 'starter' | 'pro' | 'enterprise';
  masterEmail: string;
  masterName: string;
};

export type CreateTenantResult = {
  tenant: { id: string; name: string; slug: string; plan: string };
  master: { id: string; email: string; name: string };
  /** 한 번만 온다 — 서버는 저장하지 않는다 */
  temporaryPassword: string;
};

export const platformAdminApi = {
  /** 고객사 개설 + 마스터 계정 발급 (T-122) */
  createTenant: (data: CreateTenantPayload): Promise<CreateTenantResult> =>
    client.post('/platform-admin/tenants', data).then((r) => r.data),
  listTenants: (q = '') =>
    client.get('/platform-admin/tenants', { params: q ? { q } : undefined }).then((r) => r.data),
  listTenantUsers: (tenantId: string) =>
    client.get(`/platform-admin/tenants/${tenantId}/users`).then((r) => r.data),
  updateTenantPlan: (tenantId: string, data: any) =>
    client.patch(`/platform-admin/tenants/${tenantId}/plan`, data).then((r) => r.data),
  updateTenantUserRole: (tenantId: string, userId: string, data: any) =>
    client.patch(`/platform-admin/tenants/${tenantId}/users/${userId}/role`, data).then((r) => r.data),
  updatePlatformRole: (userId: string, data: any) =>
    client.patch(`/platform-admin/users/${userId}/platform-role`, data).then((r) => r.data),
  updateBranding: (data: {
    legalName?: string;
    registrationNo?: string | null;
    productLabel?: string;
    logoDataUrl?: string | null;
    lockupImageSrc?: string;
  }) => client.patch('/platform-admin/branding', data).then((r) => r.data),
};


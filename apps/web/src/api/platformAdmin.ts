import client from './client';

export const platformAdminApi = {
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


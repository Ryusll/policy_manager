import client from './client';

export type PolicyTemplate = {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  isActive: boolean;
  layoutJson: Record<string, unknown>;
  cssText: string;
  createdAt: string;
  updatedAt: string;
};

export type TemplateRevision = {
  id: string;
  action: string;
  createdAt: string;
  user?: { id: string; name: string; email: string } | null;
  details?: any;
};

export const templatesApi = {
  list: (): Promise<PolicyTemplate[]> => client.get('/templates').then((r) => r.data),
  get: (id: string): Promise<PolicyTemplate> => client.get(`/templates/${id}`).then((r) => r.data),
  create: (data: Partial<PolicyTemplate> & { name: string; layoutJson: Record<string, unknown> }) =>
    client.post('/templates', data).then((r) => r.data),
  update: (id: string, data: Partial<PolicyTemplate>) => client.put(`/templates/${id}`, data).then((r) => r.data),
  delete: (id: string) => client.delete(`/templates/${id}`),
  clone: (id: string, name?: string) => client.post(`/templates/${id}/clone`, { name }).then((r) => r.data),
  setDefault: (id: string) => client.post(`/templates/${id}/set-default`).then((r) => r.data),
  revisions: (id: string): Promise<TemplateRevision[]> => client.get(`/templates/${id}/revisions`).then((r) => r.data),
  /**
   * 이력 복원 (T-58). 스냅샷을 보내지 않고 **이력 id 만** 넘긴다 —
   * 무엇을 복원했는지와 실제로 들어간 내용이 서버 한 곳에서 정해져야 기록이 어긋나지 않는다.
   */
  restore: (id: string, revisionId: string): Promise<PolicyTemplate> =>
    client.post(`/templates/${id}/restore`, { revisionId }).then((r) => r.data),
};

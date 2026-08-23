import client from './client';

export type AuditLogRow = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  /** 목록에는 `details` 본문이 없다 — 무엇이 담겼는지만 알려 준다 (T-11) */
  hasDetails: boolean;
  keys: string[];
  user: { id: string; email: string; name: string } | null;
};

export type AuditLogPage = {
  rows: AuditLogRow[];
  total: number;
  page: number;
  limit: number;
};

export type AuditLogFilter = {
  action?: string;
  userId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
};

export type AuditActor = { id: string; email: string; name: string };

export const auditLogsApi = {
  list: (filter: AuditLogFilter = {}): Promise<AuditLogPage> => {
    // 빈 값은 아예 보내지 않는다. 서버가 무시하긴 하지만 주소창이 지저분해진다.
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== null && String(v) !== '') params[k] = String(v);
    }
    return client.get('/audit-logs', { params }).then((r) => r.data);
  },
  /** 목록에서 뺀 `details` 본문 */
  get: (id: string) => client.get(`/audit-logs/${id}`).then((r) => r.data),
  actions: (): Promise<{ action: string; count: number }[]> =>
    client.get('/audit-logs/actions').then((r) => r.data),
  actors: (): Promise<AuditActor[]> => client.get('/audit-logs/actors').then((r) => r.data),
};

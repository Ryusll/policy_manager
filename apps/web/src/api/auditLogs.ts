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
  /** 이 기록이 정정한 원 기록(T-178) */
  correctsId: string | null;
  /** 이 기록을 정정한 기록 수(T-178) */
  correctedCount: number;
};

/** 정정 사슬의 한 고리(T-178) */
export type AuditLink = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  user: { id: string; email: string; name: string } | null;
};

export type AuditLogDetail = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  details: unknown;
  correctsId: string | null;
  user: { id: string; email: string; name: string } | null;
  /** 이 기록이 정정한 원 기록 */
  corrects: AuditLink | null;
  /** 이 기록을 정정한 기록들 — 정정 사유와 함께 */
  correctedBy: (AuditLink & { reason: string | null })[];
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
  /** 한 대상의 기록만(T-178) — 정확히 일치 */
  entityType?: string;
  entityId?: string;
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
  get: (id: string): Promise<AuditLogDetail> => client.get(`/audit-logs/${id}`).then((r) => r.data),
  actions: (): Promise<{ action: string; count: number }[]> =>
    client.get('/audit-logs/actions').then((r) => r.data),
  actors: (): Promise<AuditActor[]> => client.get('/audit-logs/actors').then((r) => r.data),
};

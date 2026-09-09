import client from './client';

export type ImportIssue = {
  level: 'error' | 'warning';
  /** 몇 번째 규정인지(0부터). 전체에 걸린 문제는 null */
  policyIndex: number | null;
  code: string | null;
  message: string;
};

export type ImportValidateResult = {
  issues: ImportIssue[];
  canImport: boolean;
  summary: { policies: number; chapters: number; articles: number };
};

export type BulkImportBody = { policies: unknown[] };

export const adminApi = {
  /** 넣기 전에 전부 훑어 문제를 모아 돌려준다 (T-13) */
  validateImport: (body: BulkImportBody): Promise<ImportValidateResult> =>
    client.post('/admin/import/policies/validate', body).then((r) => r.data),
  importPolicies: (body: BulkImportBody): Promise<{ ok: boolean; importedPolicies: number; policyIds: string[] }> =>
    client.post('/admin/import/policies', body).then((r) => r.data),
};

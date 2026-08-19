import client from './client';

/** 규정 체계도 노드 (T-71). 규정 > 세칙 > 지침을 자기참조 트리로 표현한다. */
export type PolicyTreeNode = {
  id: string;
  code: string;
  title: string;
  isActive: boolean;
  parentId: string | null;
  effectiveDate: string | null;
  _count?: { chapters: number };
  children: PolicyTreeNode[];
};

export const policiesApi = {
  list: () => client.get('/policies').then((r) => r.data),
  get: (id: string) => client.get('/policies/' + id).then((r) => r.data),
  /** 규정 체계도 — 상위·하위 트리 (T-71) */
  hierarchy: (): Promise<{ roots: PolicyTreeNode[]; total: number }> =>
    client.get('/policies/hierarchy').then((r) => r.data),
  create: (data: any) => client.post('/policies', data).then((r) => r.data),
  update: (id: string, data: any) => client.put('/policies/' + id, data).then((r) => r.data),
  delete: (id: string) => client.delete('/policies/' + id),

  createChapter: (policyId: string, data: any) =>
    client.post('/policies/' + policyId + '/chapters', data).then((r) => r.data),
  updateChapter: (policyId: string, chapterId: string, data: any) =>
    client.put('/policies/' + policyId + '/chapters/' + chapterId, data).then((r) => r.data),
  deleteChapter: (policyId: string, chapterId: string) =>
    client.delete('/policies/' + policyId + '/chapters/' + chapterId),

  // 절(節) — 선택 계층
  createSection: (policyId: string, chapterId: string, data: any) =>
    client
      .post('/policies/' + policyId + '/chapters/' + chapterId + '/sections', data)
      .then((r) => r.data),
  updateSection: (policyId: string, chapterId: string, sectionId: string, data: any) =>
    client
      .put('/policies/' + policyId + '/chapters/' + chapterId + '/sections/' + sectionId, data)
      .then((r) => r.data),
  deleteSection: (policyId: string, chapterId: string, sectionId: string) =>
    client.delete('/policies/' + policyId + '/chapters/' + chapterId + '/sections/' + sectionId),

  createArticle: (policyId: string, chapterId: string, data: any) =>
    client
      .post('/policies/' + policyId + '/chapters/' + chapterId + '/articles', data)
      .then((r) => r.data),
  updateArticle: (policyId: string, chapterId: string, articleId: string, data: any) =>
    client
      .put('/policies/' + policyId + '/chapters/' + chapterId + '/articles/' + articleId, data)
      .then((r) => r.data),
  deleteArticle: (policyId: string, chapterId: string, articleId: string) =>
    client.delete('/policies/' + policyId + '/chapters/' + chapterId + '/articles/' + articleId),

  createAppendix: (policyId: string, data: any) =>
    client.post('/policies/' + policyId + '/appendices', data).then((r) => r.data),
  updateAppendix: (policyId: string, appendixId: string, data: any) =>
    client.put('/policies/' + policyId + '/appendices/' + appendixId, data).then((r) => r.data),
  deleteAppendix: (policyId: string, appendixId: string) =>
    client.delete('/policies/' + policyId + '/appendices/' + appendixId),
  listImportLogs: () => client.get('/policies/import-logs').then((r) => r.data),
  createImportLog: (data: any) => client.post('/policies/import-logs', data).then((r) => r.data),

  // 제정·개정 이유(개정문)
  listRevisionReasons: (policyId: string) =>
    client.get('/policies/' + policyId + '/revision-reasons').then((r) => r.data),
  createRevisionReason: (policyId: string, data: RevisionReasonInput) =>
    client.post('/policies/' + policyId + '/revision-reasons', data).then((r) => r.data),
  updateRevisionReason: (policyId: string, reasonId: string, data: RevisionReasonInput) =>
    client
      .put('/policies/' + policyId + '/revision-reasons/' + reasonId, data)
      .then((r) => r.data),
  deleteRevisionReason: (policyId: string, reasonId: string) =>
    client.delete('/policies/' + policyId + '/revision-reasons/' + reasonId),

  // 시점(as-of) 조회
  effectiveDates: (policyId: string): Promise<string[]> =>
    client.get('/policies/' + policyId + '/effective-dates').then((r) => r.data),
  getAsOf: (policyId: string, date: string) =>
    client.get('/policies/' + policyId + '/as-of', { params: { date } }).then((r) => r.data),

  /** 신구조문대비표 — 두 시점 본문을 조문 단위로 대비 */
  compare: (policyId: string, from: string, to: string): Promise<PolicyComparison> =>
    client.get('/policies/' + policyId + '/compare', { params: { from, to } }).then((r) => r.data),

  exportPdf: (policyId: string, data: ExportPdfInput): Promise<Blob> =>
    client
      .post('/policies/' + policyId + '/export/pdf', data, { responseType: 'blob' })
      .then((r) => r.data),
};

export type PolicyRevisionKind = 'enactment' | 'amendment' | 'full_amendment' | 'repeal';

export type RevisionReasonInput = {
  kind?: PolicyRevisionKind;
  label?: string;
  reason?: string;
  summary?: string | null;
  promulgatedDate?: string | null;
  effectiveDate?: string | null;
};

export type PolicyRevisionReason = {
  id: string;
  kind: PolicyRevisionKind;
  label: string;
  reason: string;
  summary: string | null;
  promulgatedDate: string | null;
  effectiveDate: string | null;
  createdAt: string;
};

export type CompareKind = 'added' | 'removed' | 'changed' | 'same';

export type CompareDiffPart = { value: string; added?: boolean; removed?: boolean };

export type CompareSide = { title: string; content: string; effectiveDate: string | null };

export type CompareRow = {
  articleId: string;
  number: number;
  clauseNumber: number | null;
  itemNumber: number | null;
  kind: CompareKind;
  before: CompareSide | null;
  after: CompareSide | null;
  diff: CompareDiffPart[] | null;
  titleChanged: boolean;
};

export type PolicyComparison = {
  policy: { id: string; code: string; title: string };
  from: string;
  to: string;
  summary: { added: number; removed: number; changed: number; same: number };
  rows: CompareRow[];
};

export type ExportPdfInput = {
  html: string;
  title?: string;
  metaLine?: string;
  footerText?: string;
  pageNumbers?: boolean;
};

export const versionsApi = {
  list: (articleId: string) => client.get('/articles/' + articleId + '/versions').then((r) => r.data),
  get: (id: string) => client.get('/versions/' + id).then((r) => r.data),
  create: (articleId: string, data: any) =>
    client.post('/articles/' + articleId + '/versions', data).then((r) => r.data),
  update: (id: string, data: any) => client.put('/versions/' + id, data).then((r) => r.data),
  submit: (id: string) => client.post('/versions/' + id + '/submit').then((r) => r.data),
  approve: (id: string, data: { changeNote: string; effectiveDate?: string }) =>
    client.post('/versions/' + id + '/approve', data).then((r) => r.data),
  reject: (id: string) => client.post('/versions/' + id + '/reject').then((r) => r.data),
  diff: (v1: string, v2: string) =>
    client.get('/versions/diff', { params: { v1, v2 } }).then((r) => r.data),
};

export const variablesApi = {
  list: () => client.get('/variables').then((r) => r.data),
  get: (id: string) => client.get('/variables/' + id).then((r) => r.data),
  create: (data: any) => client.post('/variables', data).then((r) => r.data),
  update: (id: string, data: any) => client.put('/variables/' + id, data).then((r) => r.data),
  delete: (id: string) => client.delete('/variables/' + id),
};

export const filesApi = {
  list: (policyId: string) =>
    client.get('/policies/' + policyId + '/files').then((r) => r.data),
  upload: (policyId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return client.post('/policies/' + policyId + '/files', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  download: (policyId: string, filename: string) =>
    `/api/policies/${policyId}/files/${filename}`,
  delete: (policyId: string, filename: string) =>
    client.delete('/policies/' + policyId + '/files/' + filename),
};

export const searchApi = {
  search: (q: string, page = 1) =>
    client.get('/search', { params: { q, page } }).then((r) => r.data),
  relatedPreview: (
    type: 'precedent' | 'law' | 'rule',
    q: string,
    limit = 5,
    sort: 'relevance' | 'latest' = 'relevance',
    scope: 'title' | 'fulltext' = 'fulltext',
  ) =>
    client.get('/search/related-preview', { params: { type, q, limit, sort, scope } }).then((r) => r.data),
};

export const commentsApi = {
  list: (articleId: string) => client.get('/articles/' + articleId + '/comments').then((r) => r.data),
  create: (articleId: string, data: { content: string }) =>
    client.post('/articles/' + articleId + '/comments', data).then((r) => r.data),
  update: (id: string, data: { isResolved: boolean }) =>
    client.patch('/comments/' + id, data).then((r) => r.data),
};
import client from './client';

/** 규정 체계도 노드 (T-71). 규정 > 세칙 > 지침을 자기참조 트리로 표현한다. */
export type ThreeWayArticle = {
  id: string;
  number: number;
  branchNumber?: number | null;
  clauseNumber: number | null;
  itemNumber: number | null;
  title: string;
  content: string;
};

export type ThreeWayRow = {
  number: number | null;
  base: ThreeWayArticle | null;
  related: { policyId: string; level: number; article: ThreeWayArticle }[];
};

export type ThreeWayResult = {
  base: { id: string; code: string; title: string };
  levels: { id: string; code: string; title: string; level: number }[];
  rows: ThreeWayRow[];
  unmatched: ThreeWayRow[];
  summary: { baseArticles: number; related: number; unmatched: number };
  /** 기준일(YYYY-MM-DD, 한국 날짜) — 이 날 시행 중인 본문끼리 짝지었다(T-127) */
  date?: string;
};

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
  /** 3단비교 — 규정·세칙·지침 (T-56) */
  threeWay: (id: string): Promise<ThreeWayResult> =>
    client.get('/policies/' + id + '/three-way').then((r) => r.data),
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
  /** 조 순서 일괄 재정렬 (T-60). `order` 는 문서에 나타날 차례대로, 규정의 모든 조를 한 번씩 */
  reorderArticles: (policyId: string, order: { chapterId: string; jo: number; branch?: number }[]) =>
    client.put(`/policies/${policyId}/jo-order`, { order }).then((r) => r.data as { changed: number }),

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
  compareWith: (policyId: string, targetId: string): Promise<CrossPolicyComparison> =>
    client
      .get('/policies/' + policyId + '/compare-with', { params: { targetId } })
      .then((r) => r.data),

  /**
   * 한/글 내보내기 (T-85). 확장자가 `.hwpx` 인 이유는 `.hwp` 가 한컴 독점 바이너리라
   * 서버에서 만들 수 없어서다 — `.hwpx` 는 같은 한/글이 여는 표준이다(ADR-0016).
   */
  exportHwpx: (policyId: string, data: { html: string; title?: string }): Promise<Blob> =>
    client
      .post('/policies/' + policyId + '/export/hwpx', data, { responseType: 'blob' })
      .then((r) => r.data),

  exportPdf: (policyId: string, data: ExportPdfInput): Promise<Blob> =>
    client
      .post('/policies/' + policyId + '/export/pdf', data, { responseType: 'blob' })
      .then((r) => r.data),
};

/** 시점 조회에서 그날 폐지돼 있어 뺀 조문 (`asOf.repealedArticles`, T-126) */
export type AsOfRepealedArticle = {
  id: string;
  number: number;
  branchNumber: number | null;
  clauseNumber: number | null;
  itemNumber: number | null;
  title: string | null;
  /** 폐지 시행일 (YYYY-MM-DD) */
  repealedOn: string;
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

/** 규정 간 비교 (T-91) — 서로 다른 두 규정을 조문 위치로 맞댄 결과 */
export type CrossPolicyKind = 'same' | 'different' | 'left-only' | 'right-only';

export type CrossPolicyRow = {
  key: string;
  number: number;
  branchNumber?: number | null;
  clauseNumber: number | null;
  itemNumber: number | null;
  kind: CrossPolicyKind;
  left: { title: string; content: string } | null;
  right: { title: string; content: string } | null;
  diff: CompareDiffPart[] | null;
  /** 번호는 같은데 제목이 다르다 — 번호로 맞춘 짝이 의심스럽다는 신호 */
  titleDiffers: boolean;
};

/** 규정 상세의 `current.scheduledArticles` — 시행 예정인데 오늘 그 자리를 다른 조문이 쓰고 있어 본문 목록에서 뺀 조문(T-127) */
export type PolicyScheduledArticle = {
  id: string;
  number: number;
  branchNumber: number | null;
  clauseNumber: number | null;
  itemNumber: number | null;
  title: string;
  liveChapterId: string;
  effectiveDate: string | null;
};

export type CrossPolicyComparison = {
  left: { id: string; code: string; title: string };
  right: { id: string; code: string; title: string };
  summary: { same: number; different: number; leftOnly: number; rightOnly: number; suspect: number };
  rows: CrossPolicyRow[];
  /** 기준일(YYYY-MM-DD, 한국 날짜) — 이 날 시행 중인 본문끼리 비교했다(T-127) */
  date?: string;
};

export type CompareKind = 'added' | 'removed' | 'changed' | 'same';

export type CompareDiffPart = { value: string; added?: boolean; removed?: boolean };

export type CompareSide = { title: string; content: string; effectiveDate: string | null };

export type CompareRow = {
  articleId: string;
  number: number;
  branchNumber?: number | null;
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
  /** 반려 — 사유 필수. 사유 없이 되돌리면 편집자는 왜 반려됐는지 알 수 없다 (T-10) */
  reject: (id: string, reason: string) =>
    client.post('/versions/' + id + '/reject', { reason }).then((r) => r.data),
  /** 폐지 — 응답의 `remainingPublished` 가 0이면 이 조문에 게시본이 없다 (T-10) */
  /** 게시본 폐지 — 폐지 시행일은 서버가 오늘(한국 날짜)로 정한다(T-126) */
  archive: (id: string): Promise<{ remainingPublished: number; repealedOn: string }> =>
    client.post('/versions/' + id + '/archive').then((r) => r.data),
  diff: (v1: string, v2: string) =>
    client.get('/versions/diff', { params: { v1, v2 } }).then((r) => r.data),
  /** 시행된 적 없는 조문의 초안을 한꺼번에 시행 (관리자). 이미 시행 중인 조문의 개정 초안은 제외 */
  publishDrafts: (
    policyId: string,
    data: { changeNote: string; effectiveDate: string },
  ): Promise<{ published: number }> =>
    client.post('/policies/' + policyId + '/publish-drafts', data).then((r) => r.data),
  /** 시행일 없이 발행된 버전에 확인한 시행일 넣기 (관리자, 예전 가져오기 데이터 보정) */
  fillEffectiveDate: (policyId: string, data: { effectiveDate: string; reason: string }): Promise<{ updated: number }> =>
    client.post('/policies/' + policyId + '/fill-effective-date', data).then((r) => r.data),
};

/** 변수 값 — 유효기간 [시작, 종료), 비어 있으면 처음부터·끝 없음 (T-109) */
export type VariableValueRow = {
  id: string;
  value: string;
  validFrom: string | null;
  validTo: string | null;
  /** false 면 옛 기본값을 옮긴 값 — 기간을 정하기 전에는 쓰지 않는다 */
  periodConfirmed: boolean;
  note: string | null;
  /** 같은 변수의 다른 값과 기간이 겹친다 */
  overlapping: boolean;
};

export type VariablePickReason = 'none' | 'ambiguous' | 'unconfirmed';

export type VariableRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  values: VariableValueRow[];
  /** 오늘 쓸 값 — 없으면 currentReason */
  current: { id: string; value: string } | null;
  currentReason: VariablePickReason | null;
  /** 기간 겹침·기간 미확정 값이 있다 */
  needsReview: boolean;
  /** 지금 시행 중인 본문의 연결 수(다시 이어야 하는 것 포함) */
  bindingCount?: number;
};

export type VariableBindingState = 'active' | 'needs_review' | 'released';

/** 변수 연결 — 조문 버전 본문의 한 구간 [start, end) (T-109) */
export type VariableBindingRow = {
  id: string;
  variableId: string;
  articleId: string;
  versionId: string;
  start: number;
  end: number;
  text: string;
  contextBefore: string;
  contextAfter: string;
  occurrence: number;
  origin: 'manual' | 'marker' | 'legacy' | 'inherited';
  state: VariableBindingState;
  reviewReason: string | null;
  valueId: string | null;
  variable?: { id: string; key: string; label: string };
};

export type VariableDetail = VariableRow & {
  bindings: Array<
    VariableBindingRow & {
      versionNum: number;
      effectiveDate: string | null;
      policy: { id: string; code: string; title: string };
      article: { label: string; title: string };
    }
  >;
};

export const VARIABLE_PICK_REASON_LABEL: Record<VariablePickReason, string> = {
  none: '오늘 맞는 값 없음',
  ambiguous: '기간이 겹쳐 고를 수 없음',
  unconfirmed: '기간 미확정',
};

export const BINDING_REVIEW_REASON_LABEL: Record<string, string> = {
  span_changed: '문구가 바뀌어 자리를 찾지 못함',
  legacy_unmatched: '옛 사용 기록 — 본문에 표식 없음',
  position_unverified: '옛 사용 기록 — 위치 확인 필요',
};

export const variablesApi = {
  list: (): Promise<VariableRow[]> => client.get('/variables').then((r) => r.data),
  get: (id: string): Promise<VariableDetail> => client.get('/variables/' + id).then((r) => r.data),
  create: (data: { key: string; label: string; description?: string; value?: string; validFrom?: string }) =>
    client.post('/variables', data).then((r) => r.data),
  update: (id: string, data: { label?: string; description?: string }) => client.put('/variables/' + id, data).then((r) => r.data),
  delete: (id: string) => client.delete('/variables/' + id),
  addValue: (id: string, data: { value: string; validFrom?: string | null; validTo?: string | null; note?: string }) =>
    client.post(`/variables/${id}/values`, data).then((r) => r.data),
  updateValue: (
    id: string,
    valueId: string,
    data: { value?: string; validFrom?: string | null; validTo?: string | null; note?: string; confirmPeriod?: boolean },
  ) => client.put(`/variables/${id}/values/${valueId}`, data).then((r) => r.data),
  deleteValue: (id: string, valueId: string) => client.delete(`/variables/${id}/values/${valueId}`).then((r) => r.data),
  versionBindings: (versionId: string): Promise<VariableBindingRow[]> =>
    client.get(`/versions/${versionId}/variable-bindings`).then((r) => r.data),
  bind: (versionId: string, data: { variableId: string; start: number; end: number; text: string }) =>
    client.post(`/versions/${versionId}/variable-bindings`, data).then((r) => r.data),
  release: (bindingId: string) => client.delete(`/variable-bindings/${bindingId}`).then((r) => r.data),
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
  /**
   * 첨부파일 내용을 로그인 정보와 함께 받는다. 서버는 토큰을 헤더로만 받으므로
   * `<a href>`로 바로 열면 401이 난다 — 받아서 브라우저 안에서 연다.
   */
  fetchBlob: (policyId: string, filename: string): Promise<Blob> =>
    client
      .get('/policies/' + policyId + '/files/' + encodeURIComponent(filename), { responseType: 'blob' })
      .then((r) => r.data),
  delete: (policyId: string, filename: string) =>
    client.delete('/policies/' + policyId + '/files/' + filename),
};

export type SearchSuggestResult = {
  policies: { id: string; code: string; title: string }[];
  articles: {
    id: string;
    number: number;
    branchNumber?: number | null;
    title: string;
    policyId: string;
    policyTitle: string;
  }[];
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
  /** 자동완성 — 규정명·조 제목 (T-79) */
  suggest: (q: string): Promise<SearchSuggestResult> =>
    client.get('/search/suggest', { params: { q } }).then((r) => r.data),
};

export const commentsApi = {
  list: (articleId: string) => client.get('/articles/' + articleId + '/comments').then((r) => r.data),
  create: (articleId: string, data: { content: string }) =>
    client.post('/articles/' + articleId + '/comments', data).then((r) => r.data),
  update: (id: string, data: { isResolved: boolean }) =>
    client.patch('/comments/' + id, data).then((r) => r.data),
};
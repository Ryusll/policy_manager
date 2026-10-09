import client from './client';

/**
 * 재파싱 검토(T-110) — 다시 가져온 원문을 기존 규정의 조문과 계층·내용 지문으로 맞춘 결과와 사람의 결정.
 * 비교만으로는 규정 본문이 바뀌지 않는다.
 */
export type ReparseKind = 'same' | 'moved' | 'changed' | 'ambiguous' | 'new' | 'missing';
export type ReparseDecision = 'accept' | 'amend' | 'new' | 'hold' | 'pick' | 'link' | 'keep' | 'repeal';

type Place = { number: number; branch: number | null; clause: number | null; item: number | null };

export type ReparseParsed = Place & {
  index: number;
  nodeId: string | null;
  label: string;
  title: string;
  content: string;
  fingerprint: string | null;
  renumbered: boolean;
  chapter: { index: number; number: number; title: string; hidden: boolean; storedId: string | null } | null;
  section: { index: number; number: number; title: string; storedId: string | null } | null;
};

export type ReparseStored = Place & {
  articleId: string;
  label: string;
  title: string;
  chapter: { id: string; number: number; title: string; hidden: boolean } | null;
  section: { id: string; number: number; title: string } | null;
  base: {
    versionId: string;
    status: string;
    versionNum: number | null;
    effectiveDate: string | null;
    repealedOn: string | null;
    content: string;
    fingerprint: string | null;
  } | null;
  repealed: boolean;
  pending: { versionId: string; status: string } | null;
};

export type ReparseCandidate = { articleId: string; label: string; title: string; content: string; repealed: boolean };

export type ReparseItem = {
  id: string;
  seq: number;
  kind: ReparseKind;
  articleId: string | null;
  parsed: ReparseParsed | null;
  stored: ReparseStored | null;
  candidates: ReparseCandidate[] | null;
  reasons: string[];
  changes: { content: boolean; spacingOnly: boolean; position: boolean; chapter: boolean; section: boolean; title: boolean } | null;
  recommended: boolean;
  decision: ReparseDecision | null;
  targetArticleId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  diff: { value: string; added?: boolean; removed?: boolean }[] | null;
  /** 반영·승인의 결과(T-110 ②) */
  outcome: {
    action: 'amend' | 'structure' | 'chapter' | 'create' | 'row' | 'repeal' | 'same' | 'hold' | 'keep' | 'undecided';
    versionId?: string;
    articleId?: string;
    status?: 'planned' | 'done' | 'deferred';
    repealedOn?: string;
    released?: { articleId: string };
  } | null;
  /** 이 항목이 만든 묶음 버전 */
  version: { id: string; articleId: string; versionNum: number; status: string; content: string; structure: unknown } | null;
};

export type ReparseChapterChange = {
  change: 'same' | 'renumbered' | 'renamed' | 'renumbered_renamed' | 'new' | 'missing';
  parsed: { index: number; number: number; title: string; hidden: boolean } | null;
  stored: { id: string; number: number; title: string; hidden: boolean } | null;
};

export type ReparseReview = {
  id: string;
  policyId: string;
  sessionId: string | null;
  sourceName: string;
  /** open | superseded | applied(반영 — 묶음 초안) | submitted(묶음 검토 요청) | approved | rejected */
  status: 'open' | 'superseded' | 'applied' | 'submitted' | 'approved' | 'rejected';
  algorithm: string;
  normalizer: string;
  summary: {
    counts: Record<ReparseKind, number>;
    chapters: ReparseChapterChange[];
    appendixCount: number;
    pendingConflicts: number;
  };
  createdBy: string | null;
  createdAt: string;
  /** 반영 계획 — 승인 때 만들 장·절·새 조문, 장 번호·제목 변경, 폐지 */
  plan: {
    rowUpdates?: unknown[];
    chapters: { create: { key: string; number: number; title: string }[]; update: { id: string; number: number; title: string }[] };
    sections: { create: unknown[]; update: unknown[] };
    newArticles: { itemId: string; number: number; title: string }[];
    repeals: { itemId: string; articleId: string }[];
  } | null;
  appliedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  effectiveDate: string | null;
  changeNote: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  policy: { id: string; code: string; title: string };
  /** 비교한 뒤 규정이 바뀌었다(개정·재정렬 등) */
  stale: boolean;
  /** 비교한 뒤 원문 미리보기 트리를 고쳤다 */
  sourceChanged: boolean;
  undecided: number;
  items: ReparseItem[];
};

export type ReparseReviewRow = {
  id: string;
  status: string;
  sourceName: string;
  createdAt: string;
  createdBy: string | null;
  counts: Record<ReparseKind, number>;
  undecided: number;
  deletionUndecided: number;
};

export type ReparseDecisionInput = { id: string; decision: ReparseDecision | null; targetArticleId?: string | null };

export const reparseApi = {
  compare: (sessionId: string, policyId: string): Promise<ReparseReview> =>
    client.post(`/regulation-parse/${sessionId}/reparse`, { policyId }).then((r) => r.data),
  get: (id: string): Promise<ReparseReview> => client.get(`/reparse-reviews/${id}`).then((r) => r.data),
  decide: (id: string, items: ReparseDecisionInput[]): Promise<ReparseReview> =>
    client.patch(`/reparse-reviews/${id}/decisions`, { items }).then((r) => r.data),
  listForPolicy: (policyId: string): Promise<ReparseReviewRow[]> =>
    client.get(`/policies/${policyId}/reparse-reviews`).then((r) => r.data),
  /** 반영 — 기존 조문의 묶음 초안만 만든다(지금 규정은 그대로). 새 조문·장은 승인 때 */
  apply: (id: string): Promise<ReparseReview> => client.post(`/reparse-reviews/${id}/apply`).then((r) => r.data),
  submit: (id: string): Promise<ReparseReview> => client.post(`/reparse-reviews/${id}/submit`).then((r) => r.data),
  approve: (id: string, data: { effectiveDate: string; changeNote: string }): Promise<ReparseReview> =>
    client.post(`/reparse-reviews/${id}/approve`, data).then((r) => r.data),
  reject: (id: string, reason: string): Promise<ReparseReview> =>
    client.post(`/reparse-reviews/${id}/reject`, { reason }).then((r) => r.data),
  /** 승인·반려 뒤 원문에 없는 조문 — 유지로 닫거나 오늘 폐지(관리자) */
  resolve: (id: string, itemId: string, decision: 'keep' | 'repeal'): Promise<ReparseReview> =>
    client.post(`/reparse-reviews/${id}/items/${itemId}/resolve`, { decision }).then((r) => r.data),
};

export const REPARSE_STATUS_LABEL: Record<ReparseReview['status'], string> = {
  open: '결정 중',
  superseded: '지나간 비교',
  applied: '반영함 — 묶음 검토 요청 전',
  submitted: '묶음 검토 중',
  approved: '승인함',
  rejected: '반려함',
};

/** 항목이 반영·승인에서 한 일 */
export function outcomeLabel(item: ReparseItem): string | null {
  const o = item.outcome;
  if (!o) return null;
  const v = item.version ? ` v${item.version.versionNum}` : '';
  // 묶음 버전이 어디까지 왔는지 — 초안 → 검토 중 → 시행(승인)
  const stage = item.version?.status === 'published' || item.version?.status === 'archived' ? '시행' : item.version?.status === 'review' ? '검토 중' : '초안';
  switch (o.action) {
    case 'amend':
      return `개정 ${stage}${v}`;
    case 'structure':
      return `자리 옮김 ${stage}${v}`;
    case 'chapter':
      return `장 번호·제목 변경 ${stage}${v}`;
    case 'create':
      return o.articleId ? '새 조문 만듦' : '새 조문 — 승인 때 만듦';
    case 'row':
      return o.status === 'done' ? '조 제목 행 옮김' : '조 제목 행 — 승인 때 옮김';
    case 'repeal':
      return o.status === 'done' ? `폐지함${o.repealedOn ? `(${o.repealedOn})` : ''}` : o.status === 'deferred' ? '폐지 미결 — 시행일 뒤에' : '폐지 — 승인 때';
    case 'hold':
      return '보류 — 반영 안 함';
    case 'keep':
      return '유지';
    default:
      return null;
  }
}

export const REPARSE_KIND_LABEL: Record<ReparseKind, string> = {
  same: '그대로',
  moved: '옮김',
  changed: '본문 바뀜',
  ambiguous: '판정 보류',
  new: '새 조문 후보',
  missing: '원문에 없음',
};

export const REPARSE_REASON_LABEL: Record<string, string> = {
  position: '같은 번호',
  content: '같은 본문',
  spacing: '띄어쓰기만 다름',
  parent: '상위 조가 대응됨',
  children: '하위 항이 따라옴',
  neighbor: '앞뒤 조가 같은 쪽',
  empty: '본문 없는 조',
  renumbered: '원문 번호를 다시 매김',
  repealed: '폐지된 조문',
  duplicate: '같은 본문이 여럿',
};

export const REPARSE_DECISION_LABEL: Record<ReparseDecision, string> = {
  accept: '옮김으로',
  amend: '개정으로',
  new: '새 조문으로',
  hold: '보류',
  pick: '이 조문으로',
  link: '기존 조문에 잇기',
  keep: '그대로 둠',
  repeal: '폐지',
};

/** 항목 종류마다 고를 수 있는 결정(서버 규칙과 같다) */
export const REPARSE_DECISIONS: Record<ReparseKind, ReparseDecision[]> = {
  same: [],
  moved: ['accept', 'new', 'hold'],
  changed: ['amend', 'new', 'hold'],
  ambiguous: ['pick', 'new', 'hold'],
  new: ['new', 'link', 'hold'],
  missing: ['keep', 'repeal'],
};

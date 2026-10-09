import client from './client';

/**
 * 개정 후보 (T-106). 법령 변경을 규칙으로 우리 조문에 옮긴 **초안**이다 —
 * 승인(T-108) 전까지 시행 본문은 그대로다.
 */
export type AmendmentConfidence = 'high' | 'medium' | 'low';
export type AmendmentState = 'draft' | 'review' | 'approved' | 'rejected';

export type CandidateDiffPart = { op: 'equal' | 'insert' | 'delete'; text: string };

/** 제1 조문 대비 바뀐 문자 구간 하나. 법령 근거(rationaleRefs)·변수 근거(variableRefs)가 둘 다 비면 근거 없는 변경(검토 대상) */
export type CandidateChange = {
  index: number;
  kind: 'replace' | 'insert' | 'delete';
  base: { start: number; end: number; text: string };
  candidate: { start: number; end: number; text: string };
  rationaleRefs: number[];
  /** 변수 근거(`rationale.variables[].index`, T-109 ②) — 예전 후보에는 없다 */
  variableRefs?: number[];
};

/** 변수 값 넣기 근거 하나(T-109 ②) — 연결된 자리·고른 값·유효기간·범위·넣었는지와 까닭 */
export type VariableEntry = {
  index: number;
  bindingId: string;
  variableId: string;
  key: string;
  label: string;
  valueId: string | null;
  value: string | null;
  validFrom: string | null;
  validTo: string | null;
  scope: 'tenant';
  base: { start: number; end: number; text: string };
  candidate: { start: number; end: number; text: string } | null;
  status: 'applied' | 'unchanged' | 'held' | 'conflict';
  reason: 'none' | 'ambiguous' | 'unconfirmed' | 'span_mismatch' | 'law_conflict' | null;
};

export const VARIABLE_HOLD_LABEL: Record<string, string> = {
  none: '그 날 맞는 값이 없어 넣지 않음',
  ambiguous: '값의 기간이 겹쳐 넣지 않음',
  unconfirmed: '값의 기간이 정해지지 않아 넣지 않음',
  span_mismatch: '연결된 문구가 기준 본문과 달라 넣지 않음',
  law_conflict: '법령 개정과 같은 자리라 원문을 둠',
};

/** 지금 판 기준의 표시 — 생성 때의 신뢰도·검토 표시와 따로 계산한다 */
export type CurrentState = { revision: number; hasChanges: boolean; unexplained: number; edited: boolean };

export type RuleApplication = {
  id: number;
  ruleId: string;
  templateId: string;
  lawChangeIndexes: number[];
  base: { start: number; end: number; text: string };
  candidate: { start: number; end: number; text: string };
};

export type LawTextChange = {
  index: number;
  kind: 'value' | 'term' | 'sentence' | 'insert' | 'delete' | 'reference';
  before: string;
  after: string;
};

export type UnmappedLawChange = { lawChangeIndex: number; reason: string; detail?: string };

export type AmendmentCandidate = {
  id: string;
  articleId: string;
  changeEventId: string;
  reviewState: AmendmentState;
  revision: number;
  lockVersion: number;
  current: CurrentState;
  confidence: AmendmentConfidence;
  reviewFlags: string[];
  asOf: string;
  /** 예정 사내 시행일 — 변수 값을 고른 날(T-109 ②) */
  plannedEffectiveDate: string;
  createdBy: string | null;
  createdAt: string;
  baseVersion: { id: string; versionNum: number; effectiveDate: string | null; content: string };
  candidateContent: string;
  rationale: {
    lawChanges: LawTextChange[];
    applications: RuleApplication[];
    unmapped: UnmappedLawChange[];
    link?: {
      relationType: string;
      scope: string | null;
      evidenceText: string | null;
      confirmState: string;
      confidence: number | null;
    };
    path?: { type: string; id: string | null; label: string }[];
    /** 변수 근거(T-109 ②) — 예전 후보(rule/1)에는 없다 */
    variables?: VariableEntry[];
  };
  diff: { parts: CandidateDiffPart[]; changes: CandidateChange[]; unexplained: number };
};

/** 낡은 까닭 — 기준일에 조문이 폐지됨(T-126) / 그 사이 개정됨 / 기준 본문은 같아도 발행 이력이 바뀜 / 예정 시행일의 변수 값이 바뀜(T-109 ②) */
export type StaleReason = 'repealed' | 'base_changed' | 'history_changed' | 'variable_changed' | null;

export type AmendmentDetail = AmendmentCandidate & {
  createdByName: string | null;
  isCurrentBase: boolean;
  /** base_changed: 지금 다시 만들면 다른 기준 본문 / history_changed: 기준 본문은 같아도 그 사이 다른 발행·폐지·시행일 보정 */
  staleReason: StaleReason;
  /** 마지막 결정(승인·반려) */
  decision: {
    state: 'approved' | 'rejected';
    revision: number;
    reason: string | null;
    at: string;
    by: { id: string; name: string | null } | null;
  } | null;
  /** 승인으로 발행된 후속 버전 */
  resultVersion: { id: string; versionNum: number; effectiveDate: string | null; publishedAt: string | null } | null;
  /** 같은 승인을 다시 보냈을 때(응답 유실) — 새로 발행하지 않고 기존 결과 */
  alreadyApproved?: boolean;
  /** 지금 다시 만들면 고를 기준 본문 — 이 후보의 제1 조문과 다를 때만 */
  currentBase: { id: string; versionNum: number; effectiveDate: string | null; content: string } | null;
  reviewRequest: {
    id: string;
    revision: number;
    reason: string | null;
    requestedAt: string;
    requestedBy: { id: string; name: string | null } | null;
  } | null;
  siblings: { id: string; reviewState: AmendmentState; revision: number; createdAt: string; baseVersionNum: number }[];
  policy: { id: string; code: string; title: string };
  article: {
    id: string;
    number: number;
    branchNumber: number | null;
    clauseNumber: number | null;
    itemNumber: number | null;
    title: string;
  };
  event: {
    id: string;
    lawId: string;
    lawName: string;
    label: string;
    changeType: string;
    beforeContent: string | null;
    afterContent: string | null;
    lawEffectiveDate: string | null;
    promulgatedDate: string | null;
  };
};

export type AmendmentHistory = {
  revisions: {
    revision: number;
    content: string;
    contentHash: string;
    note: string | null;
    editedBy: { id: string; name: string | null } | null;
    stateBefore: AmendmentState | null;
    createdAt: string;
    fromPrevious: CandidateDiffPart[] | null;
  }[];
  stateChanges: {
    id: string;
    fromState: AmendmentState;
    toState: AmendmentState;
    revision: number;
    reason: string | null;
    actor: { id: string; name: string | null } | null;
    createdAt: string;
  }[];
};

export type RegenerateResult = {
  candidateId: string | null;
  created: boolean;
  unchanged: boolean;
  skipped: 'not_in_force' | 'effective_date_missing' | 'repealed' | null;
  noSubstantiveChange: boolean;
  unresolvable: string | null;
};

export type GenerateResult = {
  changeEventId: string;
  asOf: string;
  created: { id: string; articleId: string }[];
  existing: { id: string; articleId: string }[];
  skipped: { articleId: string; label: string; reason: 'not_in_force' | 'effective_date_missing' | 'repealed' }[];
  noSubstantiveChange: boolean;
  unresolvable: string | null;
};

export const CONFIDENCE_LABEL: Record<AmendmentConfidence, string> = { high: '높음', medium: '보통', low: '낮음' };

export const REVIEW_STATE_LABEL: Record<AmendmentState, string> = {
  draft: '작성 중',
  review: '검토 중',
  approved: '승인됨',
  rejected: '반려됨',
};

/** 사람이 봐야 하는 이유 — 서버 amendment-rules.ts 의 ReviewFlag */
export const REVIEW_FLAG_LABEL: Record<string, string> = {
  manual_draft_required: '직접 작성 필요',
  unmapped_law_change: '반영 못 한 법령 변경 있음',
  ambiguous_match: '대응 위치 모호',
  context_unclear: '문맥 확인 필요',
  rule_conflict: '규칙 충돌',
  relation_review_only: '참고 관계',
  scope_review: '적용 범위 확인',
  law_provision_repealed: '법령 조항 삭제',
  unexplained_change: '근거 없는 변경',
  variable_conflict: '변수 값과 법령 개정이 같은 자리',
  variable_unresolved: '변수 값 미정',
};

export const RULE_LABEL: Record<string, string> = {
  VALUE_CHANGE: '기준값 변경',
  TERM_CHANGE: '용어 변경',
  QUOTED_SENTENCE: '인용 문장 교체',
};

export const UNMAPPED_REASON_LABEL: Record<string, string> = {
  repealed: '법령 조항이 삭제됨',
  relation_review_only: '참고 관계라 자동으로 고치지 않음',
  scope_review: '적용 범위가 있어 자동으로 고치지 않음',
  no_correspondence: '우리 조문에 대응 문구 없음',
  ambiguous: '같은 문구가 여러 곳',
  context_unclear: '문맥 확인 필요',
  conflict: '규칙 충돌',
  unsupported: '문장 추가·삭제는 규칙으로 옮기지 않음',
};

export type AmendmentListState = 'open' | 'draft' | 'review' | 'approved' | 'rejected' | 'all';

export type AmendmentListItem = {
  id: string;
  reviewState: AmendmentState;
  current: CurrentState;
  confidence: AmendmentConfidence;
  reviewFlags: string[];
  asOf: string;
  createdAt: string;
  updatedAt: string;
  /** null 이면 법령 동기화가 자동으로 만든 후보 */
  createdBy: { id: string; name: string | null } | null;
  policy: { id: string; code: string; title: string; isActive: boolean };
  article: {
    id: string;
    number: number;
    branchNumber: number | null;
    clauseNumber: number | null;
    itemNumber: number | null;
    title: string;
  };
  baseVersion: { id: string; versionNum: number };
  /** false 면 후보를 만든 뒤 조문이 개정돼 기준 본문이 바뀌었다 */
  isCurrentBase: boolean;
  staleReason: StaleReason;
  plannedEffectiveDate: string;
  event: { id: string; lawId: string; lawName: string; label: string; changeType: string; lawEffectiveDate: string | null };
};

export type AmendmentListResult = { rows: AmendmentListItem[]; total: number; page: number; limit: number };

export const amendmentsApi = {
  generate: (changeEventId: string): Promise<GenerateResult> =>
    client.post('/amendments/generate', { changeEventId }).then((r) => r.data),
  list: (params: {
    state?: AmendmentListState;
    policyId?: string;
    policyActive?: 'active' | 'inactive';
    page?: number;
    limit?: number;
  }): Promise<AmendmentListResult> => client.get('/amendments', { params }).then((r) => r.data),
  get: (id: string): Promise<AmendmentDetail> => client.get(`/amendments/${id}`).then((r) => r.data),
  history: (id: string): Promise<AmendmentHistory> => client.get(`/amendments/${id}/history`).then((r) => r.data),
  edit: (
    id: string,
    body: { candidateContent: string; note: string; expectedRevision: number; expectedLockVersion: number },
  ): Promise<AmendmentDetail> => client.patch(`/amendments/${id}`, body).then((r) => r.data),
  requestReview: (
    id: string,
    body: { reason?: string; expectedRevision: number; expectedLockVersion: number },
  ): Promise<AmendmentDetail> => client.post(`/amendments/${id}/review`, body).then((r) => r.data),
  regenerate: (id: string, asOf?: string): Promise<RegenerateResult> =>
    client.post(`/amendments/${id}/regenerate`, asOf ? { asOf } : {}).then((r) => r.data),
  approve: (
    id: string,
    body: {
      effectiveDate: string;
      changeNote: string;
      earlyReason?: string;
      expectedRevision: number;
      expectedLockVersion: number;
    },
  ): Promise<AmendmentDetail> => client.post(`/amendments/${id}/approve`, body).then((r) => r.data),
  reject: (
    id: string,
    body: { reason: string; expectedRevision: number; expectedLockVersion: number },
  ): Promise<AmendmentDetail> => client.post(`/amendments/${id}/reject`, body).then((r) => r.data),
};

/** 승인을 막은 이유(409 의 reason) — 화면 안내용 */
export type ApproveBlock = 'undated_history' | 'repealed' | 'base_mismatch' | 'later_version' | 'history_changed' | 'variable_changed';

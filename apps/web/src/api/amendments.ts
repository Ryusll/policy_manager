import client from './client';

/**
 * 개정 후보 (T-106). 법령 변경을 규칙으로 우리 조문에 옮긴 **초안**이다 —
 * 승인(T-108) 전까지 시행 본문은 그대로다.
 */
export type AmendmentConfidence = 'high' | 'medium' | 'low';
export type AmendmentState = 'draft' | 'review' | 'approved' | 'rejected';

export type CandidateDiffPart = { op: 'equal' | 'insert' | 'delete'; text: string };

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
  confidence: AmendmentConfidence;
  reviewFlags: string[];
  asOf: string;
  createdBy: string | null;
  createdAt: string;
  baseVersion: { id: string; versionNum: number; effectiveDate: string | null; content: string };
  candidateContent: string;
  rationale: {
    lawChanges: LawTextChange[];
    applications: RuleApplication[];
    unmapped: UnmappedLawChange[];
  };
  diff: { parts: CandidateDiffPart[]; unexplained: number };
};

export type GenerateResult = {
  changeEventId: string;
  asOf: string;
  created: { id: string; articleId: string }[];
  existing: { id: string; articleId: string }[];
  skipped: { articleId: string; label: string; reason: 'not_in_force' | 'effective_date_missing' }[];
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

export const amendmentsApi = {
  generate: (changeEventId: string): Promise<GenerateResult> =>
    client.post('/amendments/generate', { changeEventId }).then((r) => r.data),
};

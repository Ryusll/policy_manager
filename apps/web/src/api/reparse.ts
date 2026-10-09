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
  /** open | superseded | applied */
  status: string;
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
};

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

import type { Prisma } from '@prisma/client';
import { toDateOnlyString } from '../common/date-only';
import { hasSubstantiveChange } from './amendment-revision';

/**
 * 개정 후보를 화면에 내보내는 모양 — 법령 영향 패널(T-105 의 impact 에 붙는 후보)과
 * `GET /amendments/:id` 가 같은 것을 쓴다.
 */
export const CANDIDATE_SELECT = {
  id: true,
  tenantId: true,
  articleId: true,
  baseVersionId: true,
  changeEventId: true,
  lawLinkId: true,
  candidateContent: true,
  rationale: true,
  diff: true,
  generationMethod: true,
  variant: true,
  generationMeta: true,
  confidence: true,
  reviewFlags: true,
  reviewState: true,
  revision: true,
  lockVersion: true,
  asOfDate: true,
  createdBy: true,
  createdAt: true,
  baseVersion: { select: { id: true, versionNum: true, effectiveDate: true, content: true } },
} satisfies Prisma.AmendmentCandidateSelect;

export type CandidateRow = Prisma.AmendmentCandidateGetPayload<{ select: typeof CANDIDATE_SELECT }>;

/**
 * 지금 판의 상태 — 생성 때의 `confidence`·`reviewFlags` 는 고정하고(사람이 고쳤다고 신뢰도가 오르거나 반영 못 한
 * 변경이 풀리지 않는다), 지금 본문 기준의 표시는 따로 계산한다(코덱스 자문 결정 4).
 */
export function currentState(row: { revision: number; candidateContent: string; diff: unknown; baseContent: string }) {
  const diff = (row.diff ?? {}) as { unexplained?: number };
  return {
    revision: row.revision,
    /** 공백을 빼고도 제1 조문과 다른가 — 아니면 "직접 작성 필요" */
    hasChanges: hasSubstantiveChange(row.baseContent, row.candidateContent),
    /** 근거가 연결되지 않은 변경 구간 수 — 검토 대상 */
    unexplained: diff.unexplained ?? 0,
    /** 사람이 고친 판인가 */
    edited: row.revision > 1,
  };
}

export function presentCandidate(row: CandidateRow) {
  return {
    id: row.id,
    articleId: row.articleId,
    changeEventId: row.changeEventId,
    lawLinkId: row.lawLinkId,
    reviewState: row.reviewState,
    revision: row.revision,
    lockVersion: row.lockVersion,
    current: currentState({
      revision: row.revision,
      candidateContent: row.candidateContent,
      diff: row.diff,
      baseContent: row.baseVersion.content,
    }),
    confidence: row.confidence,
    reviewFlags: row.reviewFlags,
    generationMethod: row.generationMethod,
    variant: row.variant,
    asOf: toDateOnlyString(row.asOfDate),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    baseVersion: {
      id: row.baseVersion.id,
      versionNum: row.baseVersion.versionNum,
      effectiveDate: row.baseVersion.effectiveDate ? toDateOnlyString(row.baseVersion.effectiveDate) : null,
      content: row.baseVersion.content,
    },
    candidateContent: row.candidateContent,
    rationale: row.rationale,
    diff: row.diff,
    generationMeta: row.generationMeta,
  };
}

import type { Prisma } from '@prisma/client';
import { toDateOnlyString } from '../common/date-only';

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
  asOfDate: true,
  createdBy: true,
  createdAt: true,
  baseVersion: { select: { id: true, versionNum: true, effectiveDate: true, content: true } },
} satisfies Prisma.AmendmentCandidateSelect;

export type CandidateRow = Prisma.AmendmentCandidateGetPayload<{ select: typeof CANDIDATE_SELECT }>;

export function presentCandidate(row: CandidateRow) {
  return {
    id: row.id,
    articleId: row.articleId,
    changeEventId: row.changeEventId,
    lawLinkId: row.lawLinkId,
    reviewState: row.reviewState,
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

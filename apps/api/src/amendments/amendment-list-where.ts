import type { Prisma } from '@prisma/client';
import type { AmendmentListQueryDto } from './amendments.dto';

/**
 * 개정 후보 목록의 조건(T-107) — 기본은 처리할 것(작성·검토). 후보의 회사와 조문의 실제 소속으로 회사 경계를 건다.
 * 대시보드 처리 대기(T-158 — 배너·메뉴 배지)가 필터 없이 같은 조건으로 센다: 배지 숫자 = 개정 검토 화면 기본 목록의 건수.
 * AI 의견·신뢰도·검토 표시로 거르지 않는다 — 처리하지 않은 후보는 전부 센다(ADR-0021, 놓치지 않게)
 */
export function candidateListWhere(
  tenantId: string,
  q: Pick<AmendmentListQueryDto, 'state' | 'policyId' | 'policyActive' | 'changeEventId'>,
): Prisma.AmendmentCandidateWhereInput {
  const state = q.state ?? 'open';
  return {
    tenantId,
    article: {
      chapter: {
        policy: {
          tenantId,
          ...(q.policyId ? { id: q.policyId } : {}),
          ...(q.policyActive ? { isActive: q.policyActive === 'active' } : {}),
        },
      },
    },
    ...(q.changeEventId ? { changeEventId: q.changeEventId } : {}),
    ...(state === 'open' ? { reviewState: { in: ['draft', 'review'] } } : state === 'all' ? {} : { reviewState: state }),
  };
}

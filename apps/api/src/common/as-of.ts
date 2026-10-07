import type { Prisma } from '@prisma/client';

/**
 * 시점(as-of) 조회의 **단일 규칙** — "기준일 이하에 시행된 발행분 중 가장 나중".
 *
 * 초안·검토 중인 버전은 후보가 아니다(아직 시행된 적이 없다). 폐지(archived)된 버전은
 * 후보다 — 그날 시행 중이던 본문이 지금은 다음 버전에 밀려 폐지 상태일 수 있다.
 * 같은 날 시행분이 둘이면 버전 번호가 큰 쪽.
 *
 * 규정 시점 조회·신구 대비표(policies.service)와 법령 개정 영향 분석(T-105)의 "제1 조문"이
 * 이 규칙을 함께 쓴다 — 따로 적어 두면 한쪽만 고쳐져 "화면에서 본 시행본"과
 * "개정 초안의 기준 본문"이 갈라진다.
 */
export function asOfVersionWhere(asOfDate: Date): Prisma.ArticleVersionWhereInput {
  return {
    status: { in: ['published', 'archived'] },
    effectiveDate: { not: null, lte: asOfDate },
  };
}

export const AS_OF_VERSION_ORDER: Prisma.ArticleVersionOrderByWithRelationInput[] = [
  { effectiveDate: 'desc' },
  { versionNum: 'desc' },
];

import type { Prisma } from '@prisma/client';

/**
 * 시점(as-of) 조회의 **단일 규칙** — "기준일 이하에 시행된 발행분 중 가장 나중"을 고르고,
 * 고른 버전이 그날 폐지돼 있지 않은지 `asOfState` 로 본다.
 *
 * 초안·검토 중인 버전은 후보가 아니다(아직 시행된 적이 없다). 내려간(archived) 버전은
 * 후보다 — 그날 시행 중이던 본문이 지금은 다음 버전에 밀려 내려가 있을 수 있다.
 * 같은 날 시행분이 둘이면 버전 번호가 큰 쪽.
 *
 * 규정 시점 조회·신구 대비표(policies.service), 법령 개정 영향 분석(T-105)의 "제1 조문",
 * 개정 후보의 지금 기준 본문·승인 때 기준본 확인(T-106·T-108)이 이 규칙을 함께 쓴다 — 따로 적어 두면
 * 한쪽만 고쳐져 "화면에서 본 시행본"과 "개정 초안의 기준 본문"이 갈라진다.
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

export type AsOfState = 'in_force' | 'repealed' | 'none';

/**
 * 시점 조회로 고른 버전이 그날 시행 중인가(T-126).
 *
 * 고른 버전에 폐지 시행일이 있고 그 날이 기준일 이하면 조문은 그날 **폐지 상태**다. 그 앞 버전으로
 * 되돌아가지 않는다 — 폐지일을 `where` 조건에 넣으면 대체로 내려간 옛 버전이 대신 잡혀 폐지한 조문이
 * 옛 본문으로 되살아난다. 폐지 뒤 다시 시행한 버전은 시행일이 폐지일 이후라 자연히 그것이 골라진다.
 */
export function asOfState(picked: { repealedOn: Date | null } | null | undefined, asOfDate: Date): AsOfState {
  if (!picked) return 'none';
  return picked.repealedOn && picked.repealedOn.getTime() <= asOfDate.getTime() ? 'repealed' : 'in_force';
}

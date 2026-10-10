import { Prisma } from '@prisma/client';

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

/**
 * **"현재"(오늘, 한국 날짜) 시행본**의 후보 — 규정 상세·전문·인쇄·검색·규정 질문이 함께 쓴다(T-127).
 *
 * 시점 조회 규칙과 같되 한 가지가 다르다: **시행일 없이 들어간 예전 시행본**(T-123 보정 전)도 후보다.
 * 시점 조회는 날짜가 없으면 그날 시행 중이었는지 알 수 없어 빼지만, "현재" 화면에서 빼면 예전 규정이 통째로 사라진다.
 * 시행일 없는 버전은 날짜 있는 버전보다 늘 앞선 것으로 본다(`NULLS LAST`) — 시행일 없이 들어간 건 가져오기로 넣은
 * 첫 버전뿐이고, 그 뒤 승인은 시행일을 남긴다.
 *
 * 미래 시행일로 승인한 버전은 후보가 아니다 — 시행일 전까지는 이전 본문이 현재다(`scheduledVersionWhere` 로 따로 보인다).
 * 고른 버전의 폐지 여부는 `asOfState(picked, today)` 로 본다.
 */
export function currentVersionWhere(today: Date): Prisma.ArticleVersionWhereInput {
  return {
    status: { in: ['published', 'archived'] },
    OR: [{ effectiveDate: null }, { effectiveDate: { lte: today } }],
  };
}

export const CURRENT_VERSION_ORDER: Prisma.ArticleVersionOrderByWithRelationInput[] = [
  { effectiveDate: { sort: 'desc', nulls: 'last' } },
  { versionNum: 'desc' },
];

/**
 * 시행 예정 — 승인됐지만 시행일이 아직 오지 않은 버전(T-127). 시행일 전까지 "현재"는 이전 본문이다.
 * `archived` 도 넣는다: 시행 예정 버전보다 이른 날로 다른 버전을 승인하면 시행 예정 버전이 내려가지만, 날짜 규칙상 그날이 되면
 * 다시 현재가 된다 — 숨기면 그날 갑자기 바뀐다. 폐지된 버전은 뺀다.
 */
export function scheduledVersionWhere(today: Date): Prisma.ArticleVersionWhereInput {
  return { status: { in: ['published', 'archived'] }, effectiveDate: { gt: today }, repealedOn: null };
}

/**
 * `currentVersionWhere` + `CURRENT_VERSION_ORDER` 의 SQL 판 — 원시 SQL 로 고르는 곳(검색·규정 질문)용.
 * 회사의 조문마다 "현재" 버전 하나: 열은 `article_id`, `version_id`, `content`, `repealed_on`.
 * 폐지 판정은 쓰는 쪽에서 `repealed_on` 으로 한다(오늘 이하면 폐지 상태 — `asOfState` 와 같다).
 */
export function currentVersionsSql(tenantId: string, today: Date, opts: { activePoliciesOnly?: boolean } = {}): Prisma.Sql {
  const active = opts.activePoliciesOnly ? Prisma.sql`AND p.is_active = true` : Prisma.empty;
  return Prisma.sql`
    SELECT DISTINCT ON (av.article_id) av.article_id, av.id AS version_id, av.content, av.repealed_on
    FROM article_versions av
    JOIN articles a ON a.id = av.article_id
    JOIN chapters c ON c.id = a.chapter_id
    JOIN policies p ON p.id = c.policy_id
    WHERE p.tenant_id = ${tenantId} ${active}
      AND av.status IN ('published', 'archived')
      AND (av.effective_date IS NULL OR av.effective_date <= ${today})
    ORDER BY av.article_id, av.effective_date DESC NULLS LAST, av.version_num DESC`;
}

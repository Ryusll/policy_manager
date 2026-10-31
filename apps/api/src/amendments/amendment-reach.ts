import type { PrismaService } from '../common/prisma/prisma.service';
import type { ConfidenceLevel } from './amendment-rules';

/**
 * 법령 변경이 닿는 조문의 개정 후보 규칙 (T-148).
 *
 * 영향은 바뀐 조항과 그 위 조항(조·항)에 건 확정 연결로 찾는다(`law-changes/law-link-reach.ts`). 위 조항에 건
 * 연결로 찾은 후보는 바뀐 항·호가 정말 이 조문에 해당하는지 사람이 봐야 한다 — 그래서 표시를 붙이고 신뢰도를 낮춘다.
 */

/** 바뀐 조항이 아니라 그 위 조항(조·항)에 건 연결로 찾았다 — `reviewFlags`·신뢰도 판정 이유에 쓴다 */
export const PARENT_LINK_FLAG = 'parent_link';

const LEVEL_ORDER: readonly ConfidenceLevel[] = ['low', 'medium', 'high'];

/** 신뢰도 상한 — 더 높으면 상한까지 낮추고, 같거나 낮으면 그대로 둔다 */
export function capConfidence(level: ConfidenceLevel, max: ConfidenceLevel): ConfidenceLevel {
  return LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(max) ? max : level;
}

/**
 * 이 변경으로 이미 후보가 있는 조문(상태와 상관없이). 자동 생성은 (회사, 변경, 조문)마다 한 번이다 — 그 사이 기준
 * 본문이 바뀌었어도 새로 만들지 않는다(지금 중복 키는 기준 본문까지 같아야 막는다). 지금 기준 본문으로 다시 만드는
 * 것은 사람이 고른다(T-107 "다시 만들기")
 */
export async function articlesWithCandidates(
  prisma: PrismaService,
  tenantId: string,
  changeEventId: string,
  articleIds: string[],
): Promise<Set<string>> {
  if (!articleIds.length) return new Set();
  const rows = await prisma.amendmentCandidate.findMany({
    where: { tenantId, changeEventId, articleId: { in: articleIds } },
    select: { articleId: true },
    distinct: ['articleId'],
  });
  return new Set(rows.map((r) => r.articleId));
}

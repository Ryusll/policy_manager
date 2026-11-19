import type { PrismaService } from '../common/prisma/prisma.service';
import { scheduledVersionWhere } from '../common/as-of';
import { ARTICLE_ORDER } from '../common/article-label';
import { toDateOnlyString } from '../common/date-only';

/**
 * 시행 예정 묶음 — 승인됐지만 사내 시행일 전인 조문 버전(`scheduledVersionWhere`)과 폐지 예정(T-132 ③)을
 * 규정 · 날짜별로 묶는다. 대시보드 "제·개정 예고" 목록(`GET /policies/scheduled-changes`, T-132 ⑤)과
 * 대시보드 지표 카드 '사내 시행 예정'(T-213, SRS LAW-29 ④)이 이 함수 하나를 함께 쓴다 — 카드 수가 목록과 갈라지지 않게.
 *
 * 단위는 조문 행(Article — 머리·항·호가 각각 한 행)이고, 같은 조문이 서로 다른 날짜에 시행 예정이면 날짜 묶음마다 센다.
 * 비활성 규정도 넣는다(목록은 `isActive` 를 실어 보인다). 회사 경계는 조문의 실제 소속(`chapter.policy.tenantId`)으로 건다.
 * 정렬·자르기·표기는 부르는 쪽 몫이다 — 첫 조문은 행 그대로 돌려준다(목록이 `formatArticleRowHeading` 으로 '제4조제2항(특례)'처럼 적는다).
 */

const ARTICLE_SELECT = {
  id: true,
  number: true,
  branchNumber: true,
  clauseNumber: true,
  itemNumber: true,
  title: true,
  chapter: { select: { policy: { select: { id: true, code: true, title: true, isActive: true } } } },
} as const;

export type ScheduledArticleRow = {
  id: string;
  number: number;
  branchNumber: number | null;
  clauseNumber: number | null;
  itemNumber: number | null;
  title: string;
};

export type ScheduledGroup = {
  policyId: string;
  code: string;
  title: string;
  isActive: boolean;
  /** 사내 시행일(개정) 또는 폐지일(YYYY-MM-DD) */
  effectiveDate: string;
  articleIds: Set<string>;
  repealIds: Set<string>;
  /** 이 묶음에 처음 들어온 조문 — 개정이 먼저(시행일·조 번호 순), 그다음 폐지 */
  firstArticle: ScheduledArticleRow;
};

export async function listScheduledGroups(
  db: Pick<PrismaService, 'articleVersion'>,
  tenantId: string,
  today: Date,
): Promise<ScheduledGroup[]> {
  // 같은 날 묶음의 첫 줄(firstArticle)이 조 → 가지 → 조 본문 → 항 → 목 순으로 정해지게(T-211 — 조 번호만 보면 같은 조의 어느 행이 먼저일지 모른다)
  const byArticle = ARTICLE_ORDER.map((order) => ({ article: order }));
  const rows = await db.articleVersion.findMany({
    where: { ...scheduledVersionWhere(today), article: { chapter: { policy: { tenantId } } } },
    orderBy: [{ effectiveDate: 'asc' }, ...byArticle],
    select: { effectiveDate: true, article: { select: ARTICLE_SELECT } },
  });
  // 폐지 예정(T-132 ③) — 오늘은 시행 중이고 이 날부터 빠지는 조문
  const repeals = await db.articleVersion.findMany({
    where: { repealedOn: { gt: today }, status: { in: ['published', 'archived'] }, article: { chapter: { policy: { tenantId } } } },
    orderBy: [{ repealedOn: 'asc' }, ...byArticle],
    select: { repealedOn: true, article: { select: ARTICLE_SELECT } },
  });
  const groups = new Map<string, ScheduledGroup>();
  const add = (date: Date, article: (typeof rows)[number]['article'], kind: 'amend' | 'repeal') => {
    const p = article.chapter.policy;
    const day = toDateOnlyString(date);
    const key = `${p.id}|${day}`;
    const { chapter: _chapter, ...row } = article;
    const g = groups.get(key) ?? {
      policyId: p.id,
      code: p.code,
      title: p.title,
      isActive: p.isActive,
      effectiveDate: day,
      articleIds: new Set<string>(),
      repealIds: new Set<string>(),
      firstArticle: row,
    };
    (kind === 'amend' ? g.articleIds : g.repealIds).add(article.id);
    groups.set(key, g);
  };
  for (const r of rows) add(r.effectiveDate!, r.article, 'amend');
  for (const r of repeals) add(r.repealedOn!, r.article, 'repeal');
  return [...groups.values()];
}

/** 대시보드 카드 — 목록 묶음 전체의 조문 수 합(상한 없이). 목록에 보이는 '조문 N개 개정 · M개 폐지'를 모두 더한 값과 같다 */
export function scheduledTotals(groups: ScheduledGroup[]): { amend: number; repeal: number } {
  return groups.reduce((t, g) => ({ amend: t.amend + g.articleIds.size, repeal: t.repeal + g.repealIds.size }), { amend: 0, repeal: 0 });
}

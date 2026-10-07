import { Prisma } from '@prisma/client';

/** "제3조", "제3조의2" — 화면(`legalArticleLabel.ts`의 `formatArticleJo`)과 같은 표기 */
export function formatJo(number: number, branchNumber?: number | null): string {
  return branchNumber ? `제${number}조의${branchNumber}` : `제${number}조`;
}

/** 조문 정렬: 조 → 가지(제3조 다음 제3조의2) → 조 본문 → 항 → 목 */
export const ARTICLE_ORDER: Prisma.ArticleOrderByWithRelationInput[] = [
  { number: 'asc' },
  { branchNumber: { sort: 'asc', nulls: 'first' } },
  { clauseNumber: { sort: 'asc', nulls: 'first' } },
  { itemNumber: { sort: 'asc', nulls: 'first' } },
];

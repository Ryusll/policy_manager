import { Prisma } from '@prisma/client';

/** "제3조", "제3조의2" — 화면(`legalArticleLabel.ts`의 `formatArticleJo`)과 같은 표기 */
export function formatJo(number: number, branchNumber?: number | null): string {
  return branchNumber ? `제${number}조의${branchNumber}` : `제${number}조`;
}

/** "제3조의2제1항제2목" — 조문 행(조·항·목) 하나의 표기. 개정 후보 알림과 개정안 문서(T-162)가 같은 것을 쓴다 */
export function formatArticleLabel(a: {
  number: number;
  branchNumber?: number | null;
  clauseNumber?: number | null;
  itemNumber?: number | null;
}): string {
  return `${formatJo(a.number, a.branchNumber)}${a.clauseNumber ? `제${a.clauseNumber}항` : ''}${a.itemNumber ? `제${a.itemNumber}목` : ''}`;
}

/** 조문 정렬: 조 → 가지(제3조 다음 제3조의2) → 조 본문 → 항 → 목 */
export const ARTICLE_ORDER: Prisma.ArticleOrderByWithRelationInput[] = [
  { number: 'asc' },
  { branchNumber: { sort: 'asc', nulls: 'first' } },
  { clauseNumber: { sort: 'asc', nulls: 'first' } },
  { itemNumber: { sort: 'asc', nulls: 'first' } },
];

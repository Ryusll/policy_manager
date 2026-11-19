import { Prisma } from '@prisma/client';

/** "제3조", "제3조의2" — 화면(`legalArticleLabel.ts`의 `formatArticleJo`)과 같은 표기 */
export function formatJo(number: number, branchNumber?: number | null): string {
  return branchNumber ? `제${number}조의${branchNumber}` : `제${number}조`;
}

const OPEN_PARENS = '(（';
const CLOSE_PARENS = ')）';

/** 제목 전체를 감싼 괄호 한 겹만 벗긴다 — 제목 칸에 "(목적)"으로 적은 조문이 "제1조((목적))"이 되지 않게. 저장값은 그대로 둔다 */
function bareTitle(title?: string | null): string {
  const t = String(title ?? '').trim();
  if (t.length < 2 || !OPEN_PARENS.includes(t[0]) || !CLOSE_PARENS.includes(t[t.length - 1])) return t;
  // 첫 괄호가 맨 끝에서 닫힐 때만 겉 한 겹이다 — "(주)인사", "(정의) 및 (적용)"은 제목의 일부다
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (OPEN_PARENS.includes(t[i])) depth += 1;
    else if (CLOSE_PARENS.includes(t[i])) {
      depth -= 1;
      if (depth === 0 && i < t.length - 1) return t;
    }
  }
  return depth === 0 ? t.slice(1, -1).trim() : t;
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

/**
 * 조문 행 하나의 머리 — 조면 "제1조(목적)"(SRS POLICY-10, T-211), 항·목이면 "제2조제1항(부제)". 제목이 없으면 번호만.
 * 알림 본문·시행 예정 목록·개정안 문서와 개정 이유가 이것 하나를 쓴다(손으로 잇지 않는다). 조의 표기는 화면
 * (`apps/web/src/lib/articleHeading.ts`의 `formatArticleHeading`)과 같다 — `tests/articleHeading.test.ts`가 같은 표로 둘을 본다.
 */
export function formatArticleRowHeading(a: {
  number: number;
  branchNumber?: number | null;
  clauseNumber?: number | null;
  itemNumber?: number | null;
  title?: string | null;
}): string {
  const t = bareTitle(a.title);
  return t ? `${formatArticleLabel(a)}(${t})` : formatArticleLabel(a);
}

/** 조문 정렬: 조 → 가지(제3조 다음 제3조의2) → 조 본문 → 항 → 목 */
export const ARTICLE_ORDER: Prisma.ArticleOrderByWithRelationInput[] = [
  { number: 'asc' },
  { branchNumber: { sort: 'asc', nulls: 'first' } },
  { clauseNumber: { sort: 'asc', nulls: 'first' } },
  { itemNumber: { sort: 'asc', nulls: 'first' } },
];

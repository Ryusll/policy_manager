/**
 * 조 머리 표기 — 번호와 제목을 붙여 `제1조(목적)` 한 줄로 적는다 (SRS POLICY-10, T-211).
 *
 * 조 번호와 제목을 함께 적는 곳은 모두 여기 함수를 쓴다. 손으로 이으면 화면마다 `제1조 목적`·`제1조 (목적)`으로
 * 갈라진다(이 작업 전의 상태) — `tests/articleHeadingUsage.test.ts` 가 손으로 잇는 자리를 막는다.
 * 서버 쪽 같은 규칙은 `apps/api/src/common/article-label.ts` 의 `formatArticleRowHeading`.
 */

import {
  formatArticleJo,
  formatClauseHang,
  formatItemMok,
  isArticleJoRoot,
  type ArticleLabelParts,
} from './legalArticleLabel';

type Titled = { title?: string | null };

const OPEN_PARENS = '(（';
const CLOSE_PARENS = ')）';

/**
 * 조 머리에 적을 제목 — 제목 칸에 `(목적)`처럼 괄호까지 적은 조문이 `제1조((목적))`으로 나오지 않게
 * 제목 전체를 감싼 괄호 한 겹만 벗긴다. 저장된 제목은 그대로 둔다(표시할 때만).
 */
export function bareArticleTitle(title?: string | null): string {
  const t = String(title ?? '').trim();
  if (t.length < 2 || !OPEN_PARENS.includes(t[0]) || !CLOSE_PARENS.includes(t[t.length - 1])) return t;
  // 첫 괄호가 맨 끝에서 닫힐 때만 겉 한 겹이다 — `(주)인사`, `(정의) 및 (적용)`은 제목의 일부다
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

/** 조 머리의 조각 — 번호(`제1조`), 괄호, 제목. 검색 강조는 번호·제목 조각에만 건다(괄호는 대상이 아니다) */
export type ArticleHeadingSegment = { text: string; part: 'number' | 'paren' | 'title' };

/**
 * 조 머리를 조각으로 — **표기의 유일한 정의**. 통째 문자열(`formatArticleHeading`)도, 번호와 제목을 따로 강조하는
 * 화면(`JoHeadingText`)·내보내기 HTML(`templateUtils`)도 이 조각을 이어 붙인다.
 */
export function articleHeadingSegments(n: number, branch?: number | null, title?: string | null): ArticleHeadingSegment[] {
  const jo: ArticleHeadingSegment = { text: formatArticleJo(n, branch), part: 'number' };
  const t = bareArticleTitle(title);
  if (!t) return [jo];
  return [jo, { text: '(', part: 'paren' }, { text: t, part: 'title' }, { text: ')', part: 'paren' }];
}

/** 조 머리 — `제1조(목적)`, 제목이 없으면 `제1조`, 가지 조문은 `제3조의2(정의)` */
export function formatArticleHeading(n: number, branch?: number | null, title?: string | null): string {
  return articleHeadingSegments(n, branch, title)
    .map((s) => s.text)
    .join('');
}

/** 항·목의 번호 — `①`, 목이면 `① 1.`(항 없이 조에 달린 목은 `1.`) */
function subNumbers(article: ArticleLabelParts, withHang: boolean): string {
  const hang = article.clauseNumber != null ? formatClauseHang(article.clauseNumber) : '';
  if (article.itemNumber == null) return hang;
  return [withHang ? hang : '', formatItemMok(article.itemNumber)].filter(Boolean).join(' ');
}

/** 조 안에서 조문 행 하나를 가리키는 라벨 — 조는 머리 표기(`제1조(목적)`), 항·목은 번호와 부제(`① 부제`, 부제가 없으면 `①`) */
export function articleDisplayLabel(article: ArticleLabelParts & Titled): string {
  if (isArticleJoRoot(article)) return formatArticleHeading(article.number, article.branchNumber, article.title);
  const t = String(article.title ?? '').trim();
  return [subNumbers(article, false), t].filter(Boolean).join(' ');
}

/**
 * 조 밖에서 조문 행 하나를 가리키는 라벨 — 조는 `제1조(목적)`, 항·목은 어느 조인지까지 `제2조 ② 부제`.
 * 항의 부제를 조 머리 자리에 넣으면(`제2조(부제)`) 조 제목으로 읽힌다 — 목록·사유·검색 제안이 이것을 쓴다.
 */
export function articleRowHeading(article: ArticleLabelParts & Titled): string {
  if (isArticleJoRoot(article)) return formatArticleHeading(article.number, article.branchNumber, article.title);
  const t = String(article.title ?? '').trim();
  return [formatArticleJo(article.number, article.branchNumber), subNumbers(article, true), t].filter(Boolean).join(' ');
}

/** 조문 이동·이력 목록의 한 줄 — `제1장 · 제1조(목적)`, 항이면 `제1장 · 제2조 ①` */
export function chapterArticleLabel(chapterNumber: number, article: ArticleLabelParts & Titled): string {
  return `제${chapterNumber}장 · ${articleRowHeading(article)}`;
}

/**
 * 자리 표기(`제3조제1항` 같은 위치 글)를 쓰는 화면의 라벨 — 조 자리면 조 머리 `제1조(목적)`, 항·목 자리면 `위치(부제)`.
 * 개정 검토 목록·후보 상세·법령 영향·즐겨찾기·시행 예정 자리 안내·제안 계층이 쓴다. 부제도 겉 괄호 한 겹을 벗긴다
 * (서버의 `제2조제1항(부제)`와 같은 꼴). `positionText` 는 항·목 자리일 때 쓸 위치 글(화면마다 띄어쓰기가 다르다).
 */
export function articlePositionLabel(pos: ArticleLabelParts, title: string | null | undefined, positionText: string): string {
  if (isArticleJoRoot(pos)) return formatArticleHeading(pos.number, pos.branchNumber, title);
  const t = bareArticleTitle(title);
  return t ? `${positionText}(${t})` : positionText;
}

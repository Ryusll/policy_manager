/** 조·항·목 추가/수정 폼 — 법령형 구조 */

import { isArticleJoRoot, isSameJo, type ArticleLabelParts } from './legalArticleLabel';
import { bareArticleTitle, formatArticleHeading } from './articleHeading';

export type ArticleCreatePayload = {
  number: number;
  /** "제3조의2"의 2. 가지 조문이 아니면 없다 */
  branchNumber?: number;
  title: string;
  /** 소속 절(선택 계층). 절에 속하지 않으면 undefined */
  sectionId?: string;
  clauseNumber?: number;
  itemNumber?: number;
  content?: string;
  hasPrecedent?: boolean;
  hasRelatedLaw?: boolean;
  hasRelatedRule?: boolean;
  relatedPrecedentNote?: string;
  relatedLawNote?: string;
  relatedRuleNote?: string;
};

export function isSubArticleRow(row: { clauseNumber?: number | null; itemNumber?: number | null }): boolean {
  return row.clauseNumber != null || row.itemNumber != null;
}

export function chapterHasJoRoot(chapterArticles: ArticleLabelParts[], jo: number, branch?: number | null): boolean {
  return chapterArticles.some((a) => isSameJo(a, jo, branch) && isArticleJoRoot(a));
}

/**
 * 다음 조 번호. 법령·규정 관례상 조 번호는 문서 전체에서 연속하므로
 * 장 단위가 아니라 규정 전체의 최대 조 번호를 기준으로 계산한다.
 */
export function nextJoNumberForPolicy(
  chapters: { articles?: ArticleLabelParts[] }[] | undefined | null,
): number {
  let max = 0;
  for (const chapter of chapters || []) {
    for (const article of chapter.articles || []) {
      max = Math.max(max, Number(article.number) || 0);
    }
  }
  return max + 1;
}

export function nextClauseNumberForJo(
  chapterArticles: ArticleLabelParts[],
  jo: number,
  branch?: number | null,
): number {
  let max = 0;
  for (const a of chapterArticles) {
    if (!isSameJo(a, jo, branch) || a.clauseNumber == null) continue;
    if (a.itemNumber != null) continue;
    max = Math.max(max, Number(a.clauseNumber));
  }
  return max + 1;
}

export function nextItemNumberForHang(
  chapterArticles: ArticleLabelParts[],
  jo: number,
  clauseNumber: number,
  branch?: number | null,
): number {
  let max = 0;
  for (const a of chapterArticles) {
    if (!isSameJo(a, jo, branch) || Number(a.clauseNumber) !== clauseNumber) continue;
    if (a.itemNumber == null) continue;
    max = Math.max(max, Number(a.itemNumber));
  }
  return max + 1;
}

export function canSubmitNewArticleForm(form: ArticleCreatePayload): boolean {
  const title = String(form.title ?? '').trim();
  const content = String(form.content ?? '').trim();
  if (isSubArticleRow(form)) {
    return content.length > 0;
  }
  return title.length > 0 || content.length > 0;
}

export function buildArticleCreateRequests(
  form: ArticleCreatePayload,
  chapterArticles: ArticleLabelParts[],
): ArticleCreatePayload[] {
  const title = String(form.title ?? '').trim();
  const hasSub = isSubArticleRow(form);
  const hasMain = chapterHasJoRoot(chapterArticles, form.number, form.branchNumber);
  const branch = form.branchNumber ? { branchNumber: form.branchNumber } : {};

  const tags = {
    ...(form.sectionId ? { sectionId: form.sectionId } : {}),
    hasPrecedent: form.hasPrecedent,
    hasRelatedLaw: form.hasRelatedLaw,
    hasRelatedRule: form.hasRelatedRule,
    relatedPrecedentNote: form.relatedPrecedentNote,
    relatedLawNote: form.relatedLawNote,
    relatedRuleNote: form.relatedRuleNote,
  };

  if (hasSub && title && !hasMain) {
    return [
      { number: form.number, ...branch, title, content: undefined, ...tags },
      {
        number: form.number,
        ...branch,
        title: '',
        clauseNumber: form.clauseNumber,
        itemNumber: form.itemNumber,
        content: form.content,
        ...tags,
      },
    ];
  }

  return [
    {
      number: form.number,
      ...branch,
      title: hasSub ? title : title,
      clauseNumber: form.clauseNumber,
      itemNumber: form.itemNumber,
      content: form.content,
      ...tags,
    },
  ];
}

/**
 * 조 제목 — 조 머리 행의 제목. 조 머리 행이 없는 옛 데이터(조 제목을 하나뿐인 제1항에 적어 둔 조)면 그 항의 제목.
 * 조 머리 행이 있으면(제목이 비어도) 항의 제목은 그 항의 부제다 — 편집기는 조 머리 행이 있는 조의 항 제목을 '항 부제'로
 * 받는다. 이 값은 목차뿐 아니라 전문 보기·PDF·한/글·TXT 의 조 머리(`제1조(목적)`)에도 들어가므로 올리는 경우를 좁게 둔다(T-211).
 * `chapterArticles` 는 거르기 전의 행이어야 한다 — 걸러진 행으로 추정하면 보는 방법에 따라 조 제목이 바뀐다.
 */
export function inferJoTitle(
  chapterArticles: (ArticleLabelParts & { title?: string | null })[],
  jo: number,
  branch?: number | null,
): string {
  const sameJo = chapterArticles.filter((a) => isSameJo(a, jo, branch));
  const main = sameJo.find((a) => isArticleJoRoot(a));
  if (main) return String(main.title ?? '').trim();

  // 조 제목을 항에 적어 둔 옛 데이터 — 제1항 하나뿐일 때만 조 제목으로 본다. 다른 번호의 항까지 올리면
  // `hangRepeatsJoTitle`(제1항만 감춘다)과 어긋나 머리와 항 줄에 같은 글이 두 번 나온다
  const hangRows = sameJo.filter((a) => a.clauseNumber != null && a.itemNumber == null);
  const mokRows = sameJo.filter((a) => a.itemNumber != null);
  if (hangRows.length === 1 && mokRows.length === 0 && Number(hangRows[0].clauseNumber) === 1) {
    return String(hangRows[0].title ?? '').trim();
  }
  return '';
}

export function segmentArticleHeading(
  article: ArticleLabelParts & { title?: string },
  chapterArticles: ArticleLabelParts[],
): { joLine: string; subLine: string | null } {
  const jo = Number(article.number);
  const branch = Number(article.branchNumber) || null;
  const joTitle = inferJoTitle(chapterArticles, jo, branch);

  const joLine = formatArticleHeading(jo, branch, joTitle);

  if (isArticleJoRoot(article)) return { joLine, subLine: null };

  const parts: string[] = [];
  if (article.clauseNumber != null) parts.push(`항 ${article.clauseNumber}`);
  if (article.itemNumber != null) parts.push(`목 ${article.itemNumber}`);

  return { joLine, subLine: parts.length ? parts.join(' · ') : null };
}

/**
 * 항의 제목이 조 제목을 되풀이할 뿐인지 — 조 머리(`제1조(목적)`)에 이미 적었으므로 항 줄에 다시 적지 않는다.
 * 옛 데이터는 조 제목을 제1항에 두었다(조 머리 행 없이 항 하나에만, 또는 조 머리 행과 함께 복제).
 * 목차와 전문 보기·내보내기가 같은 판정을 쓴다(T-211).
 */
export function hangRepeatsJoTitle(article: ArticleLabelParts & { title?: string | null }, joTitle: string): boolean {
  // 겉 괄호를 벗긴 글로 견준다 — 머리에 `제1조(목적)`으로 적는 제목 `(목적)`과 항의 `목적`은 같은 글이다
  const head = bareArticleTitle(joTitle);
  return (
    !!head &&
    article.clauseNumber != null &&
    article.itemNumber == null &&
    Number(article.clauseNumber) === 1 &&
    bareArticleTitle(article.title) === head
  );
}

export function titleFieldLabel(form: { clauseNumber?: number; itemNumber?: number }): string {
  if (form.itemNumber != null) return '목 부제 (선택)';
  if (form.clauseNumber != null) return '항 부제 (선택)';
  return '조 제목 (선택)';
}

export function titleFieldHint(form: { clauseNumber?: number; itemNumber?: number }): string {
  if (isSubArticleRow(form)) {
    return '조 제목은 「조 번호」만 넣을 때 씁니다. 항·목은 본문(초기 내용)만 입력해도 됩니다.';
  }
  return '예) 목적, 정의 — 본문만 넣을 경우 비워도 됩니다.';
}

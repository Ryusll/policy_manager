/** 조·항·목 추가/수정 폼 — 법령형 구조 */

import { isArticleJoRoot, type ArticleLabelParts } from './legalArticleLabel';

export type ArticleCreatePayload = {
  number: number;
  title: string;
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

export function chapterHasJoRoot(chapterArticles: ArticleLabelParts[], jo: number): boolean {
  return chapterArticles.some((a) => Number(a.number) === jo && isArticleJoRoot(a));
}

export function nextClauseNumberForJo(chapterArticles: ArticleLabelParts[], jo: number): number {
  let max = 0;
  for (const a of chapterArticles) {
    if (Number(a.number) !== jo || a.clauseNumber == null) continue;
    if (a.itemNumber != null) continue;
    max = Math.max(max, Number(a.clauseNumber));
  }
  return max + 1;
}

export function nextItemNumberForHang(
  chapterArticles: ArticleLabelParts[],
  jo: number,
  clauseNumber: number,
): number {
  let max = 0;
  for (const a of chapterArticles) {
    if (Number(a.number) !== jo || Number(a.clauseNumber) !== clauseNumber) continue;
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
  const hasMain = chapterHasJoRoot(chapterArticles, form.number);

  const tags = {
    hasPrecedent: form.hasPrecedent,
    hasRelatedLaw: form.hasRelatedLaw,
    hasRelatedRule: form.hasRelatedRule,
    relatedPrecedentNote: form.relatedPrecedentNote,
    relatedLawNote: form.relatedLawNote,
    relatedRuleNote: form.relatedRuleNote,
  };

  if (hasSub && title && !hasMain) {
    return [
      { number: form.number, title, content: undefined, ...tags },
      {
        number: form.number,
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
      title: hasSub ? title : title,
      clauseNumber: form.clauseNumber,
      itemNumber: form.itemNumber,
      content: form.content,
      ...tags,
    },
  ];
}

export function inferJoTitle(
  chapterArticles: (ArticleLabelParts & { title?: string })[],
  jo: number,
): string {
  const sameJo = chapterArticles.filter((a) => Number(a.number) === jo);
  const main = sameJo.find((a) => isArticleJoRoot(a));
  const fromMain = String(main?.title ?? '').trim();
  if (fromMain) return fromMain;

  const hangRows = sameJo
    .filter((a) => a.clauseNumber != null && a.itemNumber == null)
    .sort((a, b) => Number(a.clauseNumber) - Number(b.clauseNumber));
  const mokRows = sameJo.filter((a) => a.itemNumber != null);
  if (hangRows.length === 1 && mokRows.length === 0) {
    const only = String(hangRows[0].title ?? '').trim();
    if (only) return only;
  }
  return '';
}

export function segmentArticleHeading(
  article: ArticleLabelParts & { title?: string },
  chapterArticles: ArticleLabelParts[],
): { joLine: string; subLine: string | null } {
  const jo = Number(article.number);
  const joTitle = inferJoTitle(chapterArticles, jo);

  if (isArticleJoRoot(article)) {
    return {
      joLine: joTitle ? `제${jo}조 (${joTitle})` : `제${jo}조`,
      subLine: null,
    };
  }

  const parts: string[] = [];
  if (article.clauseNumber != null) parts.push(`항 ${article.clauseNumber}`);
  if (article.itemNumber != null) parts.push(`목 ${article.itemNumber}`);

  return {
    joLine: joTitle ? `제${jo}조 (${joTitle})` : `제${jo}조`,
    subLine: parts.length ? parts.join(' · ') : null,
  };
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

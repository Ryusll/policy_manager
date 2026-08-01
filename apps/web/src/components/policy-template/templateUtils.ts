import { escapeRegExp } from '../../lib/searchRegex';
import { sanitizeTemplateCss, sanitizeTemplateHtml } from './templateSanitize';
import {
  formatArticleJo,
  formatClauseHang,
  formatItemMok,
  isArticleJoRoot,
  isChapterHeaderHidden,
} from '../../lib/legalArticleLabel';

/**
 * 템플릿 HTML sanitize.
 * 과거 정규식 구현은 따옴표 없는 이벤트 핸들러(`onerror=alert(1)`) 등을 통과시켰다.
 * 이제 DOMPurify 기반 `sanitizeTemplateHtml`에 위임한다(`templateSanitize.ts`).
 */
export function sanitizeHtmlLite(html: string) {
  return sanitizeTemplateHtml(html);
}

/** 템플릿 CSS sanitize. `templateSanitize.ts`의 정책에 위임한다. */
export function sanitizeCssLite(css: string) {
  return sanitizeTemplateCss(css);
}

function resolvePath(data: any, path: string) {
  const parts = path.split('.');
  let cursor = data;
  for (const key of parts) {
    if (cursor == null) return '';
    cursor = cursor[key];
  }
  if (cursor == null) return '';
  if (typeof cursor === 'string' || typeof cursor === 'number' || typeof cursor === 'boolean') {
    return String(cursor);
  }
  return '';
}

export function applyTokens(template: string, data: Record<string, any>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path) => resolvePath(data, path));
}

/** Enterprise {{content}} 삽입용: 조·항 구조를 유지한 HTML (본문은 이스케이프) */
export function escapeHtmlText(s: string) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 이스케이프된 HTML 조각 안에서 검색어를 `<mark>`로 감쌉니다. */
export function wrapSearchHighlightsInEscapedHtml(escaped: string, query: string): string {
  const q = query.trim();
  if (!q) return escaped;
  let re: RegExp;
  try {
    re = new RegExp(`(${escapeRegExp(q)})`, 'gi');
  } catch {
    return escaped;
  }
  const parts = escaped.split(re);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? `<mark class="tmpl-search-hit tmpl-fullview-hit">${part}</mark>`
        : part,
    )
    .join('');
}

function appendArticleBodyHtml(
  out: string[],
  article: any,
  rowClass: string,
  highlightQuery?: string,
) {
  const sub =
    article?.itemNumber != null
      ? formatItemMok(article.itemNumber)
      : article?.clauseNumber != null
        ? formatClauseHang(article.clauseNumber)
        : isArticleJoRoot(article)
          ? ''
          : '';
  out.push(`<article class="tmpl-article ${rowClass}">`);
  if (sub) {
    out.push('<div class="tmpl-article-head">');
    const subInner = wrapSearchHighlightsInEscapedHtml(escapeHtmlText(sub), highlightQuery ?? '');
    out.push(`<span class="tmpl-article-sub">${subInner}</span>`);
    if (article?.title) {
      const nameInner = wrapSearchHighlightsInEscapedHtml(
        ` ${escapeHtmlText(String(article.title))}`,
        highlightQuery ?? '',
      );
      out.push(`<span class="tmpl-article-name">${nameInner}</span>`);
    }
    out.push('</div>');
  } else if (article?.title) {
    out.push('<div class="tmpl-article-head">');
    const nameInner = wrapSearchHighlightsInEscapedHtml(
      escapeHtmlText(String(article.title)),
      highlightQuery ?? '',
    );
    out.push(`<span class="tmpl-article-name">${nameInner}</span>`);
    out.push('</div>');
  }
  const raw = article?.versions?.[0]?.content;
  const bodyInner = wrapSearchHighlightsInEscapedHtml(
    escapeHtmlText(raw != null && raw !== '' ? String(raw) : '시행중 버전이 없습니다.'),
    highlightQuery ?? '',
  );
  out.push(`<div class="tmpl-article-body">${bodyInner}</div>`);
  out.push('</article>');
}

function appendJoGroupHtml(out: string[], group: any, highlightQuery?: string) {
  const an = Number(group?.articleNumber) || 0;
  out.push(`<div class="tmpl-article-block tmpl-art-${an}" data-article="${an}">`);
  out.push(`<div class="tmpl-article-label">${escapeHtmlText(formatArticleJo(an))}</div>`);

  if (group?.main) appendArticleBodyHtml(out, group.main, 'tmpl-row-jo', highlightQuery);

  const hangs = Array.isArray(group?.hangs) ? group.hangs : [];
  if (hangs.length > 0) {
    for (const hang of hangs) {
      if (hang.hang) appendArticleBodyHtml(out, hang.hang, 'tmpl-row-hang', highlightQuery);
      for (const item of hang.items || []) {
        appendArticleBodyHtml(out, item, 'tmpl-row-item', highlightQuery);
      }
    }
    for (const item of group.orphanItems || []) {
      appendArticleBodyHtml(out, item, 'tmpl-row-hang', highlightQuery);
    }
  } else {
    for (const article of group?.items || []) {
      appendArticleBodyHtml(out, article, 'tmpl-row-hang', highlightQuery);
    }
  }
  out.push('</div>');
}

export function buildEnterprisePolicyBodyHtml(fullViewGroups: any[], highlightQuery?: string): string {
  if (!Array.isArray(fullViewGroups) || fullViewGroups.length === 0) {
    return '<p class="tmpl-empty">등록된 본문이 없습니다.</p>';
  }
  const out: string[] = [];
  out.push('<div class="tmpl-chapters">');
  for (const chapter of fullViewGroups) {
    const cn = Number(chapter?.number) || 0;
    const hideHead = isChapterHeaderHidden(chapter);
    out.push(`<section class="tmpl-chapter tmpl-chapter-${cn}" data-chapter="${cn}">`);
    if (!hideHead) {
      out.push('<header class="tmpl-chapter-head">');
      const chTitleInner = wrapSearchHighlightsInEscapedHtml(
        escapeHtmlText(String(chapter?.title ?? '')),
        highlightQuery ?? '',
      );
      out.push(`<h2 class="tmpl-chapter-title">제${cn}장 ${chTitleInner}</h2>`);
      out.push('</header>');
    }
    out.push('<div class="tmpl-chapter-body">');
    const groups = Array.isArray(chapter?.groups) ? chapter.groups : [];
    for (const group of groups) {
      appendJoGroupHtml(out, group, highlightQuery);
    }
    out.push('</div></section>');
  }
  out.push('</div>');
  return out.join('');
}


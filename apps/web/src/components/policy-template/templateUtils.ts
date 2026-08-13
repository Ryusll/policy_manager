import { escapeRegExp } from '../../lib/searchRegex';
import { sanitizeTemplateCss, sanitizeTemplateHtml } from './templateSanitize';
import {
  formatArticleJo,
  formatClauseHang,
  formatItemMok,
  isChapterHeaderHidden,
} from '../../lib/legalArticleLabel';
import { joGroupRenderRows } from '../../lib/fullViewGroups';

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
        : '';
  const subInner = sub
    ? wrapSearchHighlightsInEscapedHtml(escapeHtmlText(sub), highlightQuery ?? '')
    : '';
  // 부제가 없는 항·목은 법령 표기대로 번호를 본문 첫 줄에 붙여 읽는다("① 본문 …").
  // 별도 줄로 띄우면 인쇄·PDF에서 번호만 덩그러니 남는다.
  const inlineSub = sub && !article?.title;

  out.push(`<article class="tmpl-article ${rowClass}">`);
  if (sub && !inlineSub) {
    out.push('<div class="tmpl-article-head">');
    out.push(`<span class="tmpl-article-sub">${subInner}</span>`);
    if (article?.title) {
      const nameInner = wrapSearchHighlightsInEscapedHtml(
        ` ${escapeHtmlText(String(article.title))}`,
        highlightQuery ?? '',
      );
      out.push(`<span class="tmpl-article-name">${nameInner}</span>`);
    }
    out.push('</div>');
  } else if (!sub && article?.title) {
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
  const bodyLead = inlineSub ? `<span class="tmpl-article-sub">${subInner}</span> ` : '';
  out.push(`<div class="tmpl-article-body">${bodyLead}${bodyInner}</div>`);
  out.push('</article>');
}

const ROW_CLASS_BY_DEPTH = ['tmpl-row-jo', 'tmpl-row-hang', 'tmpl-row-item'] as const;

function appendJoGroupHtml(out: string[], group: any, highlightQuery?: string) {
  const an = Number(group?.articleNumber) || 0;
  out.push(`<div class="tmpl-article-block tmpl-art-${an}" data-article="${an}">`);
  out.push(`<div class="tmpl-article-label">${escapeHtmlText(formatArticleJo(an))}</div>`);

  for (const { article, depth } of joGroupRenderRows(group)) {
    appendArticleBodyHtml(out, article, ROW_CLASS_BY_DEPTH[depth], highlightQuery);
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
    // 블록은 조 번호 순서로 이미 정렬돼 있다(절 헤더는 그 절의 첫 조 앞에 열린다)
    const blocks = Array.isArray(chapter?.blocks) ? chapter.blocks : [];
    for (const block of blocks) {
      if (block?.kind === 'section') {
        const sn = Number(block?.number) || 0;
        out.push(`<section class="tmpl-section tmpl-section-${sn}" data-section="${sn}">`);
        out.push('<header class="tmpl-section-head">');
        const secTitle = wrapSearchHighlightsInEscapedHtml(
          escapeHtmlText(String(block?.title ?? '')),
          highlightQuery ?? '',
        );
        out.push(`<h3 class="tmpl-section-title">제${sn}절 ${secTitle}</h3>`);
        out.push('</header>');
        out.push('<div class="tmpl-section-body">');
        for (const group of block?.groups || []) {
          appendJoGroupHtml(out, group, highlightQuery);
        }
        out.push('</div></section>');
        continue;
      }
      for (const group of block?.groups || []) {
        appendJoGroupHtml(out, group, highlightQuery);
      }
    }
    out.push('</div></section>');
  }
  out.push('</div>');
  return out.join('');
}


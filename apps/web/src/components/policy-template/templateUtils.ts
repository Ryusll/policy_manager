import { escapeRegExp } from '../../lib/searchRegex';
import { sanitizeTemplateCss, sanitizeTemplateHtml } from './templateSanitize';
import {
  formatArticleJo,
  formatClauseHang,
  formatItemMok,
  isChapterHeaderHidden,
} from '../../lib/legalArticleLabel';
import { joGroupRenderRows } from '../../lib/fullViewGroups';
import { noCurrentTextMarker } from '../../lib/versionState';

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
  hasSubRows = false,
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
  // 인쇄·PDF·한글은 공식 문서라 오늘 시행 중인 본문만 담는다(시행 전 초안·시행 예정 개정은 화면에만 표시, T-127).
  // 폐지는 "삭제 <날짜>", 아직 시행 전인 새 조문은 "날짜 시행 예정"으로 적는다.
  // 항·목을 거느린 조의 머리 행은 본문이 없는 게 정상이므로 "시행중 버전이 없습니다"를 찍지 않는다.
  const raw = article?.versions?.[0]?.content;
  const isJoHead = article?.clauseNumber == null && article?.itemNumber == null;
  const emptyText = (article ? noCurrentTextMarker(article) : null) ?? (isJoHead && hasSubRows ? '' : '시행중 버전이 없습니다.');
  const bodyInner = wrapSearchHighlightsInEscapedHtml(
    escapeHtmlText(raw != null && raw !== '' ? String(raw) : emptyText),
    highlightQuery ?? '',
  );
  const bodyLead = inlineSub ? `<span class="tmpl-article-sub">${subInner}</span> ` : '';
  if (bodyLead || bodyInner) out.push(`<div class="tmpl-article-body">${bodyLead}${bodyInner}</div>`);
  out.push('</article>');
}

const ROW_CLASS_BY_DEPTH = ['tmpl-row-jo', 'tmpl-row-hang', 'tmpl-row-item'] as const;

function appendJoGroupHtml(out: string[], group: any, highlightQuery?: string) {
  const an = Number(group?.articleNumber) || 0;
  const branch = Number(group?.articleBranch) || 0;
  const artClass = branch ? `tmpl-art-${an}-${branch}` : `tmpl-art-${an}`;
  const branchAttr = branch ? ` data-branch="${branch}"` : '';
  out.push(`<div class="tmpl-article-block ${artClass}" data-article="${an}"${branchAttr}>`);
  out.push(`<div class="tmpl-article-label">${escapeHtmlText(formatArticleJo(an, branch))}</div>`);

  const rows = joGroupRenderRows(group);
  for (const { article, depth } of rows) {
    appendArticleBodyHtml(out, article, ROW_CLASS_BY_DEPTH[depth], highlightQuery, rows.length > 1);
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
    // 조문 없는 장은 건너뛴다(화면 렌더러와 같은 규칙 — 인쇄·PDF에 빈 장이 남지 않도록)
    const chapterBlocks = Array.isArray(chapter?.blocks) ? chapter.blocks : [];
    if (!chapterBlocks.some((block: any) => (block?.groups?.length ?? 0) > 0)) continue;
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
    for (const block of chapterBlocks) {
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


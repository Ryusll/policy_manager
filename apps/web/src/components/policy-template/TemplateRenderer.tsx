import { useMemo } from 'react';
import { clsx } from 'clsx';
import {
  applyTokens,
  buildEnterprisePolicyBodyHtml,
  sanitizeCssLite,
  sanitizeHtmlLite,
} from './templateUtils';
import { useBrandStore } from '../../stores/brandStore';
import { highlightText } from '../../lib/highlightSearch';
import {
  formatArticleJo,
  formatClauseHang,
  formatItemMok,
  isChapterHeaderHidden,
} from '../../lib/legalArticleLabel';
import { joGroupRenderRows } from '../../lib/fullViewGroups';

type TemplateLike = {
  id?: string;
  name?: string;
  layoutJson?: Record<string, unknown>;
  cssText?: string;
};

type BasicTemplateConfig = {
  showHeader?: boolean;
  showMeta?: boolean;
  showFooter?: boolean;
  footerText?: string;
  showArticleTitle?: boolean;
  /** @deprecated showRevisionDate 사용 */
  showDate?: boolean;
  showRevisionDate?: boolean;
  showEffectiveDate?: boolean;
  showLogo?: boolean;
  logoMaxHeight?: number;
  showApprovalLine?: boolean;
  approvalLabel?: string;
  useA4Print?: boolean;
  chapterPageBreak?: boolean;
  showPageNumber?: boolean;
};

const DEPTH_PADDING = ['pl-0', 'pl-4', 'pl-8'] as const;

export function DefaultPolicyRenderer({
  fullViewGroups,
  highlightQuery = '',
  showArticleTitle = true,
}: {
  fullViewGroups: any[];
  highlightQuery?: string;
  showArticleTitle?: boolean;
}) {
  return (
    <div className="space-y-3">
      {fullViewGroups.map((chapter: any) => {
        const hideHead = isChapterHeaderHidden(chapter);
        return (
        <section key={chapter.id} className={`border border-gray-200 rounded ${chapter.className || ''}`}>
          {!hideHead && (
            <header className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-sm font-semibold text-gray-800">
              {highlightText(`제${chapter.number}장 ${chapter.title}`, highlightQuery)}
            </header>
          )}
          <div className="p-3 space-y-2">
            {chapter.groups.map((group: any) => (
              <JoGroupBlock
                key={`${chapter.id}-${group.articleNumber}`}
                group={group}
                highlightQuery={highlightQuery}
                showArticleTitle={showArticleTitle}
              />
            ))}
            {/* 절(선택 계층) — 절 미소속 조문 뒤에 번호순으로 표시 */}
            {(chapter.sectionBlocks || []).map((section: any) => (
              <section key={section.id} className="border border-gray-200 rounded">
                <header className="px-2.5 py-1.5 bg-gray-50/80 border-b border-gray-200 text-xs font-semibold text-gray-700">
                  {highlightText(`제${section.number}절 ${section.title}`, highlightQuery)}
                </header>
                <div className="p-2 space-y-2">
                  {(section.groups || []).map((group: any) => (
                    <JoGroupBlock
                      key={`${section.id}-${group.articleNumber}`}
                      group={group}
                      highlightQuery={highlightQuery}
                      showArticleTitle={showArticleTitle}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
        );
      })}
    </div>
  );
}

/** 조 그룹 1건(조 루트 + 항 + 목). 장 직속과 절 소속이 같은 모양으로 그려지도록 분리했다. */
function JoGroupBlock({
  group,
  highlightQuery,
  showArticleTitle,
}: {
  group: any;
  highlightQuery: string;
  showArticleTitle: boolean;
}) {
  return (
    <div className="text-sm border border-gray-100 rounded p-2 bg-white">
      <div className="font-semibold text-gray-800 mb-1">
        {highlightText(formatArticleJo(group.articleNumber), highlightQuery)}
      </div>
      <div className="space-y-2">
        {joGroupRenderRows(group).map(({ article, depth }, idx) => (
          <FullViewArticleRow
            key={article.id ?? `${group.articleNumber}-${idx}`}
            article={article}
            plClass={DEPTH_PADDING[depth]}
            highlightQuery={highlightQuery}
            showArticleTitle={showArticleTitle}
          />
        ))}
      </div>
    </div>
  );
}

function FullViewArticleRow({
  article,
  plClass,
  highlightQuery,
  showArticleTitle,
}: {
  article: any;
  plClass: string;
  highlightQuery: string;
  showArticleTitle: boolean;
}) {
  const sub =
    article.itemNumber != null
      ? formatItemMok(article.itemNumber)
      : article.clauseNumber != null
        ? formatClauseHang(article.clauseNumber)
        : null;
  const title = showArticleTitle ? String(article.title ?? '').trim() : '';
  // 부제 없는 항·목은 법령 표기대로 번호를 본문 첫 줄에 붙인다("① 본문 …").
  // HTML 템플릿·PDF 출력(`buildEnterprisePolicyBodyHtml`)과 같은 규칙이어야 화면과 인쇄물이 일치한다.
  const inlineSub = !!sub && !title;
  const headLine = sub ? `${sub}${title ? ` ${title}` : ''}` : title;
  return (
    <div className={clsx(plClass, 'border-l-2 border-gray-100 pl-3')}>
      {headLine && !inlineSub ? (
        <div className="font-medium text-gray-800">{highlightText(headLine, highlightQuery)}</div>
      ) : null}
      <div
        className={clsx(
          'text-gray-700 whitespace-pre-wrap leading-relaxed',
          !inlineSub && headLine && 'mt-1',
        )}
      >
        {inlineSub ? <span className="font-medium text-gray-800">{sub} </span> : null}
        {highlightText(article.versions?.[0]?.content || '시행중 버전이 없습니다.', highlightQuery)}
      </div>
    </div>
  );
}

export default function TemplateRenderer({
  template,
  data,
  fullViewGroups,
  highlightQuery = '',
}: {
  template?: TemplateLike | null;
  data: Record<string, any>;
  fullViewGroups: any[];
  highlightQuery?: string;
}) {
  const brandLogoDataUrl = useBrandStore((s) => s.brandLogoDataUrl);
  const rawHtml = typeof template?.layoutJson?.rawHtml === 'string' ? (template.layoutJson.rawHtml as string) : '';
  const mode = typeof template?.layoutJson?.mode === 'string' ? String(template.layoutJson.mode) : '';
  const basicConfig = (template?.layoutJson?.basicConfig || {}) as BasicTemplateConfig;
  const cssText = typeof template?.cssText === 'string' ? template.cssText : '';
  const enterpriseBodyHtml = useMemo(
    () => buildEnterprisePolicyBodyHtml(fullViewGroups, highlightQuery),
    [fullViewGroups, highlightQuery],
  );
  const tokenData = useMemo(
    () => ({
      ...data,
      content: enterpriseBodyHtml,
      logo: brandLogoDataUrl
        ? `<img src="${brandLogoDataUrl}" alt="" class="veda-brand-logo" style="max-width:220px;height:auto;display:block;" />`
        : '',
    }),
    [data, enterpriseBodyHtml, brandLogoDataUrl],
  );
  const renderedHtml = useMemo(() => {
    if (!rawHtml.trim()) return '';
    return sanitizeHtmlLite(applyTokens(rawHtml, tokenData));
  }, [rawHtml, tokenData]);
  const safeCss = useMemo(() => sanitizeCssLite(cssText), [cssText]);

  if (mode === 'basic') {
    const showHeader = basicConfig.showHeader !== false;
    const showMeta = basicConfig.showMeta !== false;
    const showFooter = basicConfig.showFooter === true;
    const legacyDate = basicConfig.showDate !== false;
    const showRevisionDate =
      basicConfig.showRevisionDate === true || (legacyDate && basicConfig.showRevisionDate !== false);
    const showEffectiveDate = basicConfig.showEffectiveDate === true;
    const showArticleTitle = basicConfig.showArticleTitle !== false;
    const showLogo = basicConfig.showLogo !== false;
    const logoMaxHeight = Math.max(24, Number(basicConfig.logoMaxHeight || 48));
    const showApprovalLine = basicConfig.showApprovalLine === true;
    const approvalLabel = basicConfig.approvalLabel?.trim() || '결재';
    const useA4Print = basicConfig.useA4Print !== false;
    const chapterPageBreak = basicConfig.chapterPageBreak === true;
    const showPageNumber = basicConfig.showPageNumber === true;
    const revisionDate = String(data?.revisionDate || data?.today || '');
    const effectiveDate = String(data?.effectiveDate || '');
    return (
      <div className="space-y-3 basic-template-wrap">
        {(useA4Print || chapterPageBreak || showPageNumber) && (
          <style>
            {`
            @media print {
              ${useA4Print ? '@page { size: A4; margin: 14mm 12mm 14mm 12mm; }' : ''}
              ${chapterPageBreak ? '.basic-template-wrap .chapter-section { page-break-before: always; break-before: page; } .basic-template-wrap .chapter-section:first-child { page-break-before: auto; break-before: auto; }' : ''}
              ${
                showPageNumber
                  ? '.basic-template-wrap .basic-print-page-number{display:block !important;position:fixed;right:8mm;bottom:6mm;font-size:11px;color:#6b7280;background:#fff;padding:0 2mm;}.basic-template-wrap .basic-print-page-number .page-num::after{content:counter(page);}'
                  : ''
              }
            }
          `}
          </style>
        )}
        {showHeader && (
          <section className="border border-gray-200 rounded bg-white p-4">
            {showLogo && brandLogoDataUrl && (
              <div className="mb-3">
                <img src={brandLogoDataUrl} alt="company logo" style={{ maxHeight: `${logoMaxHeight}px` }} />
              </div>
            )}
            <h2 className="text-xl font-bold text-gray-900">{String(data?.policy?.title || '')}</h2>
            {showMeta && (
              <p className="text-xs text-gray-500 mt-1">
                코드: {String(data?.policy?.code || '-')}
                {showRevisionDate && revisionDate ? ` · 개정일: ${revisionDate}` : ''}
                {showEffectiveDate && effectiveDate ? ` · 시행일: ${effectiveDate}` : ''}
              </p>
            )}
            {showApprovalLine && (
              <div className="mt-4">
                <div className="text-xs text-gray-600 mb-1.5">{approvalLabel}</div>
                <table className="w-full text-xs border border-gray-300 border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-300 px-2 py-1.5 text-center font-semibold text-gray-700">작성</th>
                      <th className="border border-gray-300 px-2 py-1.5 text-center font-semibold text-gray-700">검토</th>
                      <th className="border border-gray-300 px-2 py-1.5 text-center font-semibold text-gray-700">승인</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-gray-300 h-12" />
                      <td className="border border-gray-300 h-12" />
                      <td className="border border-gray-300 h-12" />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        <DefaultPolicyRenderer
          highlightQuery={highlightQuery}
          showArticleTitle={showArticleTitle}
          fullViewGroups={fullViewGroups.map((chapter: any) => ({
            ...chapter,
            className: chapterPageBreak && !isChapterHeaderHidden(chapter) ? 'chapter-section' : undefined,
          }))}
        />
        {showFooter && (
          <footer className="text-xs text-gray-500 border-t border-gray-200 pt-2">
            {basicConfig.footerText?.trim() || '본 문서는 회사 규정 양식으로 출력되었습니다.'}
            {showPageNumber && <span className="float-right">페이지 <span className="page-num" /></span>}
          </footer>
        )}
        {showPageNumber && (
          <div className="basic-print-page-number hidden" aria-hidden>
            페이지 <span className="page-num" />
          </div>
        )}
      </div>
    );
  }

  if (!renderedHtml) {
    return <DefaultPolicyRenderer fullViewGroups={fullViewGroups} highlightQuery={highlightQuery} />;
  }

  return (
    <div className="policy-template-render policy-template-render--html">
      {safeCss ? <style>{safeCss}</style> : null}
      <div className="policy-template-html-root" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
    </div>
  );
}

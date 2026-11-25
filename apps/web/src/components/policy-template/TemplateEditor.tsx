import { useMemo } from 'react';
import { applyTokens, sanitizeCssLite, sanitizeHtmlLite } from './templateUtils';
import { TEMPLATE_TOKENS, collectUnknownTokens } from './templateTokens';

export default function TemplateEditor({
  html,
  css,
  onHtmlChange,
  onCssChange,
  sampleData,
}: {
  html: string;
  css: string;
  onHtmlChange: (v: string) => void;
  onCssChange: (v: string) => void;
  sampleData: Record<string, any>;
}) {
  const previewHtml = useMemo(() => sanitizeHtmlLite(applyTokens(html, sampleData)), [html, sampleData]);
  const previewCss = useMemo(() => sanitizeCssLite(css), [css]);
  // 미지원 토큰은 렌더 시 빈 문자열로 사라지므로 오타를 알아채기 어렵다 → 경고로 노출
  const unknownTokens = useMemo(() => collectUnknownTokens(html), [html]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      <div className="space-y-3 lg:col-span-5">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">HTML 템플릿</label>
          <textarea
            className="input font-mono text-xs resize-y min-h-[220px]"
            value={html}
            onChange={(e) => onHtmlChange(e.target.value)}
            placeholder="<h1>{{policy.title}}</h1>"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">CSS</label>
          <textarea
            className="input font-mono text-xs resize-y min-h-[120px]"
            value={css}
            onChange={(e) => onCssChange(e.target.value)}
            placeholder=".doc-title { font-size: 28px; }"
          />
        </div>
        {unknownTokens.length > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            지원하지 않는 토큰이 있습니다(출력 시 빈칸으로 처리됩니다):{' '}
            {unknownTokens.map((t) => `{{${t}}}`).join(', ')}
          </p>
        )}
        <details className="text-xs text-gray-600 border border-gray-200 rounded bg-gray-50 px-3 py-2" open>
          <summary className="cursor-pointer font-semibold text-gray-700">
            사용 가능한 치환 토큰 ({TEMPLATE_TOKENS.length}종)
          </summary>
          <ul className="mt-2 space-y-1">
            {TEMPLATE_TOKENS.map((t) => (
              <li key={t.token} className="flex gap-2">
                <code className="bg-white px-1 rounded border shrink-0">{`{{${t.token}}}`}</code>
                <span className="text-gray-600">
                  {t.label} — {t.description}
                  {t.kind === 'html' && <span className="text-gray-400"> (HTML)</span>}
                </span>
              </li>
            ))}
          </ul>
        </details>
        <details className="text-xs text-gray-600 border border-gray-200 rounded bg-gray-50 px-3 py-2">
          <summary className="cursor-pointer font-semibold text-gray-700">Enterprise 자유 레이아웃 안내</summary>
          <ul className="mt-2 space-y-1.5 list-disc pl-4">
            <li>
              {'{{content}}'}에는 규정 전문이 <code className="bg-white px-1 rounded border">.tmpl-chapter</code>,{' '}
              <code className="bg-white px-1 rounded border">.tmpl-article-body</code> 등 시맨틱 클래스로 들어갑니다. CSS로
              위치·여백·테두리·글꼴을 자유롭게 지정하세요.
            </li>
            <li>
              로고는 HTML 아무 위치에 {'{{logo}}'}를 두면 됩니다(예: 우상단 절대배치:{' '}
              <code className="bg-white px-1 rounded border">.tmpl-logo-area {'{ position:absolute; }'}</code>).
            </li>
            <li>
              인쇄 여백·용지: <code className="bg-white px-1 rounded border">@media print</code> 안에서{' '}
              <code className="bg-white px-1 rounded border">@page {'{ size:A4; margin: … }'}</code> 를 사용하세요.
            </li>
            <li>
              쪽번호: 브라우저마다 다르지만, 고정 헤더/푸터에{' '}
              <code className="bg-white px-1 rounded border">position:fixed</code> +{' '}
              <code className="bg-white px-1 rounded border">counter(page)</code> 조합을 쓰는 방식이 흔합니다(미리보기·실제
              인쇄에서 각각 확인 권장).
            </li>
            <li>첫 장만 페이지 나눔을 피하려면, 장 단위 <code className="bg-white px-1 rounded border">page-break-before</code> 규칙에{' '}
              <code className="bg-white px-1 rounded border">:first-child</code> 예외를 두세요.</li>
          </ul>
        </details>
      </div>
      <div className="border border-gray-200 rounded bg-white lg:col-span-7">
        <div className="px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-700">미리보기</div>
        <div className="p-3 min-h-[620px] max-h-[78vh] overflow-auto">
          {previewCss ? <style>{previewCss}</style> : null}
          <div dangerouslySetInnerHTML={{ __html: previewHtml || '<p class="text-gray-500">HTML을 입력하면 미리보기가 표시됩니다.</p>' }} />
        </div>
      </div>
    </div>
  );
}

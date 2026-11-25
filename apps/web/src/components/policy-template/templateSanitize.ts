import DOMPurify from 'dompurify';

/**
 * 출력 템플릿(Enterprise 자유 HTML/CSS) sanitize — 클라이언트 측.
 *
 * 이전에는 정규식으로 태그·속성을 지웠으나, 따옴표 없는 이벤트 핸들러
 * (`<img src=x onerror=alert(1)>`)나 허용목록에 없던 태그(`<svg onload=…>`)가
 * 그대로 통과하는 우회가 있었다. 검증된 라이브러리(DOMPurify)로 교체했다.
 *
 * 서버(`apps/api/src/templates/templates.service.ts`)도 저장 시 동일한 정책으로
 * sanitize한다(서버가 보안 경계, 클라이언트는 방어 2차선). 허용 목록을 바꿀 때는
 * **양쪽을 함께** 수정해야 한다.
 */

/** 문서 양식에 필요한 태그만 허용 (스크립트·프레임·폼 계열 전면 배제) */
export const TEMPLATE_ALLOWED_TAGS = [
  'div', 'span', 'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'small', 'sub', 'sup',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'img', 'figure', 'figcaption', 'blockquote', 'pre', 'code',
  'header', 'footer', 'section', 'article', 'aside', 'main', 'nav',
  'mark', 'time', 'address', 'a',
];

/** 이벤트 핸들러(on*)는 전부 불허 — 목록에 없는 속성은 자동 제거된다 */
export const TEMPLATE_ALLOWED_ATTRS = [
  'class', 'id', 'style', 'title', 'lang', 'dir',
  'src', 'alt', 'width', 'height',
  'colspan', 'rowspan', 'span', 'align', 'valign',
  'datetime', 'cite',
  // <a>: DOMPurify가 기본 URI 검사로 javascript: 등을 차단한다
  'href', 'target', 'rel',
];

/** 템플릿 HTML sanitize. 스크립트 실행 가능한 요소·속성을 제거한다. */
export function sanitizeTemplateHtml(html: string): string {
  return DOMPurify.sanitize(String(html ?? ''), {
    ALLOWED_TAGS: TEMPLATE_ALLOWED_TAGS,
    ALLOWED_ATTR: TEMPLATE_ALLOWED_ATTRS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    // <html>/<body> 래핑 없이 조각만 반환
    WHOLE_DOCUMENT: false,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  });
}

/**
 * 템플릿 CSS sanitize.
 * CSS는 DOMPurify 대상이 아니므로, 스크립트 실행·외부 로드로 이어지는 구문을 제거한다.
 * (`expression()`, `behavior:`, `-moz-binding`, `@import`, `javascript:` 등)
 */
export function sanitizeTemplateCss(css: string): string {
  let out = String(css ?? '');
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/@import\b/gi, '');
  out = out.replace(/@charset\b/gi, '');
  out = out.replace(/@namespace\b/gi, '');
  out = out.replace(/expression\s*\(/gi, '');
  out = out.replace(/behavior\s*:/gi, '');
  out = out.replace(/-moz-binding\s*:/gi, '');
  out = out.replace(/url\(\s*['"]?\s*(javascript:|vbscript:|data:text\/html)/gi, 'url(about:blank');
  out = out.replace(/javascript:/gi, '');
  out = out.replace(/vbscript:/gi, '');
  out = out.replace(/data:text\/html/gi, '');
  // </style> 로 스타일 컨텍스트를 탈출해 스크립트를 여는 것을 방지
  out = out.replace(/<\/?style\b[^>]*>/gi, '');
  out = out.replace(/<\/?script\b[^>]*>/gi, '');
  return out;
}

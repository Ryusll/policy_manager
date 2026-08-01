import { formatKoDate } from '../../lib/legalArticleLabel';

/**
 * 출력 템플릿 가변 변수(토큰) 계약 — 단일 소스.
 *
 * Pro 기본 빌더(basicConfig)와 Enterprise 자유 HTML(rawHtml)이 같은 데이터를 참조해야 하므로
 * 지원 토큰 목록과 데이터 구성 로직을 이 파일 하나로 고정한다. 새 토큰을 추가할 때는
 * `TEMPLATE_TOKENS`에 항목을 넣고 `buildTemplateTokenData`가 값을 채우도록 함께 수정한다.
 */

export type TemplateTokenKind = 'text' | 'html';

export type TemplateTokenSpec = {
  /** 템플릿에 쓰는 경로. 예: `policy.title` → `{{policy.title}}` */
  token: string;
  label: string;
  description: string;
  kind: TemplateTokenKind;
  /** 렌더 시점에만 채워지는 토큰(에디터 미리보기에서는 대체값 사용) */
  renderOnly?: boolean;
};

export const TEMPLATE_TOKENS: TemplateTokenSpec[] = [
  {
    token: 'tenant.name',
    label: '회사명',
    description: '로그인한 테넌트(고객사) 이름',
    kind: 'text',
  },
  {
    token: 'policy.title',
    label: '규정명',
    description: '규정 제목',
    kind: 'text',
  },
  {
    token: 'policy.code',
    label: '규정 코드',
    description: '테넌트 내 고유 규정 코드',
    kind: 'text',
  },
  {
    token: 'today',
    label: '출력일',
    description: '문서를 출력·렌더하는 날짜 (ko-KR 형식)',
    kind: 'text',
  },
  {
    token: 'revisionDate',
    label: '개정일',
    description: '규정 개정일. 미설정 시 빈 문자열',
    kind: 'text',
  },
  {
    token: 'effectiveDate',
    label: '시행일',
    description: '규정 시행일. 미설정 시 빈 문자열',
    kind: 'text',
  },
  {
    token: 'content',
    label: '규정 본문',
    description: '조·항·목 구조를 유지한 규정 전문 HTML. 본문 텍스트는 이스케이프된다',
    kind: 'html',
    renderOnly: true,
  },
  {
    token: 'logo',
    label: '회사 로고',
    description: '테넌트 브랜딩 로고 `<img>` 태그. 로고 미설정 시 빈 문자열',
    kind: 'html',
    renderOnly: true,
  },
];

/** `{{...}}` 안에 쓸 수 있는 토큰 경로 집합 */
export const TEMPLATE_TOKEN_PATHS: string[] = TEMPLATE_TOKENS.map((t) => t.token);

/**
 * 토큰 데이터의 원천. 실제 규정 렌더와 설정 화면 미리보기가 **모두 이 함수를 통해야** 한다.
 * (한쪽만 필드를 넘겨 미리보기와 실제 출력이 어긋나는 문제를 구조적으로 차단)
 *
 * `content`·`logo`는 렌더 시점 관심사이므로 TemplateRenderer가 덧붙인다.
 */
export type TemplateTokenSource = {
  tenantName?: string | null;
  policyTitle?: string | null;
  policyCode?: string | null;
  /** ISO 문자열 또는 Date. 내부에서 ko-KR 형식으로 변환 */
  revisionDate?: string | Date | null;
  effectiveDate?: string | Date | null;
  /** 출력일. 미지정 시 오늘 */
  today?: string | null;
};

function toIso(value?: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function buildTemplateTokenData(src: TemplateTokenSource): Record<string, unknown> {
  return {
    tenant: { name: src.tenantName || '' },
    policy: {
      title: src.policyTitle || '',
      code: src.policyCode || '',
    },
    today: src.today || new Date().toLocaleDateString('ko-KR'),
    revisionDate: formatKoDate(toIso(src.revisionDate)) || '',
    effectiveDate: formatKoDate(toIso(src.effectiveDate)) || '',
  };
}

/**
 * 템플릿 HTML에서 지원하지 않는 토큰을 찾아낸다(에디터 경고용).
 * `applyTokens`는 미지원 토큰을 빈 문자열로 지우므로, 사용자가 오타를 눈치채기 어렵다.
 */
export function collectUnknownTokens(template: string): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(template ?? ''))) !== null) {
    const path = m[1];
    if (!TEMPLATE_TOKEN_PATHS.includes(path)) found.add(path);
  }
  return [...found];
}

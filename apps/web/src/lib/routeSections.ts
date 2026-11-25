/**
 * 화면 경로의 첫 마디별 경로 표시(브레드크럼) 규칙 — T-212, SRS NFR-9.
 *
 * - 경로 표시는 메뉴와 같은 이름 키(`layout.nav.*`)를 쓴다.
 * - 상세 화면(`/laws/:id`·`/amendments/:id`)은 id 원문 대신 대상 이름을 쓴다 — 이름은 그 화면이
 *   이미 받아 둔 조회 결과에서 읽고, 경로 표시 때문에 요청을 늘리지 않는다(`components/Breadcrumbs`).
 * - 표에 없는 경로·깊이는 그리지 않는다. 영문 경로 마디를 그대로 내보이지 않기 위해서다.
 *
 * `App.tsx` 의 모든 경로가 이 표로 설명돼야 한다 — `tests/routeSections.test.ts` 가 App.tsx 원문에서
 * 경로를 뽑아 대조한다.
 *
 * 상단 메뉴도 이 표에서 나온다(T-214, SRS NFR-10) — `nav` 칸이 있는 화면만 메뉴에 오르고, 이름은 경로 표시와 같은 키다.
 * 날마다 쓰는 업무 화면은 'main', 회사 단위 관리 화면은 '관리' 묶음('admin'). 들어갈 수 있는지는 PrivateRoute 가 부르는
 * 판정 그대로(`lib/viewerAccess` 의 privateRouteRedirect — 열람자 허용 목록과 통합 관리, T-172)로 거른다 — 메뉴에 보이는데 누르면
 * 튕기는 항목이 생기지 않게, 판정을 두 벌로 두지 않게. `show` 는 열 수는 있어도 메뉴에 두지 않는 조건(플랜·감사 로그·규정 질문 설정)이다.
 */

import { privateRouteRedirect, routerPath } from './viewerAccess';
import { canUseApiIntegration } from './planFeatures';

export type CrumbDetail = 'law' | 'amendment';
export type NavGroup = 'main' | 'admin';

/** 메뉴 노출 조건에 쓰는 값 */
export type NavContext = {
  role: string | null | undefined;
  /** 플랫폼 역할 — 통합 관리를 열 수 있는지는 PrivateRoute 와 같은 판정이 이것으로 정한다 */
  platformRole: string | null | undefined;
  /** API 연동을 쓸 수 있는 플랜(Enterprise) */
  canUseApi: boolean;
  /** 서버에 규정 질문(AI)이 설정돼 있는가 */
  askConfigured: boolean;
  /** 회사가 규정 질문을 켰는가 */
  askEnabled: boolean;
};

export interface RouteSection {
  /** 경로 첫 마디(예: 'laws'). 대시보드('/')는 경로 표시가 없다 */
  segment: string;
  /** 경로 표시 이름 키 — 메뉴와 같은 키 */
  labelKey: string;
  /** 이 마디로 시작하는 모든 화면에서 경로 표시를 그리지 않는다(화면이 자체 머리를 그린다) */
  hidden?: boolean;
  /** 둘째 마디부터는 그리지 않는다 — 규정 상세·가져오기·재파싱 검토는 화면이 자체 경로를 그린다 */
  hiddenBelow?: boolean;
  /** 둘째 마디가 상세 id 이면 그 이름을 어디서 읽는가 */
  detail?: CrumbDetail;
  /** 상단 메뉴 항목(T-214) — 순서는 표의 순서, `show` 가 없으면 들어갈 수 있는 역할에게 늘 보인다 */
  nav?: { id: string; group: NavGroup; show?: (c: NavContext) => boolean };
}

export const ROUTE_SECTIONS: readonly RouteSection[] = [
  // 대시보드('/')는 경로 표시가 없고 메뉴에만 있다(첫 마디가 비어 경로 표시 판정에 걸리지 않는다)
  { segment: '', labelKey: 'layout.nav.dashboard', hidden: true, nav: { id: 'nav-dashboard', group: 'main' } },
  { segment: 'policies', labelKey: 'layout.nav.policies', hiddenBelow: true, nav: { id: 'nav-policies', group: 'main' } },
  { segment: 'laws', labelKey: 'layout.nav.laws', detail: 'law', nav: { id: 'nav-laws', group: 'main' } },
  { segment: 'amendments', labelKey: 'layout.nav.amendments', detail: 'amendment', nav: { id: 'nav-amendments', group: 'main' } },
  { segment: 'search', labelKey: 'layout.nav.search', nav: { id: 'nav-search', group: 'main' } },
  {
    segment: 'ask',
    labelKey: 'layout.nav.ask',
    // 서버에 AI 가 설정돼 있고 회사가 켜 둔 때만 — 꺼 두었으면 다시 켤 수 있는 관리자에게만(T-130·SEARCH-5)
    nav: { id: 'nav-ask', group: 'main', show: (c) => c.askConfigured && (c.askEnabled || c.role === 'admin') },
  },
  { segment: 'variables', labelKey: 'layout.nav.variables', nav: { id: 'nav-variables', group: 'admin' } },
  { segment: 'settings', labelKey: 'layout.nav.settings', nav: { id: 'nav-settings', group: 'admin' } },
  { segment: 'integrations', labelKey: 'layout.nav.integrations', nav: { id: 'nav-integrations', group: 'admin', show: (c) => c.canUseApi } },
  // 감사 로그에는 다른 구성원의 활동이 담긴다 — 회사 관리자만(AUDIT-2)
  { segment: 'audit-logs', labelKey: 'layout.nav.auditLogs', nav: { id: 'nav-audit-logs', group: 'admin', show: (c) => c.role === 'admin' } },
  // 통합 관리 화면은 자체 머리를 그린다. /platform-admin 은 /admin 과 같은 화면의 옛 주소다. 플랫폼 관리자만 — PrivateRoute 와 같은 판정이 거른다
  { segment: 'admin', labelKey: 'layout.nav.admin', hidden: true, nav: { id: 'nav-platform-admin', group: 'admin' } },
  { segment: 'platform-admin', labelKey: 'layout.nav.admin', hidden: true },
  { segment: 'about', labelKey: 'layout.nav.about' },
];

export type NavItem = { path: string; labelKey: string; id: string; group: NavGroup };

/**
 * 로그인한 사용자와 규정 질문 상태 → 메뉴 노출 조건. API 연동은 Enterprise 플랜, 통합 관리는 플랫폼 관리자(`global_admin`),
 * 규정 질문은 서버 설정·회사 켜짐(받기 전이면 둘 다 꺼진 것으로 — 메뉴가 잠깐 늦게 나타날 뿐 잘못 보이지 않는다)
 */
export function navContextFor(
  user: { role?: string | null; platformRole?: string | null; plan?: string | null } | null | undefined,
  ask: { configured?: boolean; enabled?: boolean } | null | undefined,
): NavContext {
  return {
    role: user?.role,
    platformRole: user?.platformRole,
    canUseApi: canUseApiIntegration(user?.plan),
    askConfigured: !!ask?.configured,
    askEnabled: !!ask?.enabled,
  };
}

/** 이 사용자에게 보일 상단 메뉴 — 업무 메뉴(main)와 '관리' 묶음(admin). 묶음이 비면 부르는 쪽이 묶음 버튼을 숨긴다 */
export function navItemsFor(c: NavContext): { main: NavItem[]; admin: NavItem[] } {
  const items = ROUTE_SECTIONS.flatMap((s): NavItem[] => {
    if (!s.nav || (s.nav.show && !s.nav.show(c))) return [];
    const path = s.segment ? `/${s.segment}` : '/';
    // 들어갈 수 없는 화면은 메뉴에 두지 않는다 — PrivateRoute 가 부르는 판정 그대로(T-172)
    if (privateRouteRedirect({ role: c.role, platformRole: c.platformRole }, path) !== null) return [];
    return [{ path, labelKey: s.labelKey, id: s.nav.id, group: s.nav.group }];
  });
  return { main: items.filter((i) => i.group === 'main'), admin: items.filter((i) => i.group === 'admin') };
}

/**
 * 지금 화면이 속한 메뉴 항목의 경로 — 라우터와 같은 꼴(대소문자·퍼센트 인코딩, `routerPath`)로 첫 마디를 보고, 메뉴에 없는 같은 화면의
 * 옛 주소(`/platform-admin`)는 이름 키가 같은 메뉴 항목(`/admin`)으로. 메뉴에 없는 화면이면 null
 */
export function activeNavPath(pathname: string): string | null {
  const first = routerPath(pathname).split('/').filter(Boolean)[0] ?? '';
  const section = ROUTE_SECTIONS.find((s) => s.segment === first);
  if (!section) return null;
  const nav = section.nav ? section : ROUTE_SECTIONS.find((s) => s.nav && s.labelKey === section.labelKey);
  return nav ? (nav.segment ? `/${nav.segment}` : '/') : null;
}

/**
 * 메뉴 링크의 `aria-current` — 그 화면 자체면 'page', 그 아래 화면(상세 등)이면 'true'(구역 안), 아니면 없음.
 * 규정 상세에서 '규정 목록, 현재 페이지'로 읽히지 않게
 */
export function navCurrent(pathname: string, path: string): 'page' | 'true' | undefined {
  if (activeNavPath(pathname) !== path) return undefined;
  const exact = routerPath(pathname).replace(/\/+$/, '') || '/';
  return exact === path ? 'page' : 'true';
}

export type Crumb =
  | { kind: 'section'; labelKey: string; to: string }
  | { kind: 'detail'; detail: CrumbDetail; id: string };

function decodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    // 잘못 인코딩된 주소 — 화면(react-router)도 원문 그대로 쓴다
    return seg;
  }
}

/**
 * 경로 → '홈' 다음에 그릴 마디들. 그리지 않을 경로면 null 이다
 * (대시보드, 숨김 화면, 표에 없는 경로나 깊이 — 원문 마디를 그대로 보이지 않는다).
 */
export function breadcrumbFor(pathname: string): Crumb[] | null {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length === 0) return null;
  // 라우터는 마디의 퍼센트 인코딩을 풀고 대소문자를 가리지 않는다 — 같은 화면이면 같은 경로 표시(T-172 판정과 같다)
  const first = decodeSegment(segs[0]).toLowerCase();
  const section = ROUTE_SECTIONS.find((s) => s.segment === first);
  if (!section || section.hidden) return null;
  const head: Crumb = { kind: 'section', labelKey: section.labelKey, to: `/${section.segment}` };
  if (segs.length === 1) return [head];
  if (section.hiddenBelow || !section.detail || segs.length > 2) return null;
  return [head, { kind: 'detail', detail: section.detail, id: decodeSegment(segs[1]) }];
}

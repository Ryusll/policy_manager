/**
 * 화면 경로의 첫 마디별 경로 표시(브레드크럼) 규칙 — T-212, SRS NFR-9.
 *
 * - 경로 표시는 메뉴와 같은 이름 키(`layout.nav.*`)를 쓴다.
 * - 상세 화면(`/laws/:id`·`/amendments/:id`)은 id 원문 대신 대상 이름을 쓴다 — 이름은 그 화면이
 *   이미 받아 둔 조회 결과에서 읽고, 경로 표시 때문에 요청을 늘리지 않는다(`components/Breadcrumbs`).
 * - 표에 없는 경로·깊이는 그리지 않는다. 영문 경로 마디를 그대로 내보이지 않기 위해서다.
 *
 * `App.tsx` 의 모든 경로가 이 표로 설명돼야 한다 — `tests/routeSections.test.ts` 가 App.tsx 원문에서
 * 경로를 뽑아 대조한다. 메뉴 묶음·노출 조건 칸은 T-214 에서 이 표에 더한다.
 */

export type CrumbDetail = 'law' | 'amendment';

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
}

export const ROUTE_SECTIONS: readonly RouteSection[] = [
  { segment: 'policies', labelKey: 'layout.nav.policies', hiddenBelow: true },
  { segment: 'laws', labelKey: 'layout.nav.laws', detail: 'law' },
  { segment: 'amendments', labelKey: 'layout.nav.amendments', detail: 'amendment' },
  { segment: 'search', labelKey: 'layout.nav.search' },
  { segment: 'ask', labelKey: 'layout.nav.ask' },
  { segment: 'variables', labelKey: 'layout.nav.variables' },
  { segment: 'settings', labelKey: 'layout.nav.settings' },
  { segment: 'integrations', labelKey: 'layout.nav.integrations' },
  { segment: 'audit-logs', labelKey: 'layout.nav.auditLogs' },
  // 통합 관리 화면은 자체 머리를 그린다. /platform-admin 은 /admin 과 같은 화면의 옛 주소다
  { segment: 'admin', labelKey: 'layout.nav.admin', hidden: true },
  { segment: 'platform-admin', labelKey: 'layout.nav.admin', hidden: true },
  { segment: 'about', labelKey: 'layout.nav.about' },
];

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

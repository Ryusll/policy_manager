/**
 * 화면 경로 접근 판정 — 한 곳에 둔다(SRS AUTH-4, T-172).
 *
 * 주소로 들어갈 수 있는 것(`App.tsx` 의 `PrivateRoute`), 메뉴에 보이는 것(`lib/routeSections` 의 navItemsFor — PrivateRoute 와 같은
 * privateRouteRedirect 를 부른다, T-214), 화면 안 바로가기(규정 질문 답의
 * 법령 링크)가 이 파일의 함수를 함께 부른다. 두 벌로 두었다가 '규정 질문'이 메뉴에는 보이는데 누르면 통합검색으로
 * 되돌아갔다(T-172). 화면에서 가리는 것은 권한이 아니다 — 권한은 서버가 따로 막는다.
 *
 * 라우터(react-router 6)는 대소문자를 가리지 않고, 마디마다 퍼센트 인코딩을 풀어 경로를 맞추며, 끝의 `/` 는 몇 개든
 * 받는다. 판정도 같은 꼴로 바꾼 경로로 한다 — 아니면 `/policies/IMPORT` 처럼 판정은 '규정 상세'로 보고 라우터는
 * '규정 가져오기'를 그리는 주소가 생긴다.
 */

/** 허용 밖 주소로 온 열람자를 보내는 곳 */
export const VIEWER_HOME = '/search';

/**
 * 열람자가 들어갈 수 있는 화면 — 허용 목록이다. 규정은 상세(`/policies/:id`)만이고, 같은 자리에 오는 고정 경로
 * `import`(규정 가져오기)와 상세 아래 화면(재파싱 검토)은 쓰기 화면이라 넣지 않는다. 새 화면을 열람자에게 열려면 여기에 더한다.
 */
const VIEWER_PAGES: readonly RegExp[] = [
  /^\/search\/*$/,
  /^\/ask\/*$/,
  /^\/about\/*$/,
  /^\/policies\/(?!import\/*$)[^/]+\/*$/,
];

/** 통합 관리 화면 — 플랫폼 관리자(`global_admin`)만 */
const PLATFORM_ADMIN_PAGE = /^\/(admin|platform-admin)(\/|$)/;

/** 라우터가 경로를 맞추는 꼴 — 마디마다 퍼센트 인코딩을 풀고(`/` 는 다시 감싼다) 소문자로 */
export function routerPath(pathname: string): string {
  let decoded: string;
  try {
    decoded = pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment).replace(/\//g, '%2F'))
      .join('/');
  } catch {
    // 잘못된 인코딩이면 라우터도 경로를 그대로 쓴다(@remix-run/router 의 decodePath) — 같은 꼴로 판정한다
    decoded = pathname;
  }
  return decoded.toLowerCase();
}

function isViewerPage(path: string): boolean {
  return VIEWER_PAGES.some((page) => page.test(path));
}

/** 열람자가 이 경로를 열 수 있는가 */
export function viewerCanOpen(pathname: string): boolean {
  return isViewerPage(routerPath(pathname));
}

/** 이 역할이 이 경로를 열 수 있는가 — 메뉴와 화면 안 바로가기가 쓴다. 열람자 밖의 회사 역할은 막지 않는다 */
export function roleCanOpen(role: string | null | undefined, pathname: string): boolean {
  return role !== 'viewer' || viewerCanOpen(pathname);
}

/**
 * 로그인한 사용자가 이 경로를 열 수 없으면 보낼 곳, 열 수 있으면 null — `PrivateRoute` 가 로그인·비밀번호 변경 확인 뒤에 부른다.
 * 열람자는 허용 목록 밖이면 통합검색으로, 통합 관리 화면은 플랫폼 관리자가 아니면 대시보드로.
 */
export function privateRouteRedirect(
  user: { role?: string | null; platformRole?: string | null } | null | undefined,
  pathname: string,
): string | null {
  const path = routerPath(pathname);
  if (user?.role === 'viewer' && !isViewerPage(path)) return VIEWER_HOME;
  if (PLATFORM_ADMIN_PAGE.test(path) && user?.platformRole !== 'global_admin') return '/';
  return null;
}

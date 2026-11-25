/**
 * "자동 로그인"을 고르지 않은 로그인은 브라우저를 닫으면 끝나야 한다 (T-137).
 *
 * 로그인 정보는 탭끼리 나눠 쓰려고 localStorage 에 둔다. 그런데 localStorage 는 브라우저를 닫아도
 * 남는다. 그래서 만료일 없는 쿠키 — 브라우저를 닫으면 지워진다 — 를 "이 브라우저가 아직 켜져
 * 있다"는 표시로 쓴다. 화면을 열 때 표시가 없으면 브라우저를 다시 켠 것이고, 자동 로그인이 아닌
 * 로그인 정보는 지운다. 쿠키에는 아무 정보도 담지 않는다(서버도 읽지 않는다).
 */
const COOKIE = 'pm_browser_session';

export function markBrowserSession(): void {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE}=1; path=/; SameSite=Lax${secure}`;
  } catch {
    // 쿠키를 못 쓰는 환경이면 다음에 열 때 다시 로그인하게 될 뿐이다
  }
}

export function hasBrowserSession(): boolean {
  try {
    return document.cookie.split(';').some((c) => c.trim().startsWith(`${COOKIE}=`));
  } catch {
    return false;
  }
}

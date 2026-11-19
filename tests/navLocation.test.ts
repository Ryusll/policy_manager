import { describe, expect, it } from 'vitest';
import { activeNavPath, navCurrent } from '../apps/web/src/lib/routeSections';

/**
 * T-214 지금 화면이 속한 상단 메뉴 항목 — 묶음 버튼의 현재 위치와 메뉴 링크의 aria-current 가 쓴다.
 * 라우터와 같은 꼴(대소문자·퍼센트 인코딩·끝의 /)로 보고, 같은 화면의 옛 주소(/platform-admin)는 메뉴 항목으로 잇는다.
 */

describe('지금 화면이 속한 메뉴 항목 — 라우터와 같은 꼴 (T-214)', () => {
  it.each([
    ['/', '/'],
    ['/policies', '/policies'],
    ['/policies/abc', '/policies'],
    ['/Settings', '/settings'],
    ['/%73ettings', '/settings'],
    ['/platform-admin', '/admin'],
    ['/platform-admin/tenants', '/admin'],
    ['/about', null],
    ['/administrator', null],
    ['/lawsuit', null],
  ])('%s → %s', (pathname, expected) => {
    expect(activeNavPath(pathname)).toBe(expected);
  });
});

describe("메뉴 링크의 aria-current — 그 화면이면 'page', 그 아래 화면이면 'true' (T-214)", () => {
  it.each([
    ['/policies', '/policies', 'page'],
    ['/policies/', '/policies', 'page'],
    ['/Policies', '/policies', 'page'],
    ['/policies/abc', '/policies', 'true'],
    ['/laws/x1', '/laws', 'true'],
    ['/', '/', 'page'],
    ['/policies', '/laws', undefined],
    ['/platform-admin', '/admin', 'true'],
  ])('%s · %s → %s', (pathname, path, expected) => {
    expect(navCurrent(pathname, path)).toBe(expected);
  });
});

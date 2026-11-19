/**
 * 화면 경로 접근 판정 (T-172, SRS AUTH-4·SEARCH-4).
 *
 * '규정 질문'이 메뉴에는 보이는데 누르면 통합검색으로 되돌아갔다 — 메뉴 규칙과 경로 규칙이 두 벌이었다.
 * 이제 `PrivateRoute`·상단 메뉴·규정 질문 답의 법령 링크가 `lib/viewerAccess` 의 함수를 함께 부른다.
 * 라우터는 대소문자를 가리지 않고 퍼센트 인코딩을 풀어 경로를 맞추므로, 판정도 같은 꼴로 한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AskTurnView } from '../apps/web/src/components/AskTurn';
import {
  VIEWER_HOME,
  privateRouteRedirect,
  roleCanOpen,
  routerPath,
  viewerCanOpen,
} from '../apps/web/src/lib/viewerAccess';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('열람자가 들어갈 수 있는 화면 (T-172)', () => {
  it('규정 질문 화면에 들어간다', () => {
    expect(viewerCanOpen('/ask')).toBe(true);
    expect(viewerCanOpen('/ask/')).toBe(true);
  });

  it('통합검색·규정 상세·소개는 그대로 열린다', () => {
    for (const path of ['/search', '/search/', '/policies/3f1c', '/policies/3f1c/', '/about']) {
      expect(viewerCanOpen(path), path).toBe(true);
    }
  });

  it('규정 가져오기와 상세 아래 화면(재파싱 검토 등)은 막는다', () => {
    for (const path of ['/policies/import', '/policies/import/', '/policies/3f1c/reparse/9', '/policies/3f1c/reparse', '/policies/3f1c/anything']) {
      expect(viewerCanOpen(path), path).toBe(false);
    }
  });

  it('그 밖의 화면은 막는다 — 대시보드, 규정 목록, 법령, 개정 검토, 변수, 설정, 연동, 감사 로그, 관리', () => {
    for (const path of ['/', '/policies', '/laws', '/laws/1', '/amendments', '/amendments/1', '/variables', '/settings', '/integrations', '/audit-logs', '/admin', '/platform-admin']) {
      expect(viewerCanOpen(path), path).toBe(false);
    }
  });

  it('끝 슬래시를 붙여도 규정 목록은 열리지 않는다 — 라우터는 /policies/ 를 목록으로 연다', () => {
    expect(viewerCanOpen('/policies/')).toBe(false);
    expect(viewerCanOpen('/policies//')).toBe(false);
  });

  it('앞부분만 같은 주소와 허용 화면 아래 주소는 받지 않는다', () => {
    for (const path of ['/asking', '/ask-admin', '/ask/x', '/searching', '/search/x', '/aboutus', '/policiesx/1']) {
      expect(viewerCanOpen(path), path).toBe(false);
    }
  });

  it('라우터처럼 대소문자를 가리지 않는다 — 대문자로 쓴 쓰기 화면도 막고, 대문자로 쓴 허용 화면은 연다', () => {
    for (const path of ['/policies/IMPORT', '/Policies/Import', '/POLICIES/3f1c/REPARSE/9']) {
      expect(viewerCanOpen(path), path).toBe(false);
    }
    for (const path of ['/ASK', '/Search', '/About/']) {
      expect(viewerCanOpen(path), path).toBe(true);
    }
  });

  it('라우터처럼 퍼센트 인코딩을 풀어 판정한다 — 인코딩으로 쓰기 화면을 숨겨도 막는다', () => {
    expect(routerPath('/policies/%69mport')).toBe('/policies/import');
    expect(viewerCanOpen('/policies/%69mport')).toBe(false);
    expect(viewerCanOpen('/%61sk')).toBe(true);
    // 마디 안의 인코딩된 `/` 는 경로를 나누지 않는다(라우터와 같다)
    expect(routerPath('/policies/a%2Fb')).toBe('/policies/a%2fb');
    // 잘못된 인코딩은 라우터처럼 그대로 둔다
    expect(routerPath('/policies/%E0%A4%A')).toBe('/policies/%e0%a4%a');
  });

  it('허용 밖 주소로 온 열람자를 보내는 곳은 열람자가 들어갈 수 있는 화면이다', () => {
    expect(viewerCanOpen(VIEWER_HOME)).toBe(true);
  });
});

describe('PrivateRoute 의 이동 판정 (T-172)', () => {
  const viewer = { role: 'viewer' };
  it('열람자는 허용 밖이면 통합검색으로, 허용 화면이면 그대로', () => {
    expect(privateRouteRedirect(viewer, '/settings')).toBe(VIEWER_HOME);
    expect(privateRouteRedirect(viewer, '/policies/IMPORT')).toBe(VIEWER_HOME);
    expect(privateRouteRedirect(viewer, '/ask')).toBeNull();
    expect(privateRouteRedirect(viewer, '/policies/3f1c')).toBeNull();
  });

  it('관리자·편집자는 회사 화면을 막지 않는다', () => {
    for (const role of ['admin', 'editor']) {
      for (const path of ['/', '/policies', '/policies/import', '/laws', '/settings', '/ask']) {
        expect(privateRouteRedirect({ role }, path), `${role} ${path}`).toBeNull();
      }
    }
  });

  it('통합 관리 화면은 플랫폼 관리자만 — 대소문자를 바꿔도 막는다', () => {
    for (const path of ['/admin', '/platform-admin', '/Admin', '/PLATFORM-ADMIN/x']) {
      expect(privateRouteRedirect({ role: 'admin' }, path), path).toBe('/');
      expect(privateRouteRedirect({ role: 'admin', platformRole: 'global_admin' }, path), path).toBeNull();
    }
    expect(privateRouteRedirect({ role: 'admin' }, '/administrator')).toBeNull();
  });
});

describe('역할별로 열 수 있는 경로 — 메뉴와 화면 안 바로가기 (T-172)', () => {
  it('열람자만 허용 목록을 따르고, 다른 회사 역할은 막지 않는다', () => {
    expect(roleCanOpen('viewer', '/laws')).toBe(false);
    expect(roleCanOpen('viewer', '/ask')).toBe(true);
    for (const role of ['admin', 'editor']) {
      expect(roleCanOpen(role, '/laws'), role).toBe(true);
      expect(roleCanOpen(role, '/settings'), role).toBe(true);
    }
  });
});

describe('라우트 표와 허용 목록이 맞는다 (T-172)', () => {
  it('App.tsx 의 화면 가운데 열람자에게 열리는 것은 통합검색·규정 질문·규정 상세·소개뿐이다', () => {
    const app = src('apps/web/src/App.tsx');
    const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]).filter((p) => !p.startsWith('/'));
    expect(routes.length).toBeGreaterThanOrEqual(15);
    // :id 같은 자리 표시는 실제 id 꼴로 바꿔 판정한다
    const open = routes.filter((p) => viewerCanOpen(`/${p.replace(/:[a-zA-Z]+/g, 'x1')}`));
    expect(open.sort()).toEqual(['about', 'ask', 'policies/:id', 'search']);
  });

  it('상단 메뉴 가운데 열람자에게 남는 것은 통합검색과 규정 질문뿐이다', () => {
    // 메뉴 정의(navDefs)의 경로를 소스에서 그대로 읽는다 — 베껴 둔 목록은 메뉴가 바뀌면 어긋난다
    const layout = src('apps/web/src/components/Layout.tsx');
    const start = layout.indexOf('const navDefs = [');
    const end = layout.indexOf('] as const;', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const paths = [...layout.slice(start, end).matchAll(/path: '([^']+)'/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThanOrEqual(10);
    expect(paths.filter((p) => roleCanOpen('viewer', p))).toEqual(['/search', '/ask']);
    expect(paths.filter((p) => roleCanOpen('editor', p))).toEqual(paths);
  });
});

describe('경로·메뉴·바로가기가 같은 판정을 부른다 (T-172)', () => {
  it('PrivateRoute 는 경로를 직접 나열하지 않고 privateRouteRedirect 의 결과로만 보낸다', () => {
    const app = src('apps/web/src/App.tsx');
    expect(app).toContain('const redirect = privateRouteRedirect(user, location.pathname);');
    expect(app).toContain('if (redirect) return <Navigate to={redirect} replace />;');
    expect(app).not.toMatch(/pathname\.startsWith\(/);
    expect(app).not.toMatch(/role === 'viewer'/);
  });

  it('상단 메뉴의 역할 필터는 roleCanOpen 을 부른다', () => {
    const layout = src('apps/web/src/components/Layout.tsx');
    expect(layout).toContain('.filter((item) => roleCanOpen(user?.role, item.path))');
    expect(layout).not.toMatch(/item\.path === '\/search'/);
  });

  it('규정 질문 답을 그리면 열람자에게는 법령 링크가 없고 편집자에게는 있다', () => {
    const result = {
      answerable: true,
      blocks: [{ type: 'paragraph', text: '연차휴가는 15일입니다.' }],
      citations: [],
      lawCitations: [
        { ref: 'L1', lawId: 'law-1', lawName: '근로기준법', lawArticleId: 'la-1', label: '제60조', title: '연차 유급휴가', content: '1년간 80퍼센트 이상 출근한 근로자에게 15일의 유급휴가를 주어야 한다.', scheduledOn: null },
      ],
      consulted: [],
      usage: { used: 1, limit: 15, userUsed: 1, userLimit: 12 },
    };
    const render = (role: string) =>
      renderToStaticMarkup(
        createElement(MemoryRouter, null, createElement(AskTurnView, { question: '연차휴가', result: result as never, canOpenLaws: roleCanOpen(role, '/laws/:id') })),
      );
    expect(render('viewer')).not.toContain('href="/laws/');
    expect(render('editor')).toContain('href="/laws/law-1');
  });

  it('규정 질문 답의 법령 링크도 같은 판정을 쓴다 — 링크가 가는 법령 상세로 판정한다', () => {
    const page = src('apps/web/src/pages/AskPage.tsx');
    expect(page).toContain("const canOpenLaws = roleCanOpen(user?.role, '/laws/:id');");
    expect(page).toContain('canOpenLaws={canOpenLaws}');
    expect(page).not.toMatch(/role === 'editor'/);
    expect(roleCanOpen('viewer', '/laws/:id')).toBe(false);
    expect(roleCanOpen('editor', '/laws/:id')).toBe(true);
  });
});

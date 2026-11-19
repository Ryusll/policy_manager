import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { ROUTE_SECTIONS, navContextFor, navItemsFor, type NavContext } from '../apps/web/src/lib/routeSections';
import { privateRouteRedirect, roleCanOpen } from '../apps/web/src/lib/viewerAccess';
import { amendmentTargetLabel } from '../apps/web/src/lib/amendmentTarget';
import { DesktopNavView, MobileNavView } from '../apps/web/src/components/TopNav';
import { messages } from '../apps/web/src/i18n/messages';

/**
 * T-214 상단 메뉴 재편(SRS NFR-10) — 업무 메뉴와 '관리' 묶음, 현재 위치, '공통 기준값' 이름, 개정 후보 경로 표시 표기.
 * 메뉴 버튼(DropdownMenu)의 키보드·닫힘 규칙은 tests/dropdownMenu.test.ts.
 */
const ROOT = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const MAIN = ['/', '/policies', '/laws', '/amendments', '/search', '/ask'];
const ADMIN = ['/variables', '/settings', '/integrations', '/audit-logs', '/admin'];

/**
 * T-214 전 Layout 의 메뉴 정의와 거르기를 그대로 옮겨 적은 기준 — 노출 조건이 바뀌지 않았는지 대조한다
 * (AUTH-4·5, AUDIT-2, SEARCH-5). 순서도 그때와 같다.
 */
function oldVisible(c: NavContext): string[] {
  const isAdmin = c.role === 'admin';
  return [...MAIN, ...ADMIN]
    .filter((p) => (p === '/integrations' ? c.canUseApi : true))
    .filter((p) => (p === '/admin' ? c.platformRole === 'global_admin' : true))
    .filter((p) => (p === '/audit-logs' ? isAdmin : true))
    .filter((p) => (p === '/ask' ? c.askConfigured && (c.askEnabled || isAdmin) : true))
    .filter((p) => roleCanOpen(c.role, p));
}

const ROLES = ['admin', 'editor', 'viewer'] as const;
const ASK_STATES = [
  { name: '서버 미설정', askConfigured: false, askEnabled: false },
  { name: '서버 미설정(회사 켬)', askConfigured: false, askEnabled: true },
  { name: '회사가 끔', askConfigured: true, askEnabled: false },
  { name: '켬', askConfigured: true, askEnabled: true },
];
// 플랫폼 역할 — 없음·통합 관리자·그 밖의 값(통합 관리를 열 수 없다)
const PLATFORM_ROLES = [null, 'global_admin', 'tenant'];
const MATRIX: NavContext[] = ROLES.flatMap((role) =>
  PLATFORM_ROLES.flatMap((platformRole) =>
    [false, true].flatMap((canUseApi) => ASK_STATES.map(({ askConfigured, askEnabled }) => ({ role, platformRole, canUseApi, askConfigured, askEnabled }))),
  ),
);

describe('역할·플랜·규정 질문 설정별 메뉴 — 노출 조건은 그대로, 묶음만 나뉜다 (T-214)', () => {
  it.each(MATRIX.map((c) => [JSON.stringify(c), c] as const))('%s', (_name, c) => {
    const { main, admin } = navItemsFor(c);
    // 업무 메뉴 다음에 '관리' 묶음 — 둘을 이으면 T-214 전 메뉴와 같다
    expect([...main, ...admin].map((i) => i.path)).toEqual(oldVisible(c));
    expect(main.every((i) => MAIN.includes(i.path) && i.group === 'main')).toBe(true);
    expect(admin.every((i) => ADMIN.includes(i.path) && i.group === 'admin')).toBe(true);
    // 메뉴 = PrivateRoute 가 여는 화면 ∩ show — 판정 하나(privateRouteRedirect)를 양쪽에서 대조한다(보이면 열리고, 열리고 show 면 보인다)
    const user = { role: c.role, platformRole: c.platformRole };
    const shown = new Set([...main, ...admin].map((i) => i.path));
    for (const s of ROUTE_SECTIONS.filter((x) => x.nav)) {
      const path = s.segment ? `/${s.segment}` : '/';
      const opens = privateRouteRedirect(user, path) === null;
      expect(shown.has(path), path).toBe(opens && (s.nav!.show ? s.nav!.show(c) : true));
    }
  });

  it('행렬은 역할 3 × 플랫폼 역할 3 × Enterprise 여부 × 규정 질문 4상태다', () => {
    expect(MATRIX).toHaveLength(72);
  });

  it('모든 조건을 갖춘 관리자 — 업무 메뉴 여섯, 관리 묶음 다섯', () => {
    const { main, admin } = navItemsFor({ role: 'admin', platformRole: 'global_admin', canUseApi: true, askConfigured: true, askEnabled: true });
    expect(main.map((i) => i.path)).toEqual(MAIN);
    expect(admin.map((i) => i.path)).toEqual(ADMIN);
  });

  it('회사가 규정 질문을 끄면 다시 켤 수 있는 관리자에게만 메뉴가 남는다, 서버에 설정이 없으면 아무에게도 없다', () => {
    const off = { platformRole: null, canUseApi: false, askConfigured: true, askEnabled: false };
    expect(navItemsFor({ role: 'admin', ...off }).main.map((i) => i.path)).toContain('/ask');
    expect(navItemsFor({ role: 'editor', ...off }).main.map((i) => i.path)).not.toContain('/ask');
    for (const role of ROLES) {
      expect(navItemsFor({ role, ...off, askConfigured: false, askEnabled: true }).main.map((i) => i.path), role).not.toContain('/ask');
    }
  });

  it('편집자(Starter)의 관리 묶음은 공통 기준값·설정뿐, 열람자는 묶음이 비어 숨는다', () => {
    const base = { platformRole: null, canUseApi: false, askConfigured: true, askEnabled: true };
    expect(navItemsFor({ role: 'editor', ...base }).admin.map((i) => i.path)).toEqual(['/variables', '/settings']);
    expect(navItemsFor({ role: 'viewer', ...base, platformRole: 'global_admin', canUseApi: true }).admin).toEqual([]);
  });

  it('통합 관리는 경로 표에 따로 조건을 두지 않고 PrivateRoute 와 같은 판정이 거른다 — 판정을 두 벌로 두지 않는다', () => {
    const table = src('apps/web/src/lib/routeSections.ts');
    expect(table).toContain('if (privateRouteRedirect({ role: c.role, platformRole: c.platformRole }, path) !== null) return [];');
    expect(ROUTE_SECTIONS.find((s) => s.segment === 'admin')!.nav!.show).toBeUndefined();
    for (const file of ['apps/web/src/lib/routeSections.ts', 'apps/web/src/components/TopNav.tsx']) {
      expect(src(file), file).not.toMatch(/=== 'global_admin'/);
    }
  });

  it('메뉴 항목의 id 는 겹치지 않고 모두 아이콘이 있다', () => {
    const ids = ROUTE_SECTIONS.flatMap((s) => (s.nav ? [s.nav.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
    const topNav = src('apps/web/src/components/TopNav.tsx');
    for (const id of ids) expect(topNav, id).toContain(`'${id}':`);
  });
});

type AskStatusSeed = { configured: boolean; enabled: boolean } | null;

/**
 * 메뉴를 사용자·규정 질문 상태로 그려 본다. 서버 그리기(renderToStaticMarkup)는 zustand 저장소의 처음 상태만 읽으므로
 * 저장소를 읽는 DesktopNav·MobileNav 대신, 같은 navContextFor 로 만든 조건을 받는 *View 를 그린다
 */
function renderNav(view: 'desktop' | 'mobile', user: Record<string, unknown> | null, ask: AskStatusSeed, path = '/') {
  const ctx = navContextFor(user, ask);
  const el = view === 'desktop' ? createElement(DesktopNavView, { ctx }) : createElement(MobileNavView, { ctx, onNavigate: () => undefined });
  // 개정 검토 배지가 쿼리를 쓴다
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, { initialEntries: [path] }, el)));
}

const userOf = (role: string, extra: Record<string, unknown> = {}) => ({ id: 'u1', email: 'u@x', name: '사용자', role, tenantId: 't1', plan: 'starter', ...extra });

describe('사용자 → 메뉴 노출 조건 (T-214)', () => {
  it('API 연동은 Enterprise, 통합 관리는 global_admin, 규정 질문은 받은 상태 그대로', () => {
    expect(navContextFor(userOf('editor', { plan: 'enterprise', platformRole: 'global_admin' }), { configured: true, enabled: false })).toEqual({
      role: 'editor',
      platformRole: 'global_admin',
      canUseApi: true,
      askConfigured: true,
      askEnabled: false,
    });
    expect(navContextFor(userOf('admin', { plan: 'pro', platformRole: 'tenant' }), null)).toMatchObject({ platformRole: 'tenant', canUseApi: false });
  });

  it('규정 질문 상태를 받기 전·로그인 전이면 메뉴를 넓히는 쪽으로 기울지 않는다', () => {
    expect(navContextFor(null, undefined)).toEqual({ role: undefined, platformRole: undefined, canUseApi: false, askConfigured: false, askEnabled: false });
  });

  it('DesktopNav·MobileNav 는 저장소의 사용자와 규정 질문 상태로 같은 함수를 부른다', () => {
    const nav = src('apps/web/src/components/TopNav.tsx');
    expect(nav).toContain('const user = useAuthStore((s) => s.user);');
    expect(nav).toContain('return navContextFor(user, ask);');
    expect(nav).toContain('return <DesktopNavView ctx={useNavContext()} />;');
    expect(nav).toContain('return <MobileNavView ctx={useNavContext()} onNavigate={onNavigate} />;');
  });
});

describe('상단 메뉴 그리기 — 묶음 버튼과 모바일 구역 (T-214)', () => {
  it('데스크톱: 관리자에게는 업무 메뉴와 닫힌 관리 묶음 버튼(aria-haspopup·aria-expanded)', () => {
    const html = renderNav('desktop', userOf('admin'), { configured: true, enabled: true });
    expect(html).toContain('id="nav-policies"');
    expect(html).toMatch(/<button[^>]*id="nav-admin-group"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
    expect(html).toContain('>관리<');
    // 닫힌 묶음의 항목은 그리지 않는다
    expect(html).not.toContain('id="nav-variables"');
    expect(html).toContain('aria-label="주 메뉴"');
  });

  it('데스크톱: 묶음 안 화면에 있으면 묶음 버튼이 현재 위치로 보인다 — 라우터와 같은 꼴(대소문자·옛 주소)로, 화면 읽기 프로그램에도', () => {
    const inGroup = renderNav('desktop', userOf('admin'), null, '/settings');
    expect(inGroup).toMatch(/id="nav-admin-group"[^>]*data-active="true"/);
    expect(inGroup).toContain('<span class="sr-only">(지금 화면이 이 묶음 안에 있음)</span>');
    expect(renderNav('desktop', userOf('admin'), null, '/Settings')).toMatch(/id="nav-admin-group"[^>]*data-active="true"/);
    expect(renderNav('desktop', userOf('admin', { platformRole: 'global_admin' }), null, '/platform-admin')).toMatch(/id="nav-admin-group"[^>]*data-active="true"/);
    const outside = renderNav('desktop', userOf('admin'), null, '/policies/abc');
    expect(outside).not.toMatch(/id="nav-admin-group"[^>]*data-active/);
    // 하위 화면(규정 상세)에서는 '현재 페이지'가 아니라 그 구역 안 — aria-current="true"
    const policiesLink = (html: string) => html.match(/<a[^>]*id="nav-policies"[^>]*>/)?.[0] ?? '';
    expect(policiesLink(outside)).toContain('aria-current="true"');
    expect(policiesLink(renderNav('desktop', userOf('admin'), null, '/policies'))).toContain('aria-current="page"');
    expect(policiesLink(renderNav('desktop', userOf('admin'), null, '/laws'))).not.toContain('aria-current');
  });

  it('데스크톱: 열람자에게는 묶음 버튼이 없고 통합검색·규정 질문만', () => {
    const html = renderNav('desktop', userOf('viewer'), { configured: true, enabled: true });
    expect(html).not.toContain('nav-admin-group');
    expect([...html.matchAll(/id="(nav-[\w-]+)"/g)].map((m) => m[1])).toEqual(['nav-search', 'nav-ask']);
  });

  it('모바일: 관리 묶음은 구역 제목 아래에 펼친다, 열람자에게는 구역 제목도 없다', () => {
    const admin = renderNav('mobile', userOf('admin', { plan: 'enterprise', platformRole: 'global_admin' }), { configured: true, enabled: true });
    const at = admin.indexOf('>관리<');
    expect(at).toBeGreaterThan(admin.indexOf('id="nav-ask-mobile"'));
    for (const id of ['nav-variables', 'nav-settings', 'nav-integrations', 'nav-audit-logs', 'nav-platform-admin']) {
      expect(admin.indexOf(`id="${id}-mobile"`), id).toBeGreaterThan(at);
    }
    expect(renderNav('mobile', userOf('viewer'), { configured: true, enabled: true })).not.toContain('>관리<');
    // 보조기기에도 묶음으로 — 구역 제목이 묶음 이름
    expect(admin).toContain('role="group" aria-labelledby="nav-admin-group-mobile-title"');
    expect(admin).toContain('id="nav-admin-group-mobile-title"');
  });

  it('Layout 은 옛 메뉴 정의 없이 데스크톱·모바일 메뉴를 부른다', () => {
    const layout = src('apps/web/src/components/Layout.tsx');
    expect(layout).toContain('<DesktopNav />');
    expect(layout).toContain('<MobileNav onNavigate={() => setSidebarOpen(false)} />');
    expect(layout).not.toContain('navDefs');
  });

  it('온보딩 투어 4단계는 관리 묶음 버튼을 가리킨다', () => {
    const tour = src('apps/web/src/components/OnboardingTour.tsx');
    expect(tour).toContain("targetId: 'nav-admin-group', titleKey: 'tour.step4.title'");
    expect(tour).not.toContain("'nav-variables'");
    expect(renderNav('desktop', userOf('admin'), null)).toContain('id="nav-admin-group"');
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("'변수 관리' → '공통 기준값' (T-214)", () => {
  const ko = messages.ko as Record<string, string>;
  const en = messages.en as Record<string, string>;

  it('메뉴·화면 제목·요금제 기능 목록이 공통 기준값이다(ko·en)', () => {
    for (const key of ['layout.nav.variables', 'variables.title', 'plan.f6']) {
      expect(ko[key], key).toBe('공통 기준값');
      expect(en[key], key).toBe('Shared values');
    }
    expect(ko['layout.nav.adminGroup']).toBe('관리');
    expect(en['layout.nav.adminGroup']).toBe('Manage');
  });

  it('화면 설명은 여러 규정에 함께 쓰는 값(변수)이라고 적고 본문 표식·변수 연결과 잇는다', () => {
    expect(ko['variables.subtitle']).toContain('회사명·대표이사명처럼 여러 규정에 함께 쓰는 값(변수)');
    expect(ko['variables.subtitle']).toContain('{{KEY}}');
    expect(ko['variables.subtitle']).toContain('변수 연결');
    expect(en['variables.subtitle']).toContain('{{KEY}}');
  });

  it('투어 4단계는 관리 묶음과 공통 기준값을 안내한다 — 정의는 화면 설명과 같은 말(여러 규정에 함께 쓰는 값)', () => {
    expect(ko['tour.step4.title']).toBe('관리');
    expect(ko['tour.step4.desc']).toContain('공통 기준값');
    expect(ko['tour.step4.desc']).toContain('여러 규정에 함께 쓰는 값');
    expect(en['tour.step4.desc']).toContain('Shared values');
    expect(en['tour.step4.desc']).toContain('across many policies');
    expect(en['variables.subtitle']).toContain('across many policies');
  });

  it('서버 안내 문구도 공통 기준값으로 보낸다', () => {
    expect(src('apps/api/src/variables/variables.service.ts')).toContain("'관리 > 공통 기준값에서 값과 유효기간을 확인하세요.'");
  });

  it("화면·서버 소스에 '변수 관리'가 남지 않는다", () => {
    const hits = ['apps/web/src', 'apps/api/src']
      .flatMap((d) => walk(join(ROOT, d)))
      .filter((f) => readFileSync(f, 'utf8').includes('변수 관리'));
    expect(hits).toEqual([]);
  });
});

describe('개정 후보 경로 표시는 상세 머리와 같은 조문 표기 (T-214)', () => {
  const article = { number: 3, branchNumber: null, clauseNumber: null, itemNumber: null };

  it('조는 제N조(제목), 항은 제N조제M항(부제), 제목이 없으면 번호만', () => {
    expect(amendmentTargetLabel('취업규칙', { ...article, title: '목적' })).toBe('취업규칙 제3조(목적)');
    expect(amendmentTargetLabel('취업규칙', { ...article, clauseNumber: 2, title: '특례' })).toBe('취업규칙 제3조제2항(특례)');
    expect(amendmentTargetLabel('취업규칙', { ...article, branchNumber: 2, title: '' })).toBe('취업규칙 제3조의2');
  });

  it('경로 표시와 후보 상세 머리가 같은 함수를 부른다', () => {
    for (const file of ['apps/web/src/components/Breadcrumbs.tsx', 'apps/web/src/pages/AmendmentDetailPage.tsx']) {
      expect(src(file), file).toContain('amendmentTargetLabel(data.policy.title, data.article)');
    }
  });
});

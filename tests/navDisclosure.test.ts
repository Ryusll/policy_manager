import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { FileText } from 'lucide-react';
import { DISCLOSURE_PICKED, disclosureFocusMove, disclosureKey, disclosureLinkClick, disclosurePointerDown } from '../apps/web/src/lib/disclosureKeys';
import { NavDisclosureView, type NavDisclosureItem } from '../apps/web/src/components/NavDisclosure';
import { adminLinks } from '../apps/web/src/lib/navAdminLinks';
import { navContextFor, navCurrent, navItemsFor } from '../apps/web/src/lib/routeSections';

/**
 * T-226 상단 메뉴 '관리' 묶음을 disclosure 패턴으로(PM 결정 11/20, C-114 ⑥, SRS NFR-10) — 메뉴 버튼(role=menu)이면 묶음 안 링크가
 * menuitem 이라 화면 읽기 프로그램의 링크 목록에 나오지 않았다. 닫힘 규칙(lib/disclosureKeys)·그리기(NavDisclosureView)·연결(소스).
 * 이 저장소의 단위 시험은 DOM 이 없어(environment node) 키·포커스는 규칙 함수와 소스 연결로, 실제 동작은 Chrome 으로 본다.
 */
const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const inside = (n: string) => n.startsWith('in:');

describe('닫힘 규칙 (T-226)', () => {
  it('Esc 는 열려 있을 때만 닫고 포커스를 버튼으로 — 닫혀 있으면 처리하지 않는다(다른 곳의 Esc 를 막지 않게)', () => {
    expect(disclosureKey(true, 'Escape')).toEqual({ close: true, focusButton: true });
    expect(disclosureKey(false, 'Escape')).toEqual({ close: false, focusButton: false });
    for (const key of ['Enter', ' ', 'Tab', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Esc']) {
      expect(disclosureKey(true, key), key).toEqual({ close: false, focusButton: false });
    }
  });

  it('포커스가 묶음 밖으로 옮겨 가면 닫고 포커스는 옮긴 곳에 — 묶음 안으로 옮기거나 옮겨 간 곳이 없으면(누른 링크에 포커스를 주지 않는 브라우저) 닫지 않는다', () => {
    expect(disclosureFocusMove(true, 'out:profile', inside)).toEqual({ close: true, focusButton: false });
    expect(disclosureFocusMove(true, 'in:link-2', inside)).toEqual({ close: false, focusButton: false });
    expect(disclosureFocusMove<string>(true, null, inside)).toEqual({ close: false, focusButton: false });
    expect(disclosureFocusMove(false, 'out:profile', inside)).toEqual({ close: false, focusButton: false });
  });

  it('바깥을 누르면 닫고 포커스는 건드리지 않는다(누른 곳으로 간다), 묶음 안을 누르면 그대로', () => {
    expect(disclosurePointerDown(true, 'out:page', inside)).toEqual({ close: true, focusButton: false });
    expect(disclosurePointerDown(true, 'in:button', inside)).toEqual({ close: false, focusButton: false });
    expect(disclosurePointerDown(false, 'out:page', inside)).toEqual({ close: false, focusButton: false });
  });

  it('링크를 고르면 닫고 포커스를 버튼으로(옮겨 간 화면에서도 상단 메뉴에 자리가 남게 — T-214 와 같다)', () => {
    expect(DISCLOSURE_PICKED).toEqual({ close: true, focusButton: true });
  });

  it('링크 누르기 — 그냥 누르기·키보드 Enter(단추 0)는 고르기, 새 탭·새 창으로 여는 누르기(⌘·Ctrl·Shift·Alt·가운데 단추)는 열어 둔다', () => {
    const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    expect(disclosureLinkClick(plain)).toEqual(DISCLOSURE_PICKED);
    for (const k of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
      expect(disclosureLinkClick({ ...plain, [k]: true }), k).toEqual({ close: false, focusButton: false });
    }
    expect(disclosureLinkClick({ ...plain, button: 1 })).toEqual({ close: false, focusButton: false });
  });
});

describe('TopNav 가 넘기는 링크 (T-226)', () => {
  const user = { id: 'u1', email: 'u@x', name: '관리자', role: 'admin', tenantId: 't1', plan: 'enterprise', platformRole: 'global_admin' };
  const shown = navItemsFor(navContextFor(user, null)).admin.map((i) => ({ ...i, label: i.labelKey, icon: FileText }));

  it('경로 표의 관리 항목 그대로(id·주소·순서), 지금 화면 표시는 navCurrent 와 같다 — 그 화면이면 page, 아니면 없음', () => {
    expect(shown.map((i) => i.path)).toEqual(['/variables', '/settings', '/integrations', '/audit-logs', '/admin']);
    for (const path of ['/settings', '/Settings', '/admin', '/platform-admin', '/policies', '/variables']) {
      const links = adminLinks(shown, path);
      expect(links.map((l) => l.to), path).toEqual(shown.map((i) => i.path));
      expect(links.map((l) => l.id), path).toEqual(shown.map((i) => i.id));
      expect(links.map((l) => l.current), path).toEqual(shown.map((i) => navCurrent(path, i.path)));
    }
    const at = adminLinks(shown, '/settings');
    expect(at.find((l) => l.to === '/settings')?.current).toBe('page');
    expect(at.filter((l) => l.current)).toHaveLength(1);
    expect(src('apps/web/src/components/TopNav.tsx')).toContain('items={adminLinks(nav.admin, pathname)}');
  });
});

const ITEMS: NavDisclosureItem[] = [
  { key: '/variables', id: 'nav-variables', to: '/variables', label: '공통 기준값' },
  { key: '/settings', id: 'nav-settings', to: '/settings', label: '설정', current: 'page' },
  { key: '/audit-logs', id: 'nav-audit-logs', to: '/audit-logs', label: '감사 로그' },
];
const draw = (open: boolean, extra: Partial<Parameters<typeof NavDisclosureView>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(NavDisclosureView, { id: 'nav-admin-group', label: '관리', items: ITEMS, open, listId: 'admin-list', ...extra }),
    ),
  );

describe('그리기 — 버튼과 링크 목록 (T-226)', () => {
  it('닫힘: 버튼 하나(aria-expanded=false, aria-controls 없음) — 목록·링크를 그리지 않아 Tab 차례에서 빠지고, 메뉴 역할·aria-haspopup 은 없다', () => {
    const html = draw(false);
    expect(html).toMatch(/<button[^>]*id="nav-admin-group"[^>]*type="button"[^>]*aria-expanded="false"/);
    expect(html).not.toContain('aria-controls');
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('id="nav-variables"');
    expect(html).not.toContain('aria-haspopup');
    expect(html).not.toMatch(/role="menu/);
  });

  it('열림: aria-controls 가 목록을 가리키고 목록은 ul > li > a — 항목은 링크(href)로 읽히며 menuitem·tabindex 가 없다, 지금 화면은 aria-current', () => {
    const html = draw(true);
    expect(html).toMatch(/<button[^>]*aria-expanded="true"[^>]*aria-controls="admin-list"/);
    expect(html).toContain('<ul id="admin-list"');
    expect(html.match(/<li>/g)).toHaveLength(ITEMS.length);
    expect(html).toMatch(/<li><a[^>]*id="nav-variables"[^>]*href="\/variables"/);
    expect(html).toMatch(/<a[^>]*id="nav-settings"[^>]*aria-current="page"[^>]*href="\/settings"/);
    expect(html).not.toMatch(/<a[^>]*id="nav-variables"[^>]*aria-current/);
    expect(html).not.toContain('menuitem');
    expect(html).not.toContain('tabindex');
    expect(html).not.toMatch(/role="/);
  });

  it('묶음 안 화면이면 버튼이 현재 위치로 — data-active 와 화면 읽기 프로그램에만 읽히는 말(색만으로 알리지 않게)', () => {
    const html = draw(false, { active: true, currentLabel: '(지금 화면이 이 묶음 안에 있음)' });
    expect(html).toMatch(/id="nav-admin-group"[^>]*data-active="true"/);
    expect(html).toContain('<span class="sr-only">(지금 화면이 이 묶음 안에 있음)</span>');
    expect(draw(false)).not.toContain('data-active');
  });
});

describe('연결 — 상태·닫힘 (T-226)', () => {
  const nav = src('apps/web/src/components/NavDisclosure.tsx');

  it('바깥 누르기·화면 이동·Esc·포커스 나감·링크 고르기가 규칙 함수로 닫는다', () => {
    expect(nav).toContain("document.addEventListener('mousedown', onDown);");
    expect(nav).toContain('if (disclosurePointerDown(true, e.target as Node, (n) => !!wrapRef.current?.contains(n)).close) setOpen(false);');
    expect(nav).toMatch(/if \(listRef\.current\?\.contains\(document\.activeElement\)\) buttonRef\.current\?\.focus\(\);\s*setOpen\(false\);\s*\}, \[pathname\]\);/);
    expect(nav).toContain('<div ref={wrapRef} className="relative" onKeyDown={onKeyDown} onBlur={onBlur}>');
    expect(nav).toContain('const r = disclosureKey(open, e.key);');
    expect(nav).toContain('apply(disclosureFocusMove(open, e.relatedTarget, (n) => !!wrapRef.current?.contains(n)))');
    expect(nav).toContain('const r = disclosureLinkClick(e);');
    // 새 탭 누르기로 열어 둘 때 포커스가 묶음 밖(링크에 포커스를 주지 않는 Safari)이면 누른 링크로 — Esc 가 듣게(2차 검토)
    expect(nav).toMatch(/if \(!r\.close && !wrapRef\.current\?\.contains\(document\.activeElement\)\) e\.currentTarget\.focus\(\{ preventScroll: true \}\);\s*apply\(r\);/);
    // 고르기는 목록 안 링크가 부른다(같은 화면 링크를 눌러 경로가 그대로여도 닫히게 — 화면 이동 효과는 돌지 않는다)
    expect(nav).toMatch(/<Link\s+id=\{item\.id\}\s+to=\{item\.to\}\s+aria-current=\{item\.current\}\s+onClick=\{onPick\}/);
    // 누르기로 열고 닫을 때도 포커스를 버튼에 — 누른 버튼에 포커스를 주지 않는 Safari·Firefox 에서 Esc·포커스 나감이 듣게(1차 검토)
    // 페이지를 굴리지 않는다(헤더가 고정이 아니라 반쯤 가린 버튼을 누르면 화면이 움직일 수 있다, 2차 검토)
    expect(nav).toMatch(/onToggle=\{\(\) => \{\s*buttonRef\.current\?\.focus\(\{ preventScroll: true \}\);\s*setOpen\(\(o\) => !o\);\s*\}\}/);
  });

  it('버튼·목록의 ref 가 이어져 있다 — 끊기면 Esc·고르기 뒤 버튼 포커스, 화면 이동 때 포커스 돌리기, 목록 밀기가 조용히 깨진다', () => {
    expect(nav).toMatch(/<button\s+ref=\{buttonRef\}\s+id=\{id\}/);
    expect(nav).toMatch(/<ul\s+ref=\{listRef\}\s+id=\{listId\}/);
    expect(nav).toContain('buttonRef={buttonRef}');
    expect(nav).toContain('listRef={listRef}');
  });

  it('키보드 포커스는 테두리로 따로 보이고, 마우스를 올린 줄은 다른 색 — 둘이 같은 색이면 포커스가 어디인지 가를 수 없다', () => {
    // 테두리 색은 흰 목록·포커스 배경(navy-50)과 3:1 넘게(navy-700 — 약 8:1·7.4:1, navy-400 은 2.8:1·2.6:1 이라 모자랐다, 2차 검토)
    expect(nav).toContain('focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-700');
    expect(nav).toContain('hover:bg-gray-100');
    expect(nav).not.toContain('hover:bg-navy-50');
  });

  it('닫으며 포커스를 버튼으로 돌릴 때는 목록이 사라지기 전에 옮긴다, 열린 목록은 화면 안으로 민다', () => {
    expect(nav).toMatch(/if \(r\.focusButton\) buttonRef\.current\?\.focus\(\);\s*setOpen\(false\);/);
    expect(nav).toContain('usePanelFit(listRef, open);');
  });

  it('상단 메뉴는 NavDisclosure 를 쓰고 공용 메뉴 버튼을 가져오지 않는다 — 규정 상세 도구 메뉴(T-215)는 메뉴 버튼 그대로', () => {
    const top = src('apps/web/src/components/TopNav.tsx');
    expect(top).toContain("import NavDisclosure from './NavDisclosure';");
    expect(top).toContain('<NavDisclosure');
    expect(top).not.toContain('DropdownMenu');
    expect(src('apps/web/src/components/policy-detail/PolicyToolbar.tsx')).toContain("import DropdownMenu, { type MenuItem } from '../DropdownMenu';");
    expect(src('apps/web/src/components/DropdownMenu.tsx')).toContain('role="menu"');
    // 머리 주석은 옛 메뉴 버튼(role=menu)을 말한다 — JSX 속성만 본다
    expect(nav).not.toMatch(/role=["{]|aria-haspopup=|["']menuitem/);
  });
});

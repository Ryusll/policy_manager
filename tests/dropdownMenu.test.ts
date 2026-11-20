import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MENU_CLOSED,
  flattenMenu,
  menuButtonClick,
  menuFocused,
  menuHover,
  menuItemsChanged,
  menuKey,
  panelShift,
  selectEffect,
  type MenuState,
} from '../apps/web/src/lib/menuKeys';

/**
 * T-214 공용 메뉴 버튼(DropdownMenu) — WAI-ARIA 메뉴 버튼 패턴의 상태 변화와 항목 종류별 닫힘 규칙. 화면 렌더 시험 환경(DOM)이 없어
 * 상태 전이는 lib/menuKeys 의 순수 함수로 보고, 컴포넌트가 그 함수를 부르는지는 소스로 본다. 실제 포커스 이동은 Chrome 으로 확인했다.
 */
const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const closed: MenuState = MENU_CLOSED;
const at = (index: number): MenuState => ({ open: true, index });

describe('메뉴 버튼 키보드 (T-214)', () => {
  it('버튼에서 Enter·Space·↓는 열고 첫 항목, ↑는 열고 마지막 항목', () => {
    for (const key of ['Enter', ' ', 'ArrowDown']) {
      expect(menuKey(closed, key, 4, 'button'), key).toEqual({ state: at(0), focus: 'item', handled: true });
    }
    expect(menuKey(closed, 'ArrowUp', 4, 'button')).toEqual({ state: at(3), focus: 'item', handled: true });
  });

  it('버튼에서 Esc 는 열려 있을 때만 닫고 포커스를 버튼에, 열린 채 Tab 은 닫는다(포커스 이동은 브라우저에), 항목이 없으면 열지 않는다', () => {
    expect(menuKey(at(0), 'Escape', 4, 'button')).toEqual({ state: closed, focus: 'button', handled: true });
    expect(menuKey(closed, 'Escape', 4, 'button').handled).toBe(false);
    expect(menuKey(at(0), 'Tab', 4, 'button')).toEqual({ state: closed, focus: 'keep', handled: false });
    expect(menuKey(closed, 'Tab', 4, 'button')).toEqual({ state: closed, focus: 'keep', handled: false });
    expect(menuKey(closed, 'Enter', 0, 'button').handled).toBe(false);
    expect(menuKey(closed, 'a', 4, 'button').handled).toBe(false);
  });

  it('메뉴에서 ↓↑는 끝에서 돌아가고 Home·End 는 처음·끝, 고른 항목이 없으면 ↓는 첫 항목·↑는 마지막', () => {
    expect(menuKey(at(3), 'ArrowDown', 4, 'menu').state).toEqual(at(0));
    expect(menuKey(at(0), 'ArrowUp', 4, 'menu').state).toEqual(at(3));
    expect(menuKey(at(1), 'ArrowDown', 4, 'menu').state).toEqual(at(2));
    expect(menuKey(at(2), 'Home', 4, 'menu').state).toEqual(at(0));
    expect(menuKey(at(0), 'End', 4, 'menu').state).toEqual(at(3));
    expect(menuKey(at(-1), 'ArrowDown', 4, 'menu').state).toEqual(at(0));
    expect(menuKey(at(-1), 'ArrowUp', 4, 'menu').state).toEqual(at(3));
  });

  it('메뉴에서 Esc 는 닫고 포커스를 버튼으로, Tab 은 닫되 포커스 이동은 브라우저에, 닫힌 메뉴에 온 키는 무시', () => {
    expect(menuKey(at(2), 'Escape', 4, 'menu')).toEqual({ state: closed, focus: 'button', handled: true });
    expect(menuKey(at(2), 'Tab', 4, 'menu')).toEqual({ state: closed, focus: 'keep', handled: false });
    expect(menuKey(closed, 'ArrowDown', 4, 'menu')).toEqual({ state: closed, focus: 'keep', handled: false });
  });

  it('메뉴에서 Space 는 지금 항목을 실행한다(아래 페이지가 스크롤되지 않게 기본 동작을 막는다)', () => {
    expect(menuKey(at(1), ' ', 4, 'menu')).toEqual({ state: at(1), focus: 'keep', handled: true, activate: true });
    expect(menuKey(at(-1), ' ', 4, 'menu').activate).toBeUndefined();
  });
});

describe('메뉴 버튼 누르기·마우스 올림·항목 수 변화 (T-214)', () => {
  it('버튼을 누르면 열고 첫 항목에 포커스(Safari·Firefox 는 누른 버튼에 포커스를 주지 않는다), 열려 있으면 닫고 버튼에', () => {
    expect(menuButtonClick(closed, 3)).toEqual({ state: at(0), focus: 'item', handled: true });
    expect(menuButtonClick(at(2), 3)).toEqual({ state: closed, focus: 'button', handled: true });
    expect(menuButtonClick(closed, 0).state).toEqual(closed);
  });

  it('마우스를 올리면 키 위치와 포커스가 그 항목으로 — ↓는 마우스 자리에서 이어진다', () => {
    const hovered = menuHover(at(1), 3);
    expect(hovered).toEqual({ state: at(3), focus: 'item', handled: true });
    expect(menuKey(hovered.state, 'ArrowDown', 5, 'menu').state).toEqual(at(4));
    expect(menuHover(closed, 2).state).toEqual(closed);
    expect(menuHover(at(2), 2).focus).toBe('keep');
  });

  it('키·마우스가 아닌 길로 포커스가 항목에 가면(화면 읽기 프로그램의 커서 등) 위치만 그 항목으로 — ↑↓ 가 거기서 이어진다', () => {
    expect(menuFocused(at(0), 2)).toEqual(at(2));
    expect(menuKey(menuFocused(at(0), 2), 'ArrowDown', 4, 'menu').state).toEqual(at(3));
    expect(menuFocused(closed, 2)).toBe(closed);
    const same = at(2);
    expect(menuFocused(same, 2)).toBe(same);
  });

  it('열린 동안 항목이 줄면 위치를 범위 안으로, 다 없어지면 닫는다', () => {
    expect(menuItemsChanged(at(4), 3)).toEqual(at(2));
    expect(menuItemsChanged(at(1), 3)).toEqual(at(1));
    expect(menuItemsChanged(at(1), 0)).toEqual(closed);
    expect(menuItemsChanged(closed, 0)).toEqual(closed);
  });

  it('묶음(group)은 펼친 순서로 키가 옮겨 간다 — 소제목은 항목이 아니다', () => {
    const items = [
      { kind: 'action', key: 'a' },
      { kind: 'group', items: [{ kind: 'radio', key: 'r1' }, { kind: 'radio', key: 'r2' }] },
      { kind: 'checkbox', key: 'c' },
    ];
    expect(flattenMenu(items as never[]).map((i: { key: string }) => i.key)).toEqual(['a', 'r1', 'r2', 'c']);
  });
});

describe('메뉴 항목 종류별 닫힘 규칙 — T-215 도구 메뉴가 그대로 쓴다 (T-214)', () => {
  it('링크·동작은 실행하고 닫고 포커스를 버튼으로', () => {
    expect(selectEffect({ kind: 'link' })).toEqual({ run: true, close: true, focusButton: true });
    expect(selectEffect({ kind: 'action' })).toEqual({ run: true, close: true, focusButton: true });
  });

  it('비활성 동작은 실행하지 않고 열어 둔다', () => {
    expect(selectEffect({ kind: 'action', disabled: true })).toEqual({ run: false, close: false, focusButton: false });
    expect(selectEffect({ kind: 'action', disabled: true, keepOpen: true })).toEqual({ run: false, close: false, focusButton: false });
  });

  it('단계 버튼(keepOpen)·켜고 끄기·하나 고르기는 실행하고 열어 둔다', () => {
    expect(selectEffect({ kind: 'action', keepOpen: true })).toEqual({ run: true, close: false, focusButton: false });
    expect(selectEffect({ kind: 'checkbox' })).toEqual({ run: true, close: false, focusButton: false });
    expect(selectEffect({ kind: 'radio' })).toEqual({ run: true, close: false, focusButton: false });
  });
});

describe('DropdownMenu 는 위 함수대로만 움직인다 (T-214)', () => {
  // 상태·키는 DropdownMenu, 항목 하나 그리기는 DropdownMenuItem(T-215 에서 떼어 냄) — 두 파일을 함께 본다
  const menu = src('apps/web/src/components/DropdownMenu.tsx') + src('apps/web/src/components/DropdownMenuItem.tsx');

  it('누르기·마우스 올림·키·고르기를 lib/menuKeys 로 판정하고, 고른 뒤 포커스는 selectEffect 대로', () => {
    expect(menu).toContain('onClick={() => apply(menuButtonClick(state, leaves.length))}');
    expect(menu).toContain('onHover={() => apply(menuHover(state, i), true)}');
    expect(menu).toContain('const r = menuKey(state, e.key, leaves.length, from);');
    expect(menu).toContain('const effect = selectEffect(item);');
    expect(menu).toContain("apply({ state: MENU_CLOSED, focus: effect.focusButton ? 'button' : 'keep', handled: true })");
    expect(menu).toContain("if (r.focus === 'button') buttonRef.current?.focus();");
    // Space 는 위치가 아니라 포커스가 있는 항목을 실행하고, 놓을 때의 기본 누르기는 막는다(두 번 실행되지 않게)
    expect(menu).toContain(`const focused = (e.target as HTMLElement).closest<HTMLElement>('[role^="menuitem"]');`);
    expect(menu).toContain('(focused ?? itemRefs.current[state.index])?.click();');
    expect(menu).toMatch(/onKeyUp=\{\(e\) => \{\s*if \(e\.key === ' '\) e\.preventDefault\(\);/);
    expect(menu).toContain('onFocus={() => setState((s) => menuFocused(s, i))}');
  });

  it('화면이 바뀌면 닫고, 항목 수가 바뀌면 위치를 맞추고, 바깥을 누르면 닫는다', () => {
    expect(menu).toMatch(/setState\(MENU_CLOSED\);\s*if \(wrapRef\.current\?\.contains\(document\.activeElement\)[^\n]*buttonRef\.current\?\.focus\(\);\s*\}, \[pathname\]\);/);
    expect(menu).toContain('useEffect(() => setState((s) => menuItemsChanged(s, leaves.length)), [leaves.length]);');
    expect(menu).toMatch(/document\.addEventListener\('mousedown', onDown\)/);
  });

  it('버튼은 aria-haspopup·aria-expanded 를, 켜짐 상태는 aria-checked 를, 묶음은 role=group 과 소제목 이름을 쓴다', () => {
    expect(menu).toContain('aria-haspopup="menu"');
    expect(menu).toContain('aria-expanded={state.open}');
    expect(menu).toContain('aria-checked={item.checked}');
    expect(menu).toContain("role={item.kind === 'radio' ? 'menuitemradio' : 'menuitemcheckbox'}");
    // 막힌 동작·radio 의 aria-disabled — 그린 결과로도 본다(tests/policyDetailReview.test.ts '막히면 안내 대신 이유를')
    expect(menu).toContain('aria-disabled={disabled || undefined}');
    expect(menu).toContain('role="group" aria-labelledby={headId}');
    // 묶음 앞뒤의 구분선, 메뉴 이름은 버튼의 이름 글자만(현재 위치 숨은 말은 넣지 않는다)
    expect(menu).toContain(`item.kind === 'group' || items[gi - 1].kind === 'group'`);
    expect(menu).toContain('<div role="separator"');
    expect(menu).toContain('<span id={labelId}>{label}</span>');
    expect(menu).toContain('aria-labelledby={labelId}');
    // 묶음의 현재 위치 표시(active·currentLabel)는 상단 '관리' 묶음과 함께 NavDisclosure 로 옮겼다(T-226 — tests/navDisclosure.test.ts)
    expect(menu).not.toContain('currentLabel');
    // 긴 메뉴는 화면 안에서 넘긴다
    expect(menu).toContain('max-h-[70vh] overflow-y-auto');
  });
});

describe('열린 패널을 화면 안으로 (T-215)', () => {
  it('오른쪽 끝을 넘으면 왼쪽으로 민다, 그래도 왼쪽이 넘치면 왼쪽 끝에 맞춘다, 안에 있으면 그대로', () => {
    expect(panelShift(250, 506, 390)).toBe(390 - 8 - 506); // 좁은 화면에서 오른쪽 버튼의 메뉴(16rem)
    expect(panelShift(20, 276, 390)).toBe(0);
    expect(panelShift(-30, 226, 390)).toBe(38); // 왼쪽 끝을 넘은 메뉴(오른쪽 정렬)
    expect(panelShift(100, 600, 390)).toBe(8 - 100); // 화면보다 넓으면 왼쪽부터 보인다
  });

  it('DropdownMenu 는 열 때 패널 위치를 재서 민다 — 재는 일은 lib/usePanelFit 하나(T-226 에서 떼어 냄, 관리 묶음과 같이 쓴다)', () => {
    const menu = src('apps/web/src/components/DropdownMenu.tsx');
    expect(menu).toContain('usePanelFit(panelRef, state.open);');
    expect(menu).toContain('ref={panelRef}');
    const fit = src('apps/web/src/lib/usePanelFit.ts');
    expect(fit).toContain('const shift = panelShift(r.left, r.right, window.innerWidth);');
    expect(fit).toContain('}, [ref, open]);');
  });
});

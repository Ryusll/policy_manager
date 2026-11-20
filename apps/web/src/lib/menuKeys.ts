/**
 * 메뉴 버튼의 상태 변화 — WAI-ARIA 메뉴 버튼 패턴(T-214, SRS NFR-10 '메뉴 묶음은 키보드로 쓸 수 있어야 한다').
 * 화면 렌더 시험 환경(DOM)이 없어 상태 전이를 순수 함수로 두고 시험한다 — `components/DropdownMenu` 는 결과대로 상태를 바꾸고
 * 포커스를 옮기기만 한다.
 *
 * - 버튼에서: Enter·Space·↓ → 열고 첫 항목, ↑ → 열고 마지막 항목, Esc → 닫기, 열린 채 Tab → 닫기
 * - 버튼 누르기(마우스): 열고 첫 항목에 포커스 — Safari·Firefox 는 누른 버튼에 포커스를 주지 않아 버튼에 둔 채로는 키가 닿지 않는다.
 *   열려 있으면 닫고 포커스는 버튼에
 * - 메뉴에서: ↓·↑ → 다음·이전(끝에서 돌아간다), Home·End → 처음·끝, Esc → 닫고 버튼으로, Tab → 닫는다(포커스는 브라우저 기본대로),
 *   Space → 지금 항목을 실행(링크도 — 아래 페이지가 스크롤되지 않게)
 * - 마우스를 올리면 그 항목으로 키 위치와 포커스를 옮긴다(키보드 위치와 마우스 위치가 따로 칠해지지 않게)
 */

export type MenuState = { open: boolean; index: number };
export type MenuFocus = 'item' | 'button' | 'keep';
/** `activate` — 지금 항목을 실행한다(Space) */
export type MenuKeyResult = { state: MenuState; focus: MenuFocus; handled: boolean; activate?: boolean };

export const MENU_CLOSED: MenuState = { open: false, index: -1 };

export function menuKey(state: MenuState, key: string, count: number, from: 'button' | 'menu'): MenuKeyResult {
  const none: MenuKeyResult = { state, focus: 'keep', handled: false };
  if (from === 'button') {
    if (key === 'Escape' && state.open) return { state: MENU_CLOSED, focus: 'button', handled: true };
    // 마우스로 열고 포커스가 버튼에 남은 채 Tab 을 누르면 메뉴만 남지 않게 닫는다
    if (key === 'Tab' && state.open) return { state: MENU_CLOSED, focus: 'keep', handled: false };
    if (count === 0) return none;
    if (key === 'Enter' || key === ' ' || key === 'ArrowDown') return { state: { open: true, index: 0 }, focus: 'item', handled: true };
    if (key === 'ArrowUp') return { state: { open: true, index: count - 1 }, focus: 'item', handled: true };
    return none;
  }
  if (!state.open) return none;
  if (key === 'Escape') return { state: MENU_CLOSED, focus: 'button', handled: true };
  if (key === 'Tab') return { state: MENU_CLOSED, focus: 'keep', handled: false };
  if (count === 0) return none;
  // 아직 고른 항목이 없으면(-1) ↓는 첫 항목, ↑는 마지막 항목
  const at = state.index;
  if (key === 'ArrowDown') return { state: { open: true, index: at < 0 ? 0 : (at + 1) % count }, focus: 'item', handled: true };
  if (key === 'ArrowUp') return { state: { open: true, index: at < 0 ? count - 1 : (at - 1 + count) % count }, focus: 'item', handled: true };
  if (key === 'Home') return { state: { open: true, index: 0 }, focus: 'item', handled: true };
  if (key === 'End') return { state: { open: true, index: count - 1 }, focus: 'item', handled: true };
  if (key === ' ' && at >= 0) return { state, focus: 'keep', handled: true, activate: true };
  return none;
}

/** 버튼을 눌렀다(마우스·터치) — 닫혀 있으면 열고 첫 항목에 포커스, 열려 있으면 닫고 버튼에 */
export function menuButtonClick(state: MenuState, count: number): MenuKeyResult {
  if (state.open) return { state: MENU_CLOSED, focus: 'button', handled: true };
  if (count === 0) return { state, focus: 'keep', handled: false };
  return { state: { open: true, index: 0 }, focus: 'item', handled: true };
}

/** 마우스가 항목에 올라갔다 — 키 위치와 포커스를 그 항목으로 */
export function menuHover(state: MenuState, index: number): MenuKeyResult {
  if (!state.open || state.index === index) return { state, focus: 'keep', handled: false };
  return { state: { open: true, index }, focus: 'item', handled: true };
}

/**
 * 키·마우스가 아닌 길로 포커스가 항목에 갔다(화면 읽기 프로그램의 커서, 찾기를 닫을 때 등) — 위치만 그 항목으로 맞춘다.
 * 위치가 어긋나면 ↑↓ 가 옛 자리에서 움직인다
 */
export function menuFocused(state: MenuState, index: number): MenuState {
  return state.open && state.index !== index ? { open: true, index } : state;
}

/** 열린 동안 항목 수가 바뀌었다(역할·플랜을 다시 받음 등) — 위치를 범위 안으로, 항목이 없어지면 닫는다 */
export function menuItemsChanged(state: MenuState, count: number): MenuState {
  if (!state.open) return state;
  if (count === 0) return MENU_CLOSED;
  return state.index >= count ? { open: true, index: count - 1 } : state;
}

/**
 * 열린 패널이 화면 밖으로 나가지 않게 가로로 밀 거리(px) — 좁은 화면에서 버튼이 오른쪽에 있으면 왼쪽으로 민다(T-215).
 * 오른쪽 끝을 먼저 맞추고, 그래도 왼쪽이 넘치면 왼쪽 끝에 맞춘다(패널이 화면보다 넓으면 왼쪽부터 보인다)
 */
export function panelShift(left: number, right: number, viewport: number, margin = 8): number {
  let shift = 0;
  if (right > viewport - margin) shift = viewport - margin - right;
  if (left + shift < margin) shift = margin - left;
  return shift;
}

/** 묶음(group)을 펼친 항목 순서 — 키 이동 위치는 이 순서다(묶음 소제목은 항목이 아니다) */
export function flattenMenu<T extends { kind: string }>(items: (T | { kind: 'group'; items: T[] })[]): T[] {
  return items.flatMap((it) => (it.kind === 'group' ? (it as { items: T[] }).items : [it as T]));
}

/** 항목 종류와 닫힘 규칙에 쓰는 칸 — `components/DropdownMenu` 의 MenuItem 과 같은 이름 */
export type MenuItemRule = { kind: 'link' | 'action' | 'checkbox' | 'radio'; disabled?: boolean; keepOpen?: boolean };

/**
 * 항목을 골랐을 때 실행하는가, 메뉴를 닫는가, 닫으면 포커스를 메뉴 버튼으로 돌리는가.
 * - 링크·동작: 실행하고 닫고 포커스는 버튼으로(링크도 — 상단 메뉴는 화면이 바뀌어도 남아 키보드 사용자가 자리를 잃지 않게).
 *   `keepOpen` 동작(글자 크기 단계처럼 이어 누르는 것)은 열어 둔다
 * - 비활성 항목(동작·하나 고르기 — 저장 중인 양식 radio 처럼): 실행하지 않고 열어 둔다 — 이유 문구를 읽을 수 있게
 * - 켜고 끄기(checkbox)·하나 고르기(radio): 실행하고 열어 둔다. 고르는 목록(select)은 radio 로 둔다 — 메뉴(role=menu) 안에는
 *   select 를 둘 수 없다(자식은 menuitem·menuitemcheckbox·menuitemradio·group·separator 뿐)
 */
export function selectEffect(item: MenuItemRule): { run: boolean; close: boolean; focusButton: boolean } {
  if (item.disabled) return { run: false, close: false, focusButton: false };
  if (item.kind === 'checkbox' || item.kind === 'radio') return { run: true, close: false, focusButton: false };
  if (item.kind === 'action' && item.keepOpen) return { run: true, close: false, focusButton: false };
  return { run: true, close: true, focusButton: true };
}

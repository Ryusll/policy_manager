/**
 * 상단 메뉴 '관리' 묶음의 disclosure 닫힘 규칙(T-226, SRS NFR-10) — 그리기(components/NavDisclosure)와 떼어 시험한다(lib/menuKeys 와
 * 같은 방식). 열기·닫기는 버튼의 Enter·Space 기본 동작, 링크 사이 옮기기는 Tab 이라 여기서 다루지 않는다(APG disclosure 의 화살표는
 * 선택 사항이라 두지 않았다).
 */
export type DisclosureClose = { close: boolean; focusButton: boolean };

const KEEP: DisclosureClose = { close: false, focusButton: false };

/** 키 — Esc 는 열려 있을 때만 닫고 포커스를 버튼으로 돌린다. 닫혀 있으면 처리하지 않는다(다른 곳의 Esc 를 막지 않게) */
export function disclosureKey(open: boolean, key: string): DisclosureClose {
  return open && key === 'Escape' ? { close: true, focusButton: true } : KEEP;
}

/**
 * 포커스가 옮겨 갔다 — 옮겨 간 곳이 있고 묶음 밖이면 닫는다(포커스는 옮긴 곳에 둔다). 옮겨 간 곳이 없으면 닫지 않는다 — 포커스를
 * 받지 않는 곳을 누르거나, Safari·Firefox 처럼 누른 링크에 포커스를 주지 않는 브라우저에서 목록 안 링크를 누르는 순간 닫혀 누르기가
 * 사라지지 않게(바깥 누르기는 disclosurePointerDown 이 맡는다)
 */
export function disclosureFocusMove<T>(open: boolean, next: T | null, inside: (n: T) => boolean): DisclosureClose {
  return open && next !== null && !inside(next) ? { close: true, focusButton: false } : KEEP;
}

/** 눌렀다 — 묶음 밖을 누르면 닫는다(포커스는 누른 곳으로 가므로 건드리지 않는다) */
export function disclosurePointerDown<T>(open: boolean, target: T, inside: (n: T) => boolean): DisclosureClose {
  return open && !inside(target) ? { close: true, focusButton: false } : KEEP;
}

/** 링크를 골랐다 — 닫고 포커스를 버튼으로(옮겨 간 화면에서도 상단 메뉴에 자리가 남게 — T-214 의 링크 항목과 같다) */
export const DISCLOSURE_PICKED: DisclosureClose = { close: true, focusButton: true };

type LinkClick = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };

/**
 * 링크를 눌렀다 — 새 탭·새 창으로 여는 누르기(⌘·Ctrl·Shift·Alt, 가운데 단추)는 이 화면을 옮기지 않으므로 고르기가 아니다: 목록을
 * 열어 둔다(관리 화면 여럿을 새 탭으로 열 수 있게, 1차 검토). 키보드 Enter 는 누르기(단추 0)로 온다
 */
export function disclosureLinkClick(e: LinkClick): DisclosureClose {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ? KEEP : DISCLOSURE_PICKED;
}

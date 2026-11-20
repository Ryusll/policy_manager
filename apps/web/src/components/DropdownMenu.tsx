import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import DropdownMenuItem, { type MenuItem, type MenuLeaf } from './DropdownMenuItem';
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
  type MenuKeyResult,
  type MenuState,
} from '../lib/menuKeys';

/**
 * 공용 메뉴 버튼(T-214, SRS NFR-10) — 상단 메뉴의 '관리' 묶음이 쓰고, 규정 상세 도구(T-215)가 그대로 쓴다.
 * 외부 패키지 없이 WAI-ARIA 메뉴 버튼 패턴: 버튼 `aria-haspopup`·`aria-expanded`, 상태 변화는 lib/menuKeys(키·누르기·마우스 올림),
 * 바깥 클릭·Esc·Tab·화면 이동으로 닫고, Esc·고르기로 닫히면 포커스를 버튼으로 돌린다(바깥 클릭이면 누른 곳으로).
 *
 * 항목 종류와 항목 하나 그리기는 `DropdownMenuItem`, 닫힘 규칙은 lib/menuKeys 의 selectEffect.
 */
export type { MenuGroup, MenuItem, MenuLeaf } from './DropdownMenuItem';

type Props = {
  /** 버튼 id — 투어·시험이 가리킨다 */
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  items: MenuItem[];
  /** 묶음 안 화면에 있을 때 버튼을 현재 위치로 보인다 */
  active?: boolean;
  /** 현재 위치일 때 화면 읽기 프로그램에만 읽히는 말 — 색만으로 알리지 않게 */
  currentLabel?: ReactNode;
  buttonClassName?: string;
  panelClassName?: string;
  align?: 'left' | 'right';
};

export default function DropdownMenu({ id, label, icon, items, active, currentLabel, buttonClassName, panelClassName, align = 'left' }: Props) {
  const [state, setState] = useState<MenuState>(MENU_CLOSED);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const panelId = useId();
  const labelId = useId();
  const { pathname } = useLocation();
  const leaves = flattenMenu(items);
  // 마우스로 옮긴 위치는 포커스할 때 패널을 굴리지 않는다(긴 메뉴에서 위치가 따라 움직이지 않게)
  const byHover = useRef(false);

  // 상태를 바꾸고 결과대로 포커스를 옮긴다(항목 포커스는 아래 효과가 위치를 따라 옮긴다)
  const apply = (r: MenuKeyResult, hover = false) => {
    byHover.current = hover;
    setState(r.state);
    if (r.focus === 'button') buttonRef.current?.focus();
  };

  // 바깥을 누르면 닫는다(포커스는 누른 곳으로 간다)
  useEffect(() => {
    if (!state.open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setState(MENU_CLOSED);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [state.open]);

  // 패널이 화면 밖으로 나가지 않게 가로로 민다(좁은 화면에서 버튼이 오른쪽 끝 가까이 있을 때 등). 열 때와, 열린 채 창 크기가
  // 바뀌거나(화면 회전 포함) 패널 폭이 바뀔 때(진행 문구·글자 크기 항목 글) 다시 잰다. 미는 값은 폭을 바꾸지 않아 되먹임이 없다
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!state.open || !el) return;
    const fit = () => {
      el.style.transform = '';
      const r = el.getBoundingClientRect();
      const shift = panelShift(r.left, r.right, window.innerWidth);
      if (shift) el.style.transform = `translateX(${shift}px)`;
    };
    fit();
    window.addEventListener('resize', fit);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(el);
    return () => {
      window.removeEventListener('resize', fit);
      observer?.disconnect();
    };
  }, [state.open]);

  // 화면이 바뀌면 닫는다 — 키보드 뒤로 가기·트랙패드 넘기기처럼 누르지 않고 옮겨 가도 메뉴가 새 화면을 덮지 않게.
  // 포커스가 메뉴 항목에 있었으면 버튼으로 돌린다(항목이 사라지며 포커스가 문서 처음으로 떨어지지 않게)
  useEffect(() => {
    setState(MENU_CLOSED);
    if (wrapRef.current?.contains(document.activeElement) && document.activeElement !== buttonRef.current) buttonRef.current?.focus();
  }, [pathname]);

  // 열린 동안 항목 수가 바뀌면 위치를 범위 안으로(없어지면 닫는다)
  useEffect(() => setState((s) => menuItemsChanged(s, leaves.length)), [leaves.length]);

  // 키·마우스로 옮긴 항목에 포커스를 둔다(이미 거기 있으면 그대로)
  useEffect(() => {
    if (!state.open || state.index < 0) return;
    const el = itemRefs.current[state.index];
    if (el && document.activeElement !== el) el.focus({ preventScroll: byHover.current });
  }, [state]);

  const onKey = (e: React.KeyboardEvent, from: 'button' | 'menu') => {
    const r = menuKey(state, e.key, leaves.length, from);
    if (r.handled) e.preventDefault();
    if (r.activate) {
      // Space — 포커스가 있는 항목을 누른 것과 같게(링크면 이동, 버튼이면 실행). 위치가 아니라 포커스로 고른다 —
      // 화면 읽기 프로그램의 커서처럼 키 없이 포커스가 옮겨 간 경우에도 보고 있는 항목을 실행하게
      const focused = (e.target as HTMLElement).closest<HTMLElement>('[role^="menuitem"]');
      (focused ?? itemRefs.current[state.index])?.click();
      return;
    }
    apply(r);
  };

  const select = (item: MenuLeaf) => {
    const effect = selectEffect(item);
    if (effect.run) {
      if (item.kind === 'action' || item.kind === 'radio') item.onSelect();
      else if (item.kind === 'checkbox') item.onToggle();
      // link 의 이동은 Link 가 한다
    }
    if (effect.close) apply({ state: MENU_CLOSED, focus: effect.focusButton ? 'button' : 'keep', handled: true });
  };

  // 항목 하나 — i 는 묶음을 펼친 순서(키 이동 위치)
  const renderLeaf = (item: MenuLeaf, i: number) => (
    <DropdownMenuItem
      key={item.key}
      item={item}
      highlighted={state.index === i}
      itemRef={(el) => {
        itemRefs.current[i] = el;
      }}
      onSelect={() => select(item)}
      onHover={() => apply(menuHover(state, i), true)}
      onFocus={() => setState((s) => menuFocused(s, i))}
    />
  );

  let flat = 0;
  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        id={id}
        type="button"
        aria-haspopup="menu"
        aria-expanded={state.open}
        aria-controls={state.open ? panelId : undefined}
        data-active={active ? 'true' : undefined}
        className={buttonClassName}
        onClick={() => apply(menuButtonClick(state, leaves.length))}
        onKeyDown={(e) => onKey(e, 'button')}
      >
        {icon}
        <span id={labelId}>{label}</span>
        {active && currentLabel ? <span className="sr-only">{currentLabel}</span> : null}
        <ChevronDown size={13} className={clsx('transition-transform', state.open && 'rotate-180')} aria-hidden />
      </button>
      {state.open && (
        <div
          ref={panelRef}
          id={panelId}
          role="menu"
          aria-labelledby={labelId}
          className={clsx(
            'absolute z-40 mt-1 min-w-[12rem] max-h-[70vh] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
          onKeyDown={(e) => onKey(e, 'menu')}
          // Space 의 기본 동작(놓을 때 누르기)은 막는다 — 누를 때 이미 실행했다(브라우저에 따라 두 번 실행되지 않게)
          onKeyUp={(e) => {
            if (e.key === ' ') e.preventDefault();
          }}
        >
          {items.map((item, gi) => {
            // 묶음과 그 앞뒤 항목 사이에는 구분선 — 묶음 뒤 낱개 항목이 묶음의 마지막 항목처럼 보이지 않게
            const sep = gi > 0 && (item.kind === 'group' || items[gi - 1].kind === 'group') ? <div role="separator" className="my-1 border-t border-gray-100" /> : null;
            if (item.kind !== 'group') return <Fragment key={item.key}>{sep}{renderLeaf(item, flat++)}</Fragment>;
            const headId = `${panelId}-g${gi}`;
            return (
              <Fragment key={item.key}>
                {sep}
                <div role="group" aria-labelledby={headId}>
                  <div id={headId} role="presentation" className="px-3 pt-1 pb-0.5 text-[11px] font-semibold text-gray-500">
                    {item.label}
                  </div>
                  {item.items.map((leaf) => renderLeaf(leaf, flat++))}
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

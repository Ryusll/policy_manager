import { useEffect, useId, useRef, useState, type KeyboardEvent, type FocusEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type Ref } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { disclosureFocusMove, disclosureKey, disclosureLinkClick, disclosurePointerDown, type DisclosureClose } from '../lib/disclosureKeys';
import { usePanelFit } from '../lib/usePanelFit';

/**
 * 상단 메뉴의 '관리' 묶음(T-226, SRS NFR-10) — 사이트 이동 링크라 WAI-ARIA disclosure 패턴(APG Disclosure Navigation Menu)으로 둔다.
 * T-214 의 메뉴 버튼(role=menu)은 묶음 안 링크가 menuitem 이라 열어도 화면 읽기 프로그램의 링크 목록에 나오지 않았다(C-114 ⑥, PM 결정
 * 11/20). 이제 묶음을 열면 그 안 링크가 링크 목록에 나온다 — 닫혀 있으면 접근성 트리에 없다(APG disclosure 와 같다).
 * - 버튼에 aria-expanded, 열렸을 때 aria-controls 가 목록을 가리킨다. Enter·Space·누르기로 열고 닫으며 포커스는 버튼에 둔다 — 누른
 *   버튼에 포커스를 주지 않는 Safari·Firefox 에서도(그래야 Esc·포커스 나감으로 닫힌다, 1차 검토)
 * - 목록(ul > li > a)은 열렸을 때만 그린다 — 열린 목록의 링크는 Tab·Shift+Tab 차례에 들고, 닫힌 목록은 차례에서 빠진다
 * - Esc 는 닫고 포커스를 버튼으로, 포커스가 묶음 밖으로 나가거나 바깥을 누르면 닫는다(포커스는 옮긴 곳에)
 * - 링크를 고르면 닫고 포커스를 버튼으로(T-214 와 같다) — 새 탭·새 창으로 여는 누르기(수정 키)는 고르기가 아니라 열어 둔다.
 *   화면이 바뀌어도 닫는다(뒤로 가기처럼 누르지 않고 옮겨 가도)
 * 닫힘 규칙은 lib/disclosureKeys, 그리기는 NavDisclosureView(시험이 열린 채로 그려 본다). 규정 상세 도구 메뉴(T-215)는 메뉴 버튼 그대로다.
 */
export type NavDisclosureItem = { key: string; id: string; to: string; label: ReactNode; icon?: ReactNode; current?: 'page' | 'true' };

type Props = {
  /** 버튼 id — 첫 방문 안내(4단계)·시험이 가리킨다 */
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  items: NavDisclosureItem[];
  /** 묶음 안 화면에 있을 때 버튼을 현재 위치로 보인다 */
  active?: boolean;
  /** 현재 위치일 때 화면 읽기 프로그램에만 읽히는 말 — 색만으로 알리지 않게 */
  currentLabel?: ReactNode;
  buttonClassName?: string;
};

type ViewProps = Props & {
  open: boolean;
  listId: string;
  buttonRef?: Ref<HTMLButtonElement>;
  listRef?: Ref<HTMLUListElement>;
  onToggle?: () => void;
  onPick?: (e: ReactMouseEvent<HTMLAnchorElement>) => void;
};

/** 그리기만 — 열림 상태를 받는다 */
export function NavDisclosureView({ id, label, icon, items, active, currentLabel, buttonClassName, open, listId, buttonRef, listRef, onToggle, onPick }: ViewProps) {
  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        data-active={active ? 'true' : undefined}
        className={buttonClassName}
        onClick={onToggle}
      >
        {icon}
        <span>{label}</span>
        {active && currentLabel ? <span className="sr-only">{currentLabel}</span> : null}
        <ChevronDown size={13} className={clsx('transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          className="absolute left-0 z-40 mt-1 min-w-[12rem] max-h-[70vh] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {items.map((item) => (
            <li key={item.key}>
              <Link
                id={item.id}
                to={item.to}
                aria-current={item.current}
                onClick={onPick}
                // 키보드 포커스는 테두리로 따로 보인다 — 마우스를 올린 줄(옅은 회색)과 포커스가 있는 줄이 같은 색이면 어디에 있는지
                // 가를 수 없다(T-214 메뉴는 마우스를 따라 포커스가 옮겼지만 disclosure 링크는 따로 움직인다, 1차 검토)
                className={clsx(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 outline-none hover:bg-gray-100 focus-visible:bg-navy-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-700',
                  item.current && 'font-semibold text-navy-800',
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function NavDisclosure(props: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const { pathname } = useLocation();
  usePanelFit(listRef, open);

  // 닫는다 — 포커스를 버튼으로 돌릴 때는 목록이 사라지기 전에 옮긴다(포커스가 문서 처음으로 떨어지지 않게)
  const apply = (r: DisclosureClose) => {
    if (!r.close) return;
    if (r.focusButton) buttonRef.current?.focus();
    setOpen(false);
  };

  // 바깥을 누르면 닫는다(포커스는 누른 곳으로 간다)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (disclosurePointerDown(true, e.target as Node, (n) => !!wrapRef.current?.contains(n)).close) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // 화면이 바뀌면 닫는다. 포커스가 목록 안 링크에 있었으면 버튼으로 돌린다(링크가 사라지며 포커스가 문서 처음으로 떨어지지 않게)
  useEffect(() => {
    if (listRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
    setOpen(false);
  }, [pathname]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const r = disclosureKey(open, e.key);
    if (!r.close) return;
    e.preventDefault();
    apply(r);
  };
  const onBlur = (e: FocusEvent<HTMLDivElement>) => apply(disclosureFocusMove(open, e.relatedTarget, (n) => !!wrapRef.current?.contains(n)));

  return (
    <div ref={wrapRef} className="relative" onKeyDown={onKeyDown} onBlur={onBlur}>
      <NavDisclosureView
        {...props}
        open={open}
        listId={listId}
        buttonRef={buttonRef}
        listRef={listRef}
        onToggle={() => {
          buttonRef.current?.focus({ preventScroll: true });
          setOpen((o) => !o);
        }}
        onPick={(e) => {
          const r = disclosureLinkClick(e);
          // 새 탭 누르기로 열어 둘 때 — 링크에 포커스를 주지 않는 Safari 는 포커스가 묶음 밖(body)에 남아 Esc 가 듣지 않으니 누른
          // 링크로 옮긴다(2차 검토)
          if (!r.close && !wrapRef.current?.contains(document.activeElement)) e.currentTarget.focus({ preventScroll: true });
          apply(r);
        }}
      />
    </div>
  );
}

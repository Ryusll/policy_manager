import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { clsx } from 'clsx';

/**
 * 공용 메뉴 버튼(`DropdownMenu`)의 항목 종류와 항목 하나 그리기(T-214, T-215 에서 떼어 냄).
 * 상태·키·닫힘 판단은 `DropdownMenu` 와 `lib/menuKeys` 가 하고, 여기서는 종류별 모양과 접근성 속성만 둔다.
 *
 * - link·action — 고르면 닫힌다. `keepOpen` 인 action(글자 크기 단계처럼 이어 누르는 것)은 닫히지 않는다
 * - 비활성(disabled, action·radio) — 이유 문구를 보이고 실행되지 않는다(포커스는 간다 — 왜 안 되는지 읽을 수 있게)
 * - checkbox — 켜고 끈다, radio — 여럿 중 하나를 고른다(양식 고르기처럼 select 자리). 둘 다 닫히지 않고 상태를 알린다(`aria-checked`)
 * - group — 소제목이 붙은 묶음(`role="group"`). radio 는 묶음 안에서 하나를 고른다(묶음이 없으면 메뉴 전체가 한 묶음)
 * - 항목 아래 작은 글(안내 hint·막힌 이유)은 항목 이름이 아니라 설명으로 읽힌다 — 글은 aria-hidden 으로 이름 계산에서 빼고
 *   aria-describedby 로 잇는다(직접 가리킨 숨은 글은 설명에 들어간다). 막힌 이유가 있으면 안내 대신 이유를 보인다
 */
export type MenuLeaf =
  | { kind: 'link'; key: string; to: string; label: ReactNode; icon?: ReactNode; current?: 'page' | 'true'; id?: string }
  | {
      kind: 'action';
      key: string;
      label: ReactNode;
      icon?: ReactNode;
      onSelect: () => void;
      keepOpen?: boolean;
      disabled?: boolean;
      disabledReason?: ReactNode;
      /** 항목 아래 작은 설명(예: 한/글 2014 이상에서 열립니다) */
      hint?: ReactNode;
    }
  | { kind: 'checkbox'; key: string; label: ReactNode; checked: boolean; onToggle: () => void }
  | { kind: 'radio'; key: string; label: ReactNode; checked: boolean; onSelect: () => void; disabled?: boolean; disabledReason?: ReactNode };
export type MenuGroup = { kind: 'group'; key: string; label: ReactNode; items: MenuLeaf[] };
export type MenuItem = MenuLeaf | MenuGroup;

type Props = {
  item: MenuLeaf;
  /** 키 위치가 이 항목이다 */
  highlighted: boolean;
  itemRef: (el: HTMLElement | null) => void;
  onSelect: () => void;
  onHover: () => void;
  onFocus: () => void;
};

export default function DropdownMenuItem({ item, highlighted, itemRef, onSelect, onHover, onFocus }: Props) {
  const noteId = useId();
  const disabled = (item.kind === 'action' || item.kind === 'radio') && !!item.disabled;
  const reason = (item.kind === 'action' || item.kind === 'radio') && disabled ? item.disabledReason : undefined;
  const note = reason || (item.kind === 'action' ? item.hint : undefined);
  const noteEl = note ? (
    <span id={noteId} aria-hidden className="basis-full text-[11px] text-gray-500">
      {note}
    </span>
  ) : null;
  const cls = clsx(
    'flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm outline-none',
    disabled ? 'text-gray-400 cursor-not-allowed' : 'text-gray-800 focus:bg-navy-50',
    highlighted && 'bg-navy-50',
  );
  const common = { ref: itemRef, tabIndex: -1, onClick: onSelect, onMouseEnter: onHover, onFocus, 'aria-describedby': note ? noteId : undefined };
  if (item.kind === 'link') {
    return (
      <Link {...common} id={item.id} to={item.to} role="menuitem" aria-current={item.current} className={clsx(cls, item.current && 'font-semibold text-navy-800')}>
        {item.icon}
        {item.label}
      </Link>
    );
  }
  if (item.kind === 'checkbox' || item.kind === 'radio') {
    return (
      <button
        {...common}
        type="button"
        role={item.kind === 'radio' ? 'menuitemradio' : 'menuitemcheckbox'}
        aria-checked={item.checked}
        aria-disabled={disabled || undefined}
        className={cls}
      >
        <span className="inline-flex w-4 justify-center" aria-hidden>
          {item.checked ? <Check size={14} /> : null}
        </span>
        {item.label}
        {noteEl}
      </button>
    );
  }
  return (
    <button {...common} type="button" role="menuitem" aria-disabled={disabled || undefined} className={cls}>
      {item.icon}
      {item.label}
      {noteEl}
    </button>
  );
}

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { clsx } from 'clsx';
import { policiesApi } from '../api/policies';
import { useI18n } from '../i18n/useI18n';
import {
  ASK_SCOPE_MAX,
  SCOPE_LIST_LIMIT,
  filterScopeCandidates,
  pruneScope,
  scopeCandidates,
  toggleScope,
} from '../lib/askScope';

/**
 * 질문 범위 고르기(T-219, SRS SEARCH-11) — 입력 카드 아래 줄의 단추. 고르지 않으면 회사의 시행 중 규정 전체에서 찾는다.
 * 목록은 규정 목록과 같은 캐시(['policies'])를 쓰고 활성 규정만 보인다. Esc·바깥 누름·닫기로 닫고 단추로 초점을 돌려준다.
 * Tab 으로 창 밖에 나가도 닫는다. 창은 질문 폼 안에 있어, 창 안 입력칸의 Enter 가 질문을 보내지 않게 막는다.
 * 보내는 동안(disabled)은 창을 닫고 고를 수 없다. 고른 규정이 비활성으로 바뀌거나 지워지면 목록을 다시 받을 때 빼고 알린다.
 */
export function AskScopePicker({
  selected,
  onChange,
  disabled,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const panelId = useId();
  // 고를 수 없게 되어 뺀 규정 수 — 범위가 말없이 바뀌지 않게 다시 고를 때까지 알린다
  const [prunedCount, setPrunedCount] = useState(0);
  const policies = useQuery({ queryKey: ['policies'], queryFn: policiesApi.list });
  const { data } = policies;
  const candidates = useMemo(() => scopeCandidates(data), [data]);
  const shown = useMemo(() => filterScopeCandidates(candidates, query), [candidates, query]);
  const change = (ids: string[]) => {
    setPrunedCount(0);
    onChange(ids);
  };

  // 고를 수 없게 된 규정(비활성으로 바뀌었거나 지운 것)은 목록을 받은 뒤 뺀다
  useEffect(() => {
    if (!data) return;
    const pruned = pruneScope(selected, candidates);
    if (pruned.length !== selected.length) {
      setPrunedCount(selected.length - pruned.length);
      onChange(pruned);
    }
  }, [data, candidates, selected, onChange]);

  // 보내기 시작하면 창을 닫는다 — 보내는 동안 범위를 바꾸지 못하게
  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
      setQuery('');
    }
  }, [disabled, open]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // 닫으면 찾던 글자를 비운다 — 다시 열 때 목록이 걸러진 채로 보이지 않게
  const close = () => {
    setOpen(false);
    setQuery('');
    trigger.current?.focus();
  };

  return (
    <div
      className="relative"
      ref={box}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
        }
        // 창은 질문 폼 안에 있다 — 찾기 칸·체크 상자의 Enter 가 질문을 보내지 않게(한글 조합을 끝내는 Enter 는 그대로 둔다)
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.target instanceof HTMLInputElement) e.preventDefault();
      }}
      onBlur={(e) => {
        // Tab 으로 창 밖에 나가면 닫는다(창 안의 빈 곳을 눌러도 초점은 창에 머문다 — tabIndex -1)
        if (open && !box.current?.contains(e.relatedTarget)) {
          setOpen(false);
          setQuery('');
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid="ask-scope-trigger"
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs disabled:opacity-50',
          selected.length ? 'border-navy-300 bg-navy-50 text-navy-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50',
        )}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Layers size={12} />
        {selected.length ? t('ask.scope.count', { n: selected.length }) : t('ask.scope.all')}
      </button>
      {prunedCount > 0 && (
        <span className="ml-2 text-[11px] text-amber-700" role="status" data-testid="ask-scope-pruned">
          {t('ask.scope.pruned', { n: prunedCount })}
        </span>
      )}
      {open && (
        <div
          id={panelId}
          role="dialog"
          tabIndex={-1}
          aria-label={t('ask.scope.label')}
          data-testid="ask-scope-panel"
          className="absolute left-0 top-full z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] space-y-2 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
        >
          <input
            ref={search}
            type="search"
            className="input w-full text-sm"
            aria-label={t('ask.scope.search')}
            placeholder={t('ask.scope.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="text-[11px] text-gray-500">{t('ask.scope.hint')}</p>
          {policies.isLoading && <p className="text-xs text-gray-500">{t('ask.scope.loading')}</p>}
          {policies.isError && (
            <div className="flex items-center gap-2 text-xs text-red-700" data-testid="ask-scope-error">
              <span>{t('ask.scope.loadError')}</span>
              <button type="button" className="text-navy-700 hover:underline" onClick={() => policies.refetch()}>
                {t('asOfView.retry')}
              </button>
            </div>
          )}
          <ul className="max-h-60 divide-y divide-gray-50 overflow-y-auto">
            {shown.slice(0, SCOPE_LIST_LIMIT).map((p) => {
              const on = selected.includes(p.id);
              return (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-start gap-2 px-1 py-1.5 text-sm hover:bg-gray-50">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={on}
                      disabled={disabled || (!on && selected.length >= ASK_SCOPE_MAX)}
                      onChange={() => change(toggleScope(selected, p.id))}
                      data-testid="ask-scope-option"
                    />
                    <span className="min-w-0">
                      <span className="mr-1.5 text-gray-400">{p.code}</span>
                      {p.title}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {data && candidates.length === 0 && <p className="text-xs text-gray-500">{t('ask.scope.none')}</p>}
          {candidates.length > 0 && shown.length === 0 && <p className="text-xs text-gray-500">{t('ask.scope.empty')}</p>}
          {shown.length > SCOPE_LIST_LIMIT && (
            <p className="text-xs text-gray-500">{t('ask.scope.more', { n: shown.length - SCOPE_LIST_LIMIT })}</p>
          )}
          {selected.length >= ASK_SCOPE_MAX && <p className="text-xs text-amber-700">{t('ask.scope.max', { n: ASK_SCOPE_MAX })}</p>}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              className="text-xs text-navy-700 hover:underline disabled:opacity-40"
              disabled={disabled || !selected.length}
              onClick={() => {
                // 비우면 이 단추가 잠겨 초점을 잃는다 — 그 전에 찾기 칸으로 옮겨 창이 닫히지 않게
                search.current?.focus();
                change([]);
              }}
              data-testid="ask-scope-clear"
            >
              {t('ask.scope.clear')}
            </button>
            <button type="button" className="btn-secondary text-xs px-2.5 py-1" onClick={close}>
              {t('ask.scope.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

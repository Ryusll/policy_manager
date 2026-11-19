import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { SquarePen } from 'lucide-react';
import { clsx } from 'clsx';
import { askApi } from '../api/ask';
import { useI18n } from '../i18n/useI18n';
import { ASK_STATUS_KEY } from '../hooks/useAskStatus';
import { groupHistory, historyErrorKind, historyPeriodLabel, retryHistoryLoad } from '../lib/askHistory';

/** 내 지난 질문 목록의 쿼리 키 — 새로 물으면 이 키를 무효로 해 목록에 바로 보인다 */
export const ASK_HISTORY_KEY = ['ask-history'] as const;

interface PanelProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

/** 질문 화면 왼쪽 칸 — 넓은 화면에서는 늘 보이고, 좁은 화면에서는 단추로 열고 고르면 닫는다 */
export function AskHistoryAside({ selectedId, onSelect, onNew }: PanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <aside className="lg:w-60 lg:shrink-0">
      <button
        type="button"
        className="btn-secondary w-full justify-center text-sm lg:hidden"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="ask-history-toggle"
      >
        {open ? t('ask.history.hide') : t('ask.history.show')}
      </button>
      <div className={clsx(open ? 'mt-3 block' : 'hidden', 'lg:mt-0 lg:block')}>
        <AskHistoryPanel
          selectedId={selectedId}
          onSelect={(id) => {
            onSelect(id);
            setOpen(false);
          }}
          onNew={() => {
            onNew();
            setOpen(false);
          }}
        />
      </div>
    </aside>
  );
}

/**
 * 질문 화면 왼쪽의 내 지난 질문(T-218, SRS SEARCH-10). 본인 것만, 보관 기간(90일) 안, 최신순으로 기간별로 묶는다.
 * 답하지 못한 질문은 그 사실을 함께 보인다. 고르면 그때의 답을 다시 본다(AI 를 부르지 않아 한도에 세지 않는다).
 */
export function AskHistoryPanel({ selectedId, onSelect, onNew }: PanelProps) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ASK_HISTORY_KEY,
    queryFn: ({ pageParam }) => askApi.history(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    retry: retryHistoryLoad,
  });
  const closed = query.isError && historyErrorKind(query.error) === 'closed';
  // 그사이 회사가 꺼졌거나 고지가 바뀌었으면 상태를 다시 받아 질문 화면 전체를 안내로 바꾼다
  useEffect(() => {
    if (closed) void qc.invalidateQueries({ queryKey: ASK_STATUS_KEY });
  }, [closed, qc]);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const now = new Date();

  return (
    <nav className="space-y-3" aria-label={t('ask.history.title')} data-testid="ask-history">
      <button type="button" className="btn-secondary w-full justify-center text-sm" onClick={onNew} data-testid="ask-history-new">
        <SquarePen size={14} /> {t('ask.history.new')}
      </button>
      <p className="px-1 text-xs font-semibold text-gray-500">{t('ask.history.title')}</p>
      {query.isLoading && <p className="px-1 text-xs text-gray-400">{t('ask.history.loading')}</p>}
      {/* 처음 목록이든 '더 보기'든 — 다시 시도는 첫 쪽부터 다시 받아 그사이 바뀐 목록에 맞춘다 */}
      {query.isError && (
        <div className="space-y-1 px-1 text-xs text-red-700" data-testid="ask-history-error">
          <p>{t('ask.history.loadError')}</p>
          <button
            type="button"
            className="text-navy-700 hover:underline disabled:opacity-50"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            {t('asOfView.retry')}
          </button>
        </div>
      )}
      {query.isSuccess && items.length === 0 && <p className="px-1 text-xs text-gray-500">{t('ask.history.empty')}</p>}
      {groupHistory(items, now).map((group) => (
        <div key={group.period.key} className="space-y-0.5">
          <p className="px-1 text-[11px] text-gray-400">{historyPeriodLabel(group.period, now, locale, t)}</p>
          <ul>
            {group.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  data-testid="ask-history-item"
                  aria-current={item.id === selectedId ? 'true' : undefined}
                  title={item.question}
                  className={clsx(
                    'w-full rounded px-2 py-1.5 text-left text-sm',
                    item.id === selectedId ? 'bg-navy-50 font-medium text-navy-800' : 'text-gray-700 hover:bg-gray-100',
                  )}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="block truncate">{item.question}</span>
                  {item.outcome !== 'answered' && (
                    <span className="block text-[11px] text-amber-700" data-testid="ask-history-outcome">
                      {t(`ask.history.outcome.${item.outcome}`)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {query.hasNextPage && (
        <button
          type="button"
          className="px-1 text-xs text-navy-700 hover:underline disabled:opacity-50"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
          data-testid="ask-history-more"
        >
          {t('ask.history.more')}
        </button>
      )}
    </nav>
  );
}

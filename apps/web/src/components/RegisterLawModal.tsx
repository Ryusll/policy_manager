/**
 * 법령 등록 창 — 법제처에서 법령을 찾아 추적 대상으로 등록한다 (T-102). LawsPage 에서 나눴다(T-210).
 *
 * 검색 결과는 서버가 검색어와 맞는 순으로 준다(LAW-28). 예전에는 가나다순 첫 20건만 받아서, "상법"처럼 약칭에 걸린
 * 법령이 많은 검색어는 찾던 법령이 끝까지 내려도 나오지 않았다. 지금은 100건씩 받고 '더 보기'로 끝까지 볼 수 있다.
 */

import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Search, SearchX, X } from 'lucide-react';
import { lawsApi } from '../api/laws';
import { lawGoKrApi } from '../api/lawgokr';
import { apiErrorMessage } from '../lib/apiError';
import {
  LAW_SEARCH_PAGE_SIZE,
  LAW_SEARCH_QUERY_MAX,
  mergeSearchPages,
  nextSearchPage,
  retrySearch,
  searchFailureText,
} from '../lib/lawSearchPages';
import { toast } from '../stores/toastStore';
import { useI18n } from '../i18n/useI18n';
import { EmptyState } from './ui/EmptyState';
import { LoadingBlock } from './ui/LoadingBlock';

export default function RegisterLawModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const { data: config } = useQuery({ queryKey: ['lawgokr', 'status'], queryFn: lawGoKrApi.status });

  const searchKey = ['lawgokr', 'search-for-register', query];
  const searchQuery = useInfiniteQuery({
    queryKey: searchKey,
    queryFn: ({ pageParam }) => lawGoKrApi.search({ q: query, page: pageParam, display: LAW_SEARCH_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: nextSearchPage,
    enabled: !!query && config?.configured !== false,
    // 결과는 사용자가 검색을 누를 때만 다시 받는다. 여러 쪽을 받은 뒤 다른 창에 다녀왔다고 처음부터 쪽 수만큼 다시 청하면
    // 그동안 검색을 못 누르고, 그러다 실패하면 아무것도 안 눌렀는데 실패 줄이 뜬다(서버도 같은 쪽을 10분 캐시한다)
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: retrySearch,
  });
  const { items, total, ranked } = mergeSearchPages(searchQuery.data?.pages);
  // 첫 검색·다시 검색 중(다음 쪽을 받는 중은 '더 보기' 버튼이 따로 알린다)
  const searching = searchQuery.isFetching && !searchQuery.isFetchingNextPage;
  const counts = { shown: items.length.toLocaleString(), total: total.toLocaleString() };
  const countText = !items.length ? '' : t(items.length < total ? 'laws.register.countPartial' : 'laws.register.count', counts);

  const registerMutation = useMutation({
    mutationFn: (mst: string) => lawsApi.register(mst),
    onSuccess: (law) => {
      void qc.invalidateQueries({ queryKey: ['laws', 'list'] });
      setError('');
      onClose();
      toast(
        // T-151: 이 법령을 이미 다른 판으로 추적 중이면 새로 만들지 않고 그 법령을 돌려준다
        // T-150: 요청한 판이 현행이 아니면 현행 판으로 등록했다 — 시행 예정 개정은 다음 동기화가 변경으로 받는다
        law.alreadyTracked
          ? t('laws.alreadyTracked', { name: law.lawName })
          : law.beforePending
            ? t('laws.registeredBeforePending', { name: law.lawName, pending: law.beforePending })
            : law.requestedMst
              ? t('laws.registeredCurrent', { name: law.lawName, requested: law.requestedMst })
              : t('laws.registered', { name: law.lawName, count: law.articleCount }),
        'success',
      );
    },
    onError: (err: unknown) => setError(apiErrorMessage(err, t('laws.register.failed'))),
  });

  // 등록 중에는 닫지 않는다 — 닫으면 실패를 알릴 곳이 없고, 다시 열어 같은 법령을 또 누를 수 있다
  const registering = registerMutation.isPending;
  const close = () => {
    if (!registering) onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 한글을 조합하는 중의 Esc 는 조합 취소다 — 창을 닫지 않는다
      if (e.key === 'Escape' && !e.isComposing && !registering) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [registering, onClose]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = input.trim();
    if (!next) return;
    setError('');
    // 같은 검색어를 다시 내면(검색 실패 뒤 재시도) 상태가 안 바뀌어 요청이 나가지 않는다 — 받아 둔 쪽을 버리고 첫 쪽부터 다시 받는다
    if (next === query) void qc.resetQueries({ queryKey: searchKey, exact: true });
    else setQuery(next);
  };
  // 같은 검색어를 찾는 중일 때만 잠근다 — 찾는 중에도 검색어를 고쳐 바로 다시 낼 수 있다
  const sameInFlight = searching && input.trim() === query;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      // 배경에서 누르기 시작했을 때만 닫는다 — 검색어를 끌어 고르다 배경에서 손을 떼도 닫히지 않게(click 은 공통 조상인 배경으로 간다)
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="register-law-title"
        className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 id="register-law-title" className="text-sm font-semibold text-gray-800">
            {t('laws.register.title')}
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={registering}
            aria-label={t('laws.register.close')}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        {config?.configured === false ? (
          <div className="p-4">
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              {t('laws.register.notConfiguredLead')}
              <code className="font-mono">LAW_GO_KR_OC</code>
              {t('laws.register.notConfiguredTail')}
            </p>
          </div>
        ) : (
          <>
            {/* 검색 칸은 목록을 내려도 자리에 남는다 — 결과가 100건씩 온다 */}
            <div className="p-4 pb-3 space-y-3">
              <form className="flex gap-2" onSubmit={submit}>
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    className="input w-full pl-8 text-sm"
                    placeholder={t('laws.register.placeholder')}
                    aria-label={t('laws.register.placeholder')}
                    value={input}
                    maxLength={LAW_SEARCH_QUERY_MAX}
                    onChange={(e) => setInput(e.target.value)}
                    autoFocus
                  />
                </div>
                <button type="submit" className="btn-primary text-sm" disabled={!input.trim() || sameInFlight}>
                  {sameInFlight ? t('laws.register.searching') : t('laws.register.search')}
                </button>
              </form>

              {error && (
                <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {error}
                </p>
              )}
              {searchQuery.isError && !searchQuery.isFetching && (
                <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {/* 까닭 뒤에 무엇을 하면 되는지를 붙인다 — 실패의 갈래마다 다르다(법제처 연결 문제는 고객용 문구로) */}
                  {searchFailureText(searchQuery.error, searchQuery.isFetchNextPageError, t)}
                </p>
              )}
              {searchQuery.isPaused && (
                <p role="alert" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  {t('laws.register.offline')}
                </p>
              )}

              {/* 알림 영역은 늘 그려 두고 글자만 바꾼다 — 결과와 함께 새로 생기는 영역은 화면낭독기가 읽지 않는다 */}
              <p className="sr-only" aria-live="polite">
                {countText}
              </p>
              {countText && (
                <p className="text-[11px] text-gray-500 tabular-nums" aria-hidden="true">
                  {countText}
                </p>
              )}
              {items.length > 0 && ranked === false && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                  {t('lawSearch.unranked')}
                </p>
              )}
            </div>

            <div className="px-4 pb-4 space-y-3 overflow-y-auto min-h-0">
              {searching && items.length === 0 && <LoadingBlock label={t('laws.register.searching')} />}

              {searchQuery.isSuccess && items.length === 0 && !searching && (
                <EmptyState
                  compact
                  icon={SearchX}
                  title={t('laws.register.empty', { query })}
                  description={t('laws.register.emptyHint')}
                  className="border border-gray-200 rounded-lg"
                />
              )}

              {items.length > 0 && (
                <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
                  {items.map((law) => (
                    <li key={law.mst} className="flex items-center justify-between gap-3 p-2.5 hover:bg-gray-50/70">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate" title={law.title}>
                          {law.title}
                        </p>
                        {/* 약칭에 걸려 나온 결과가 왜 나왔는지 알 수 있게 약칭도 적는다(LAW-28) — 잘리지 않게 줄을 넘긴다 */}
                        <p className="text-[11px] text-gray-500 break-words">
                          {[law.lawType, law.ministry, law.shortTitle ? t('lawSearch.shortTitle', { name: law.shortTitle }) : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn-primary text-xs whitespace-nowrap shrink-0"
                        disabled={registering}
                        onClick={() => {
                          setError('');
                          registerMutation.mutate(law.mst);
                        }}
                      >
                        <Download size={13} />
                        {registering && registerMutation.variables === law.mst
                          ? t('laws.register.submitting')
                          : t('laws.register.submit')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {searchQuery.hasNextPage && (
                <button
                  type="button"
                  className="btn-secondary text-xs w-full justify-center"
                  disabled={searchQuery.isFetchingNextPage}
                  onClick={() => void searchQuery.fetchNextPage()}
                >
                  {searchQuery.isFetchingNextPage ? t('laws.register.loadingMore') : t('laws.register.more', counts)}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

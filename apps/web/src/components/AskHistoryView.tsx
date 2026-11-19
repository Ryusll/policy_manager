import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircleQuestion } from 'lucide-react';
import { askApi } from '../api/ask';
import { LoadingBlock } from './ui/LoadingBlock';
import { AskTurnView } from './AskTurn';
import { ASK_HISTORY_KEY } from './AskHistoryPanel';
import { useI18n } from '../i18n/useI18n';
import { ASK_STATUS_KEY } from '../hooks/useAskStatus';
import { formatAskedAt, historyErrorKind, retryHistoryLoad } from '../lib/askHistory';

/**
 * 지난 질문 다시 보기(T-218, SRS SEARCH-10 ③) — 물은 때의 답과 근거 문구 그대로, 언제 받은 답인지와
 * 그 뒤 규정이 바뀌었을 수 있다는 것을 함께 알린다. 근거를 남기기 전의 기록은 답 본문만 있다.
 */
export function AskHistoryView({ id, canOpenLaws }: { id: string; canOpenLaws: boolean }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: [...ASK_HISTORY_KEY, id],
    queryFn: () => askApi.historyItem(id),
    retry: retryHistoryLoad,
  });
  const errorKind = isError ? historyErrorKind(error) : null;
  // 보관 기간이 지나 없어졌으면 목록만 다시 받아 그 항목을 거둔다(이 쿼리까지 다시 부르지 않게 목록 키만).
  // 그사이 회사가 꺼졌거나 고지가 바뀌었으면 상태를 다시 받아 질문 화면 전체를 안내로 바꾼다
  useEffect(() => {
    if (errorKind === 'gone') void qc.invalidateQueries({ queryKey: ASK_HISTORY_KEY, exact: true });
    if (errorKind === 'closed') void qc.invalidateQueries({ queryKey: ASK_STATUS_KEY });
  }, [errorKind, qc]);

  if (isLoading) return <LoadingBlock />;
  if (isError || !data) {
    return (
      <div className="card p-4 text-sm text-red-700 bg-red-50 border-red-200 flex flex-wrap items-center gap-3" data-testid="ask-history-error">
        <span>{errorKind === 'gone' ? t('ask.history.itemGone') : t('ask.history.itemError')}</span>
        {/* 없어진 질문만 다시 불러도 소용없다 — 403 도 그사이 다시 켜졌을 수 있어 단추를 둔다 */}
        {errorKind !== 'gone' && (
          <button type="button" className="btn-secondary text-xs px-2.5 py-1" disabled={isFetching} onClick={() => refetch()}>
            {t('asOfView.retry')}
          </button>
        )}
      </div>
    );
  }
  const at = formatAskedAt(data.createdAt, locale);
  return (
    <div className="space-y-2" data-testid="ask-history-view">
      <p className="text-xs text-gray-500" data-testid="ask-history-when">
        {data.result?.answerable ? t('ask.history.answeredAt', { at }) : t('ask.history.askedAt', { at })}
      </p>
      {data.result ? (
        <AskTurnView question={data.question} result={data.result} canOpenLaws={canOpenLaws} />
      ) : (
        <div className="card p-5 space-y-3" data-testid="ask-turn">
          <div className="flex items-start gap-2">
            <MessageCircleQuestion size={18} className="mt-0.5 shrink-0 text-gray-400" />
            <p className="text-sm font-medium text-gray-900 whitespace-pre-wrap">{data.question}</p>
          </div>
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            {t(`ask.history.detail.${data.outcome}`)}
          </p>
        </div>
      )}
      {data.result?.answerable && !data.snapshot && <p className="text-xs text-gray-500">{t('ask.history.noSnapshot')}</p>}
    </div>
  );
}

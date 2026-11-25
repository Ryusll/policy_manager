import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CornerDownRight, MessageCircleQuestion } from 'lucide-react';
import { askApi, type AskHistoryDetail } from '../api/ask';
import { LoadingBlock } from './ui/LoadingBlock';
import { AskTurnView } from './AskTurn';
import { AskScopeLine } from './AskScopeLine';
import { ASK_HISTORY_KEY } from './AskHistoryPanel';
import { useI18n } from '../i18n/useI18n';
import { ASK_STATUS_KEY } from '../hooks/useAskStatus';
import { formatAskedAt, historyErrorKind, retryHistoryLoad } from '../lib/askHistory';
import { canFollowUpFrom } from '../lib/askFollowUp';

/**
 * 지난 질문 다시 보기(T-218, SRS SEARCH-10 ③) — 물은 때의 답과 근거 문구 그대로, 언제 받은 답인지와
 * 그 뒤 규정이 바뀌었을 수 있다는 것을 함께 알린다. 근거를 남기기 전의 기록은 답 본문만 있다.
 */
export function AskHistoryView({
  id,
  canOpenLaws,
  onFollowUp,
  followUpDisabled = false,
}: {
  id: string;
  canOpenLaws: boolean;
  /** 이 답에 이어서 묻기(T-220) — 답을 냈고 근거(회사 조문)를 남긴 기록에만 단추가 보인다 */
  onFollowUp?: (detail: AskHistoryDetail) => void;
  /** 보내는 동안에는 잇지 못한다 — 결과가 오면 그 답으로 잇기가 옮겨 가 고른 것을 덮는다 */
  followUpDisabled?: boolean;
}) {
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
      {data.parentId && (
        <p className="text-xs text-gray-500" data-testid="ask-history-parent">
          {data.parent ? t('ask.followUp.parent', { question: data.parent.question }) : t('ask.followUp.parentGone')}
        </p>
      )}
      {data.result ? (
        <AskTurnView question={data.question} result={data.result} scope={data.scope} followUp={!!data.parentId} canOpenLaws={canOpenLaws} />
      ) : (
        <div className="card p-5 space-y-3" data-testid="ask-turn">
          <div className="flex items-start gap-2">
            <MessageCircleQuestion size={18} className="mt-0.5 shrink-0 text-gray-400" />
            <p className="text-sm font-medium text-gray-900 whitespace-pre-wrap">{data.question}</p>
          </div>
          <AskScopeLine scope={data.scope} />
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            {t(`ask.history.detail.${data.outcome}`)}
          </p>
        </div>
      )}
      {data.result?.answerable && !data.snapshot && <p className="text-xs text-gray-500">{t('ask.history.noSnapshot')}</p>}
      {onFollowUp && canFollowUpFrom(data) && (
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-1 text-xs px-2.5 py-1"
          disabled={followUpDisabled}
          onClick={() => onFollowUp(data)}
          data-testid="ask-history-follow-up"
        >
          <CornerDownRight size={12} /> {t('ask.followUp.button')}
        </button>
      )}
    </div>
  );
}

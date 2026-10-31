import { LoadingBlock } from './ui/LoadingBlock';
import { useI18n } from '../i18n/useI18n';

/**
 * 시점 조회를 골랐는데 그 날짜 응답이 아직 없을 때 본문 자리에 그린다(T-180). 받는 중이면 로딩, 실패면 오류와 다시 시도 —
 * 현행 본문이나 빈 양식을 그 시점 본문처럼 그리지 않는다.
 */
export function AsOfStatusBlock({ date, failed, onRetry }: { date: string; failed: boolean; onRetry: () => void }) {
  const { t } = useI18n();
  if (!failed) return <LoadingBlock label={t('asOfView.loading', { date })} />;
  return (
    <div role="alert" className="m-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p>{t('asOfView.loadFailed')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
      >
        {t('asOfView.retry')}
      </button>
    </div>
  );
}

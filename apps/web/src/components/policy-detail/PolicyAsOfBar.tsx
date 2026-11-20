import { clsx } from 'clsx';
import { useI18n } from '../../i18n/useI18n';
import type { AsOfInfo } from '../../lib/asOfView';
import { formatArticleAnchor } from '../../lib/articleAnchor';

type Props = {
  /** 기준일(YYYY-MM-DD) — 비면 현행 */
  asOfDate: string;
  onPick: (date: string) => void;
  onClear: () => void;
  /** 본문이 바뀐 시행일 목록 */
  effectiveDates: string[];
  today: string;
  info: AsOfInfo | null;
  failed: boolean;
  loading: boolean;
  onRetry: () => void;
};

/**
 * 시점 조회 줄(T-215 에서 도구 줄에서 떼어 냄, T-126·T-180) — 기준일에 시행 중이던 본문으로 전문을 갈아끼운다. 날짜와 개정 시점 고르기는
 * 한 기능의 붙은 입력이다. 상태 문구(준비됨·불러오는 중·실패와 다시 시도), 그날 폐지돼 뺀 조문, 시행일 기록이 없을 때의 안내를 함께 보인다.
 */
export default function PolicyAsOfBar(p: Props) {
  const { t } = useI18n();
  const repealed = p.info?.repealedArticles ?? [];
  return (
    <div className="px-3 py-2 sm:px-4 flex flex-wrap items-center gap-2 border-b border-gray-100 bg-white">
      <label htmlFor="policy-as-of" className="text-[11px] font-semibold text-slate-700">
        {t('policyDetail.asOf.label')}
      </label>
      <input id="policy-as-of" type="date" className="input text-xs py-1.5 w-[10.5rem]" value={p.asOfDate} onChange={(e) => p.onPick(e.target.value)} />
      {p.effectiveDates.length > 0 && (
        <select
          className="input text-xs py-1.5 max-w-[12rem]"
          value=""
          onChange={(e) => e.target.value && p.onPick(e.target.value)}
          aria-label={t('policyDetail.asOf.revisionAria')}
        >
          <option value="">{t('policyDetail.asOf.revisionPick')}</option>
          {p.effectiveDates.map((d) => (
            <option key={d} value={d}>
              {t(d > p.today ? 'policyDetail.asOf.scheduled' : 'policyDetail.asOf.effective', { date: d })}
            </option>
          ))}
        </select>
      )}
      {p.asOfDate ? (
        <>
          <button type="button" onClick={p.onClear} className="text-[11px] px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50">
            {t('policyDetail.asOf.current')}
          </button>
          <span
            className={clsx(
              'text-[11px] rounded px-2 py-0.5 border',
              p.failed ? 'text-red-800 bg-red-50 border-red-200' : 'text-amber-800 bg-amber-50 border-amber-200',
            )}
            role={p.failed ? 'alert' : undefined}
          >
            {p.info
              ? `${t('asOfView.ready', { date: p.info.date })}${p.info.omittedArticles ? t('asOfView.omitted', { count: p.info.omittedArticles }) : ''}`
              : p.failed
                ? t('asOfView.loadFailed')
                : t('asOfView.loading', { date: p.asOfDate })}
          </span>
          {p.failed && (
            <button type="button" onClick={p.onRetry} className="text-[11px] px-2 py-1 rounded border border-red-300 bg-white text-red-800 hover:bg-red-50">
              {t('asOfView.retry')}
            </button>
          )}
          {!p.loading && repealed.length > 0 && (
            <span className="text-[11px] text-red-800 bg-red-50 border border-red-200 rounded px-2 py-0.5" data-testid="as-of-repealed">
              {t('policyDetail.asOf.repealed', {
                n: repealed.length,
                list: repealed
                  .slice(0, 5)
                  .map((a) => t('policyDetail.asOf.repealedOn', { article: formatArticleAnchor(a), date: a.repealedOn }))
                  .join(', '),
              })}
              {repealed.length > 5 ? t('policyDetail.asOf.repealedMore', { n: repealed.length - 5 }) : ''}
            </span>
          )}
          {p.info && !p.info.hasEffectiveDates ? <span className="text-[11px] text-gray-500">{t('policyDetail.asOf.noDates')}</span> : null}
        </>
      ) : (
        <span className="text-[11px] text-gray-500">{t('policyDetail.asOf.emptyHint', { date: p.today })}</span>
      )}
    </div>
  );
}

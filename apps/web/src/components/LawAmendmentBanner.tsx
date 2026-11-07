import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../i18n/useI18n';
import { AMENDMENT_SUMMARY_KEY, amendmentSummaryApi, syncPendingBadge, type AmendmentSummaryLine } from '../api/amendmentSummary';
import { lawVersionWithType } from '../lib/lawVersionLabel';

/**
 * 대시보드 법령 개정 배너(T-158, SRS LAW-19, ADR-0021 결과) — 사실만 보인다: 시행 예정 개정마다 시행일·법령·우리 조문 N개·처리 대기
 * 후보 K건, 법령 시행일이 지났는데 처리하지 않은 후보는 따로 한 줄. '개정이 필요하다' 같은 판단은 넣지 않는다. 할 일이 없으면 숨기고
 * 닫기 버튼은 두지 않는다(놓치지 않게). 불러오지 못하면 0건처럼 보이지 않게 알린다. 관리자·편집자 대시보드에서만 그린다
 */
export default function LawAmendmentBanner() {
  const { t, isEn } = useI18n();
  const qc = useQueryClient();
  const { data, dataUpdatedAt, isError } = useQuery({ queryKey: AMENDMENT_SUMMARY_KEY, queryFn: amendmentSummaryApi.get, staleTime: 60_000 });
  useEffect(() => {
    if (data) syncPendingBadge(qc, data.pending, dataUpdatedAt); // 배너의 처리 대기 수와 메뉴 배지가 나란히 다르게 보이지 않게
  }, [qc, data, dataUpdatedAt]);
  if (isError) {
    return (
      <p className="card px-3 py-2 text-sm text-red-700" role="alert">
        {t('dashboard.lawBanner.loadFailed')}
      </p>
    );
  }
  if (!data || (!data.pending && !data.upcoming.length)) return null;

  const day = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return isEn
      ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
      : `${y}년 ${m}월 ${d}일`;
  };
  const titleOf = (l: AmendmentSummaryLine) => [`「${l.lawFullName}」`, lawVersionWithType(l.version, t)].filter(Boolean).join(' ');

  return (
    <section className="card border-amber-200 bg-amber-50/60 p-3 space-y-2" aria-labelledby="law-banner-title" data-testid="law-amendment-banner">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="law-banner-title" className="text-sm font-semibold text-gray-800">
          {t('dashboard.lawBanner.title')}
        </h2>
        {data.pending > 0 && (
          <Link to="/amendments" className="btn-primary text-xs" data-testid="law-banner-review">
            {t('dashboard.lawBanner.review', { count: data.pending })}
          </Link>
        )}
      </div>
      {data.overdue > 0 && (
        <p className="text-sm font-medium text-red-700" data-testid="law-banner-overdue">
          {t('dashboard.lawBanner.overdue', { count: data.overdue })}
        </p>
      )}
      {data.upcoming.length > 0 && (
        <ul className="space-y-1">
          {data.upcoming.map((l) => (
            <li key={`${l.lawId}|${l.effectiveDate}|${l.version?.promulgationNo ?? ''}`} className="text-sm text-gray-800" data-testid="law-banner-line">
              <span title={titleOf(l)}>
                {t('dashboard.lawBanner.upcoming', { date: day(l.effectiveDate), law: l.lawName, articles: l.articles, pending: l.pending })}
              </span>{' '}
              <Link to={l.pending ? '/amendments' : `/laws/${l.lawId}`} className="whitespace-nowrap text-navy-700 hover:underline">
                {l.pending ? t('dashboard.lawBanner.reviewShort') : t('dashboard.lawBanner.viewLaw')}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data.more > 0 && <p className="text-xs text-gray-500">{t('dashboard.lawBanner.more', { count: data.more })}</p>}
    </section>
  );
}

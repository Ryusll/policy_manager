import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { DASHBOARD_OVERVIEW_KEY, dashboardOverviewApi, type DashboardOverview } from '../../api/dashboardOverview';
import { AMENDMENT_SUMMARY_KEY, amendmentSummaryApi } from '../../api/amendmentSummary';
import { LoadingBlock } from '../ui/LoadingBlock';
import LawAmendmentBanner from '../LawAmendmentBanner';
import LawSyncStaleNotice from '../LawSyncStaleNotice';
import RecentLawChanges from './RecentLawChanges';

/**
 * 대시보드 법령 개정 구역(T-213, SRS LAW-19 수정) — 처리할 것이 없어도 숨기지 않는다.
 * 연결 법령 수와 그 법령들의 '마지막 확인'(법령별, LAW-17) 가운데 가장 오래된 시각, 확인하지 못한 법령, 추천 연결,
 * T-158 배너 줄(처리 대기·시행 예정·시행일 지난 미처리 — 그대로), 최근 법령 개정 다섯 줄.
 * 동기화 멈춤 경고는 LAW-17 규칙 그대로(LawSyncStaleNotice — 성공 실행이 없거나 못 불러오면 고객사에는 그리지 않는다).
 * '실시간'·위험·등급 표현은 쓰지 않는다(LAW-17·LAW-23).
 */
export default function LawAmendmentSection() {
  const { t } = useI18n();
  const { data, isError, isPending } = useQuery({ queryKey: DASHBOARD_OVERVIEW_KEY, queryFn: dashboardOverviewApi.get, staleTime: 0 });
  // '처리 대기 없음'은 배너와 같은 조회(T-158 요약)로 — 배너 줄과 서로 다른 시점의 숫자로 말이 엇갈리지 않게(같은 키라 요청은 하나)
  const { data: summary, isError: summaryFailed } = useQuery({ queryKey: AMENDMENT_SUMMARY_KEY, queryFn: amendmentSummaryApi.get, staleTime: 60_000 });

  return (
    <section className="section-card" aria-labelledby="dashboard-law-title" data-testid="dashboard-law-section">
      <div className="section-card__head">
        <h2 id="dashboard-law-title">{t('dashboard.law.title')}</h2>
        <Link to="/laws" className="text-xs text-navy-200 hover:text-white inline-flex items-center gap-1">
          {t('dashboard.law.toLaws')} <ArrowRight size={12} />
        </Link>
      </div>
      <div className="px-4 py-3 space-y-2">
        <LawSyncStaleNotice scope="laws" />
        {isPending ? (
          <LoadingBlock label={t('dashboard.law.loading')} />
        ) : isError ? (
          // 다시 읽기가 실패하면 이전 값이 남는다 — 옛 숫자를 오류와 함께 보이지 않는다(지표 카드와 같다)
          <p className="text-sm text-red-700" role="alert">
            {t('dashboard.law.loadFailed')}
          </p>
        ) : (
          <LinkStatus links={data.links} />
        )}
        {/* T-158 배너 줄 — 처리 대기·시행 예정·시행일 지난 미처리. 요약 조회로 따로 받아 집계가 느리거나 실패해도 보인다(둘 다 실패하면
            오류는 위 한 줄로). 줄이 없으면 배너는 그리지 않고, 요약의 처리 대기가 0 이면 아래 한 줄이 대신한다 */}
        <LawAmendmentBanner hideError={isError} />
        {/* 다시 읽기가 실패하면 TanStack 은 이전 값을 남긴다 — 남은 0 으로 '없습니다'라고 단정하지 않는다(배너처럼 실패를 먼저 본다) */}
        {!summaryFailed && summary?.pending === 0 && <p className="text-sm text-gray-600">{t('dashboard.law.noPending')}</p>}
      </div>
      {!isPending && !isError && <RecentLawChanges lines={data.recentLawChanges} />}
    </section>
  );
}

/** 연결 법령 확인 상태 — 연결 없음 안내·연결 법령 수와 가장 오래된 확인·확인 실패·확인 전·추천 연결 */
function LinkStatus({ links }: { links: DashboardOverview['links'] }) {
  const { t, isEn } = useI18n();
  return (
    <>
      {links.confirmedLinks === 0 && (
        <p className="text-sm text-gray-600" data-testid="dashboard-law-nolinks">
          {t('dashboard.law.noLinks')}{' '}
          <Link to="/laws" className="text-navy-700 font-medium hover:underline">
            {t('dashboard.law.noLinksCta')}
          </Link>
        </p>
      )}
      {links.confirmedLinks > 0 && (
        <p className="text-xs text-gray-600" data-testid="dashboard-law-status">
          {t('dashboard.law.status', { laws: links.linkedLaws })}
          {links.oldestCheckedAt
            ? ` · ${t('dashboard.law.oldestCheck', { at: new Date(links.oldestCheckedAt).toLocaleString(isEn ? 'en-US' : 'ko-KR') })}`
            : null}
        </p>
      )}
      {(links.failedLaws > 0 || links.uncheckedLaws > 0) && (
        <p className="text-xs text-amber-800" data-testid="dashboard-law-unverified">
          {[
            links.failedLaws > 0 ? t('dashboard.law.failed', { n: links.failedLaws }) : null,
            links.uncheckedLaws > 0 ? t('dashboard.law.unchecked', { n: links.uncheckedLaws }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}{' '}
          <Link to="/laws" className="underline font-medium">
            {t('dashboard.law.unverifiedCta')}
          </Link>
        </p>
      )}
      {links.suggestedLinks > 0 && <p className="text-xs text-gray-600">{t('dashboard.law.suggested', { n: links.suggestedLinks })}</p>}
    </>
  );
}

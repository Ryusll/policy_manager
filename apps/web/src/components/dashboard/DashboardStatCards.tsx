import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { DASHBOARD_OVERVIEW_KEY, dashboardOverviewApi } from '../../api/dashboardOverview';

/**
 * 대시보드 지표 카드 넷(T-213, SRS LAW-29) — 관리 규정·연결 법령·개정 검토 대기·사내 시행 예정.
 * 숫자는 서버 집계 하나(`GET /dashboard/overview`)에서 — 개정 검토 대기는 메뉴 배지·개정 검토 목록과,
 * 사내 시행 예정은 아래 '제·개정 예고'와 같은 조건이다. 관리자·편집자만 그린다(부르는 쪽이 가린다).
 */
export default function DashboardStatCards() {
  const { t } = useI18n();
  // 규정·버전을 바꾸고 돌아오면 바로 맞도록 늘 다시 읽는다(첫 화면 하나라 부담이 작다)
  const { data, isError } = useQuery({ queryKey: DASHBOARD_OVERVIEW_KEY, queryFn: dashboardOverviewApi.get, staleTime: 0 });

  if (isError) {
    return (
      <p className="text-sm text-red-700" role="alert">
        {t('dashboard.cards.loadFailed')}
      </p>
    );
  }

  const pending = data ? data.candidates.draft + data.candidates.review : null;
  const scheduled = data ? data.scheduled.amend + data.scheduled.repeal : null;
  const cards = [
    {
      key: 'policies',
      to: '/policies',
      label: t('dashboard.cards.policies'),
      value: data?.policies.active,
      sub: data && t('dashboard.cards.policiesSub', { articles: data.policies.articlesInForce, inactive: data.policies.inactive }),
      color: 'border-l-navy-600',
    },
    {
      key: 'laws',
      to: '/laws',
      label: t('dashboard.cards.laws'),
      value: data?.links.linkedLaws,
      sub: data && t('dashboard.cards.lawsSub', { links: data.links.confirmedLinks }),
      color: 'border-l-blue-500',
    },
    {
      key: 'review',
      to: '/amendments',
      label: t('dashboard.cards.review'),
      value: pending,
      sub: data && t('dashboard.cards.reviewSub', { draft: data.candidates.draft, review: data.candidates.review }),
      color: 'border-l-amber-500',
    },
    {
      key: 'scheduled',
      // 전용 화면이 없다 — 같은 화면의 '제·개정 예고'로 간다
      to: '#dashboard-scheduled',
      label: t('dashboard.cards.scheduled'),
      value: scheduled,
      sub: data && t('dashboard.cards.scheduledSub', { amend: data.scheduled.amend, repeal: data.scheduled.repeal }),
      color: 'border-l-gold-500',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="dashboard-stat-cards">
      {cards.map((c) => {
        const body = (
          <>
            <div className="text-xs text-gray-500">{c.label}</div>
            <div className="text-2xl font-bold text-gray-900 tabular-nums mt-0.5" data-testid={`dashboard-card-${c.key}`}>
              {c.value ?? '—'}
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5 min-h-[1rem]">{c.sub || ''}</div>
          </>
        );
        const cls = `stat-card ${c.color} block hover:bg-navy-50/60 transition-colors`;
        return c.to.startsWith('#') ? (
          <a key={c.key} href={c.to} className={cls}>
            {body}
          </a>
        ) : (
          <Link key={c.key} to={c.to} className={cls}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}

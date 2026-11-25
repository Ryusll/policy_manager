import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import type { RecentLawLine } from '../../api/dashboardOverview';

/**
 * 최근 법령 개정 다섯 줄(T-213, SRS LAW-19 수정) — 한 줄 = 법령·법령 시행일(배너와 같은 단위), 공포일이 늦은 순(없으면 감지한 날).
 * 우리 조문은 확정 연결로 닿는 조문과 그 줄의 후보 조문을 합친 수, 후보 현황은 대기·승인·반려.
 */
export default function RecentLawChanges({ lines }: { lines: RecentLawLine[] }) {
  const { t } = useI18n();
  return (
    <div className="border-t border-gray-100" data-testid="dashboard-recent-laws">
      <h3 className="px-4 pt-3 text-xs font-semibold text-gray-700">{t('dashboard.law.recentTitle')}</h3>
      {lines.length === 0 ? (
        <p className="px-4 py-3 text-sm text-gray-500">{t('dashboard.law.recentEmpty')}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {lines.map((l) => {
            const any = l.pending + l.approved + l.rejected > 0;
            return (
              <li
                key={l.key}
                className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                data-testid="dashboard-recent-law-line"
              >
                <Link to={`/laws/${l.lawId}`} title={l.lawFullName} className="font-medium text-gray-900 hover:underline">
                  {l.lawName}
                </Link>
                <span className="text-xs text-gray-500 tabular-nums">
                  {/* 공포일이 없으면 줄을 세운 감지한 날을 보인다 */}
                  {l.promulgatedDate
                    ? t('dashboard.law.promulgated', { date: l.promulgatedDate })
                    : t('dashboard.law.detected', { date: l.detectedDate })}
                  {l.effectiveDate ? ` · ${t('dashboard.law.effective', { date: l.effectiveDate })}` : null}
                </span>
                <span className="text-xs text-gray-700">{t('dashboard.law.ourArticles', { n: l.articles })}</span>
                <span className={`text-xs ${any ? 'text-gray-700' : 'text-gray-400'}`}>
                  {any
                    ? t('dashboard.law.candidateState', { pending: l.pending, approved: l.approved, rejected: l.rejected })
                    : t('dashboard.law.noCandidates')}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

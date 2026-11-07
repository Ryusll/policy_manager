import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../i18n/useI18n';
import { AMENDMENT_PENDING_KEY, amendmentSummaryApi } from '../api/amendmentSummary';

/**
 * 메뉴 '개정 검토'의 처리 대기 배지(T-158) — 처리하지 않은 개정 후보 수(개정 검토 기본 목록의 건수, AI 의견과 상관없이 전부).
 * 0이면 숨기고 99를 넘으면 '99+', 불러오지 못하면 '!'(0건과 섞이지 않게). 목록과 같은 조회(건수만)를 쓴다. 메뉴에 '개정 검토'가 있는
 * 관리자·편집자에게만 그려진다
 */
export default function AmendmentsNavBadge() {
  const { t } = useI18n();
  const { data: count = 0, isError } = useQuery({ queryKey: AMENDMENT_PENDING_KEY, queryFn: amendmentSummaryApi.pendingCount, staleTime: 60_000 });
  if (isError) {
    return (
      <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold leading-4 text-white" data-testid="amendments-nav-badge-error">
        <span aria-hidden="true">!</span>
        <span className="sr-only">{t('layout.nav.amendmentsPendingFailed')}</span>
      </span>
    );
  }
  if (!count) return null;
  return (
    <span className="ml-1 rounded-full bg-gold-500 px-1.5 text-[10px] font-semibold leading-4 text-navy-800" data-testid="amendments-nav-badge">
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{t('layout.nav.amendmentsPending', { count })}</span>
    </span>
  );
}

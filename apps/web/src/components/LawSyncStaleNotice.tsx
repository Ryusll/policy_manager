import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../i18n/useI18n';
import { LAW_SYNC_STATUS_KEY, lawSyncStatusApi } from '../api/lawSyncStatus';

/**
 * 법령 동기화 멈춤 경고(T-153 ④, SRS LAW-17) — 마지막 성공 실행이 36시간을 넘으면 알린다. 서버가 읽을 때 계산한 값을 그대로 보인다
 * (브라우저 시계로 셈하지 않는다). 플랫폼 관리자(`platform`)에게는 볼 곳(서버 예약·로그)까지, 고객 법령 화면(`laws`)에는 사실과
 * 문의처만 — 내부 문서·작업 번호는 싣지 않는다. 성공 실행이 한 번도 없으면 플랫폼에만 그렇게 알린다(새 설치에 고객 경고를 내지 않게).
 * 상태를 불러오지 못하면 통합 관리자에게는 그렇게 알리고(조회가 깨졌을 때 경고가 정상처럼 사라지지 않게), 고객 법령 화면에는
 * 그리지 않는다 — 법령 화면을 오류로 만들지 않는다
 */
/** @param className 감싸는 쪽 여백 — 경고가 없으면 아무것도 그리지 않아 빈 여백도 남지 않는다 */
export default function LawSyncStaleNotice({ scope, className = '' }: { scope: 'platform' | 'laws'; className?: string }) {
  const { t, isEn } = useI18n();
  const { data, isError } = useQuery({
    queryKey: LAW_SYNC_STATUS_KEY[scope],
    queryFn: scope === 'platform' ? lawSyncStatusApi.platform : lawSyncStatusApi.laws,
    staleTime: 60_000,
  });
  if (scope === 'platform' && isError) {
    return (
      <p role="alert" className={`text-xs text-red-800 bg-red-50 border border-red-200 rounded px-2.5 py-1.5 ${className}`} data-testid="law-sync-status-error">
        {t('lawSync.stale.loadError')}
      </p>
    );
  }
  if (!data) return null;
  const at = data.lastSuccessAt ? new Date(data.lastSuccessAt).toLocaleString(isEn ? 'en-US' : 'ko-KR') : '';
  let text: string | null = null;
  if (scope === 'platform' && !data.everSucceeded) text = t('lawSync.stale.never');
  else if (data.stale) text = t(scope === 'platform' ? 'lawSync.stale.platform' : 'lawSync.stale.laws', { hours: data.staleAfterHours, at });
  if (!text) return null;
  return (
    <p role="status" className={`text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 ${className}`} data-testid="law-sync-stale">
      {text}
    </p>
  );
}

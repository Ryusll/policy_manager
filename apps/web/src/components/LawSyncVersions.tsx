import { useI18n } from '../i18n/useI18n';
import type { LawSyncResult } from '../api/laws';

/**
 * 동기화 결과의 판 사슬(T-151) — 두 확인 사이에 공포된 판을 공포 순으로 하나씩 반영한 것을 보인다.
 * 판마다 단계 시행일과 변경 조항 수가 따로라, 중간 판의 변경이 마지막 판의 날짜로 묶이지 않았다는 것이 보인다
 */
export default function LawSyncVersions({ result }: { result: Pick<LawSyncResult, 'versions' | 'remaining'> }) {
  const { t } = useI18n();
  const versions = result.versions ?? [];
  if (!versions.length && !result.remaining) return null;
  return (
    <span className="block pl-3 text-gray-600" data-testid="law-sync-versions">
      {versions.length > 0 && <span className="block">{t('lawSync.versionsApplied', { count: versions.length })}</span>}
      {versions.map((v) => (
        <span key={v.mst} className="block pl-2">
          ·{' '}
          {t('lawSync.versionItem', {
            label: v.label,
            type: v.revisionType ? ` ${v.revisionType}` : '',
            dates: v.stageEffectiveDates.join(', ') || '-',
            events: v.events,
          })}
        </span>
      ))}
      {!!result.remaining && <span className="block text-amber-700">{t('lawSync.remaining', { count: result.remaining })}</span>}
    </span>
  );
}

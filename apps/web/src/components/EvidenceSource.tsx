import { useI18n } from '../i18n/useI18n';
import type { EvidenceVersionSummary } from '../api/lawLinks';

/**
 * 근거 문구의 출처 버전(T-177, PAT-08 — 특허 도 3 S320). 근거 문구가 들어 있던 사내 조문 버전을 보이고, 근거 문구가 견줄 본문(연결 목록은
 * 오늘 시행 버전, 개정 후보는 기준 본문)에 없으면(hasEvidence === false) 알린다. 버전 번호가 다르다는 것만으로는 알리지 않는다(개정을 승인할
 * 때마다 문장이 그대로인 연결에도 뜬다). 본문에 있는지는 서버가 재고, 본문에서 찾은 근거만 잰다 — 출처 버전이 그 뒤 지워졌어도 재서
 * 알리고, 처음부터 본문 밖 문구(메모 인용·직접 쓴 설명)는 재지 않아(null) 알리지 않는다. 견줄 본문이 없으면(시행 중인 버전 없음 — 초안뿐이거나
 * 폐지) 알리지 않는다.
 *
 * - `source` 가 undefined 면 아무것도 그리지 않는다 — 출처를 남기기 전(T-177 이전)에 만든 후보라 모른다
 * - null 이면 "출처 버전 없음" — 어느 버전 본문에서도 찾지 못했거나, 출처였던 버전이 지워졌다
 */
export default function EvidenceSource({
  source,
  target,
  against = 'current',
}: {
  source: EvidenceVersionSummary | null | undefined;
  /** 견줄 본문의 버전 번호와, 근거 문구가 그 본문에 있는가 */
  target: { versionNum: number; hasEvidence?: boolean | null } | null | undefined;
  against?: 'current' | 'base';
}) {
  const { t } = useI18n();
  if (source === undefined) return null;
  const missingFrom = target && target.hasEvidence === false ? target : null;
  const date = source?.effectiveDate ? source.effectiveDate.slice(0, 10) : null;
  const state = source && (source.status === 'draft' || source.status === 'review') ? t(`evidenceSource.${source.status}`) : null;
  return (
    <p className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-1 flex-wrap" data-testid="evidence-source">
      {source ? (
        <span title={t('evidenceSource.title', { num: source.versionNum })}>
          {t('evidenceSource.label', { num: source.versionNum })}
          {state && ` (${state})`}
          {date && ` · ${t('evidenceSource.effective', { date })}`}
        </span>
      ) : (
        <span className="text-gray-400" title={t('evidenceSource.notFoundTitle')}>
          {t('evidenceSource.notFound')}
        </span>
      )}
      {missingFrom && (
        <span
          className="px-1 py-px rounded border bg-amber-50 text-amber-800 border-amber-200"
          title={t(`evidenceSource.missing.${against}Title`, { other: missingFrom.versionNum })}
          data-testid="evidence-source-missing"
        >
          {t(`evidenceSource.missing.${against}`, { other: missingFrom.versionNum })}
        </span>
      )}
    </p>
  );
}

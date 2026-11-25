import { useI18n } from '../i18n/useI18n';
import { lawVersionWithType } from '../lib/lawVersionLabel';

type Version = { lawType: string | null; promulgationNo: string | null; revisionType?: string | null } | null | undefined;

/**
 * 법제처 개정 이유(T-152) — 이 변경을 만든 판의 제개정이유를 기본 접힘으로 보인다. 판 전체(법령 전체)의 이유라 조문의 이유로 읽히지
 * 않게 보조 문구를 단다. 판 기록이 없거나 법제처가 이유를 주지 않았으면 그리지 않는다. 글은 텍스트 노드로만 보인다(HTML 로 해석하지 않는다).
 * 법령 변경의 펼친 행(LawImpactPanel)과 개정 후보 상세가 같이 쓴다 — 후보 상세의 2단 요약(T-160)도 이것을 둔다
 */
export default function LawRevisionReason({ version, reason }: { version?: Version; reason?: string | null }) {
  const { t } = useI18n();
  if (!reason) return null;
  const label = lawVersionWithType(version, t);
  return (
    <details className="text-xs" data-testid="law-revision-reason">
      <summary className="cursor-pointer text-gray-600">
        {t('lawRevision.title')}
        {label && <span className="ml-1 text-gray-500">({label})</span>}
      </summary>
      <p className="mt-1 text-[11px] text-gray-500">{t('lawRevision.hint')}</p>
      <p className="mt-1 whitespace-pre-wrap break-words rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-gray-700">{reason}</p>
    </details>
  );
}

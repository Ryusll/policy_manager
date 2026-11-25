import { Link } from 'react-router-dom';
import type { AuditLink, AuditLogDetail, AuditLogRow } from '../api/auditLogs';
import { useI18n } from '../i18n/useI18n';
import { auditActionLabel } from '../lib/auditLabels';
import { CORRECTION_ACTIONS, auditEntityHref } from '../lib/auditCorrection';

/**
 * 감사 로그의 정정 사슬(T-178, PAT-21 — 특허 도 12). 원 기록은 그대로 두고 정정은 후속 기록이라, 상세에서 양쪽을 잇는다 — 이 기록이 정정한
 * 원 기록, 이 기록을 정정한 기록(정정 사유와 함께). 원 기록과 정정 기록은 대상이 다를 수 있어(후보 승인 ↔ 버전 철회) 고리마다 그 대상의
 * 기록으로 가는 길을 둔다.
 */

function LinkLine({ link, reason }: { link: AuditLink; reason?: string | null }) {
  const { t } = useI18n();
  return (
    <li className="text-xs text-gray-700">
      <b>{auditActionLabel(link.action)}</b> · {new Date(link.createdAt).toLocaleString('ko-KR')} ·{' '}
      {link.user ? `${link.user.name} (${link.user.email})` : t('auditCorrection.system')}
      {reason && <span className="block text-gray-600 whitespace-pre-wrap">{t('auditCorrection.reason', { reason })}</span>}
      {link.entityId && (
        <Link to={auditEntityHref(link.entityType, link.entityId)} className="ml-1 text-navy-700 hover:underline">
          {t('auditCorrection.showEntity')}
        </Link>
      )}
    </li>
  );
}

export function AuditCorrectionChain({ data }: { data: AuditLogDetail }) {
  const { t } = useI18n();
  const isCorrection = CORRECTION_ACTIONS.has(data.action);
  if (!isCorrection && !data.corrects && data.correctedBy.length === 0) return null;
  return (
    <div className="mb-2 space-y-1.5" data-testid="audit-correction-chain">
      {data.corrects ? (
        <div>
          <p className="text-[11px] font-semibold text-gray-600">{t('auditCorrection.corrects')}</p>
          <ul>
            <LinkLine link={data.corrects} />
          </ul>
        </div>
      ) : (
        isCorrection && (
          <p className="text-[11px] text-gray-500">
            {t(data.action === 'version.withdraw' ? 'auditCorrection.noOriginal.withdraw' : 'auditCorrection.noOriginal.rejectCorrect')}
          </p>
        )
      )}
      {data.correctedBy.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-sky-800">{t('auditCorrection.correctedBy')}</p>
          <ul className="space-y-1">
            {data.correctedBy.map((c) => (
              <LinkLine key={c.id} link={c} reason={c.reason} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 목록 줄의 "정정"(이 기록이 정정 기록)·"정정됨"(이 기록을 정정한 기록이 있다) 표시 */
export function AuditCorrectionBadges({ row }: { row: AuditLogRow }) {
  const { t } = useI18n();
  return (
    <>
      {CORRECTION_ACTIONS.has(row.action) && (
        <span className="text-[11px] text-sky-800 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5">{t('auditCorrection.badge.correction')}</span>
      )}
      {row.correctedCount > 0 && (
        <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5" data-testid="audit-corrected-badge">
          {t('auditCorrection.badge.corrected', { count: row.correctedCount })}
        </span>
      )}
    </>
  );
}

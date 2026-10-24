import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { amendmentsApi, type AmendmentDetail } from '../api/amendments';
import { useI18n } from '../i18n/useI18n';
import { apiErrorMessage } from '../lib/apiError';
import { formatArticleAnchor } from '../lib/articleAnchor';
import { toast } from '../stores/toastStore';

/**
 * 개정 후보 정정(T-178, PAT-21 — 특허 도 12). 반려나 승인을 지우지 않고 정정을 새 기록으로 쌓는다 — 원 반려 사유·이력은 그대로 보이고,
 * 정정은 "정정"으로 따로 보인다.
 */

/** 이 후보로 발행한 버전으로 가는 길 — 그 버전 때문에 정정·승인이 막혔을 때 */
export function IssuedSourceLink({ data }: { data: AmendmentDetail }) {
  const { t } = useI18n();
  return (
    <Link to={`/policies/${data.policy.id}#${formatArticleAnchor(data.article)}`} className="underline">
      {t('amendmentCorrection.blockedLink')}
    </Link>
  );
}

/**
 * 반려 정정(관리자) — 본문을 바꾸지 않고 반려를 되돌려 작성 상태로. 사유 필수. 이 후보로 발행한 버전이 이미 있으면(T-178 전 철회 초안을
 * 일반 승인으로 다시 발행) 다시 열어도 다시 승인할 수 없어 정정 대신 그 까닭과 그 버전으로 가는 길을 보인다 — 손질 칸도 함께 숨기므로 이
 * 안내는 역할과 관계없이(편집자에게도) 보인다(서버는 반려 정정·손질 모두 409)
 */
export function RejectionCorrectionPanel({ data, canCorrect }: { data: AmendmentDetail; canCorrect: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['amendment', data.id] });
    qc.invalidateQueries({ queryKey: ['amendments'] });
  };
  const correct = useMutation({
    mutationFn: () => amendmentsApi.correctRejection(data.id, { reason, expectedRevision: data.revision, expectedLockVersion: data.lockVersion }),
    onSuccess: () => {
      setReason('');
      refresh();
      toast(t('amendmentCorrection.done'), 'success');
    },
    onError: (err: unknown) => {
      if ((err as { response?: { status?: number } } | null)?.response?.status === 409) refresh();
      toast(apiErrorMessage(err, t('amendmentCorrection.failed')), 'error');
    },
  });

  if (data.resultVersion) {
    return (
      <section className="card p-3 space-y-1.5 text-xs text-gray-700" aria-labelledby="reject-correct-title" data-testid="rejection-correction-blocked">
        <h2 id="reject-correct-title" className="text-sm font-semibold text-gray-800">
          {t('amendmentCorrection.panelTitle')}
        </h2>
        <p>{t('amendmentCorrection.blocked', { num: data.resultVersion.versionNum })}</p>
        <IssuedSourceLink data={data} />
      </section>
    );
  }
  if (!canCorrect) return null;
  return (
    <section className="card p-3 space-y-2" aria-labelledby="reject-correct-title" data-testid="rejection-correction">
      <h2 id="reject-correct-title" className="text-sm font-semibold text-gray-800">
        {t('amendmentCorrection.panelTitle')}
      </h2>
      <p className="text-xs text-gray-600">{t('amendmentCorrection.panelHelp')}</p>
      <label htmlFor="reject-correct-reason" className="block text-xs text-gray-600">
        {t('amendmentCorrection.reasonLabel')}
      </label>
      <textarea
        id="reject-correct-reason"
        className="input text-sm"
        rows={2}
        maxLength={1000}
        placeholder={t('amendmentCorrection.reasonPlaceholder')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button type="button" className="btn-secondary text-xs" disabled={!reason.trim() || correct.isPending} onClick={() => correct.mutate()}>
        {correct.isPending ? t('amendmentCorrection.submitting') : t('amendmentCorrection.submit')}
      </button>
    </section>
  );
}

/** 마지막 결정 뒤의 정정 — 반려 정정이면 원래 반려 사유도 함께 */
export function CorrectionNotice({ data }: { data: AmendmentDetail }) {
  const { t } = useI18n();
  const c = data.correction;
  if (!c || data.reviewState === 'approved' || data.reviewState === 'rejected') return null;
  return (
    <div className="rounded border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900" data-testid="amendment-correction">
      <b>{t(`amendmentCorrection.notice.${c.kind}`)}</b> ·{' '}
      {t('amendmentCorrection.notice.meta', { name: c.by?.name ?? t('amendmentCorrection.unknown'), at: new Date(c.at).toLocaleString('ko-KR') })}
      {c.reason && <span className="block text-xs mt-0.5 whitespace-pre-wrap">{t('amendmentCorrection.notice.reason', { reason: c.reason })}</span>}
      {c.kind === 'reject' && data.decision?.state === 'rejected' && data.decision.reason && (
        <span className="block text-xs mt-0.5 whitespace-pre-wrap text-sky-800">
          {t('amendmentCorrection.notice.originalReject', { reason: data.decision.reason })}
        </span>
      )}
      {data.reviewState === 'draft' && <span className="block text-xs mt-0.5">{t('amendmentCorrection.notice.next')}</span>}
    </div>
  );
}

/** 이력의 정정 전환 이름 — "정정" 표시와 함께. 승인 → 반려는 T-178 전 철회가 남긴 옛 기록이다 */
export function CorrectionHistoryLabel({ fromState, toState }: { fromState: string; toState: string }) {
  const { t } = useI18n();
  const key =
    fromState === 'approved'
      ? toState === 'rejected'
        ? 'amendmentCorrection.history.withdrawLegacy'
        : 'amendmentCorrection.history.withdraw'
      : 'amendmentCorrection.history.reject';
  return (
    <>
      <span className="mr-1 rounded border border-sky-300 bg-sky-50 px-1 text-[10px] text-sky-800" data-testid="history-correction-tag">
        {t('amendmentCorrection.history.tag')}
      </span>
      {t(key)}
    </>
  );
}

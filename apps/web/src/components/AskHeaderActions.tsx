import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { askApi, type AiQaNotice, type AskStatus } from '../api/ask';
import { toast } from '../stores/toastStore';
import { AskConsentDialog } from './AskNotice';
import { useI18n } from '../i18n/useI18n';
import { ASK_STATUS_KEY } from '../hooks/useAskStatus';
import { serverMessage } from '../lib/apiError';

/**
 * 규정 질문 머리의 이번 달 사용량과 회사 관리자의 켜기·끄기(T-130·T-146).
 * 켤 때는 외부 전송 고지 확인 창을 거친다 — 창을 연 순간의 고지를 고정해 그 판으로 보내고, 그사이 판이 바뀌면 서버가
 * 거절해 창을 닫는다(확인란도 풀린다). 끄기는 확인 없이. 바뀐 고지에 동의하지 않을 수도 있어 다시 확인을 기다리는 회사도 끈다.
 */
export function AskHeaderActions({ status, isAdmin }: { status: AskStatus; isAdmin: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [consentNotice, setConsentNotice] = useState<AiQaNotice | null>(null);

  const toggleMutation = useMutation({
    mutationFn: (v: { enabled: boolean; noticeVersion?: number }) => askApi.setEnabled(v.enabled, v.noticeVersion),
    onSuccess: (s) => {
      setConsentNotice(null);
      qc.setQueryData(ASK_STATUS_KEY, s);
      void qc.invalidateQueries({ queryKey: ASK_STATUS_KEY });
      toast(s.enabled ? t('ask.toggle.doneOn') : t('ask.toggle.doneOff'), 'success');
    },
    onError: (e) => {
      setConsentNotice(null);
      void qc.invalidateQueries({ queryKey: ASK_STATUS_KEY });
      toast(serverMessage(e) ?? t('ask.error.generic'), 'error');
    },
  });

  // 확인 창은 겹창이라 자리를 차지하지 않는다 — 머리 줄의 작은 글씨·회색을 물려받지 않게 그 줄 밖에 둔다
  return (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span data-testid="ask-usage">
          {t('ask.usage', { used: status.used, limit: status.limit, userUsed: status.userUsed, userLimit: status.userLimit })}
        </span>
        {isAdmin && (
          <button
            type="button"
            className="btn-secondary text-xs px-2.5 py-1"
            disabled={toggleMutation.isPending}
            onClick={() => (status.enabled ? toggleMutation.mutate({ enabled: false }) : setConsentNotice(status.notice))}
          >
            {status.enabled ? t('ask.toggle.off') : status.needsConsent ? t('ask.toggle.reconsent') : t('ask.toggle.on')}
          </button>
        )}
        {isAdmin && status.needsConsent && (
          <button
            type="button"
            className="btn-secondary text-xs px-2.5 py-1"
            disabled={toggleMutation.isPending}
            onClick={() => toggleMutation.mutate({ enabled: false })}
          >
            {t('ask.toggle.offStale')}
          </button>
        )}
      </div>
      {consentNotice && (
        <AskConsentDialog
          key={consentNotice.version}
          notice={consentNotice}
          pending={toggleMutation.isPending}
          onConfirm={() => toggleMutation.mutate({ enabled: true, noticeVersion: consentNotice.version })}
          onCancel={() => setConsentNotice(null)}
        />
      )}
    </>
  );
}

import { AlertTriangle } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { apiErrorMessage } from '../lib/apiError';
import type { PolicyLimit } from '../lib/policyLimit';

/**
 * 플랜 규정 상한 안내 — 등록 창·PDF 가져오기를 열 때(자리가 다 찼으면), 저장이 상한에 막혔을 때 같은 문구로 보인다.
 * 고객사는 요금제를 바꿀 수 없어(T-125) 아스트룸 문의로 안내한다.
 */
export function PolicyLimitNotice({ limit, reparseHint = false }: { limit: PolicyLimit; reparseHint?: boolean }) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      data-testid="policy-limit-notice"
      className="flex gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded px-3 py-2"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="leading-relaxed">
        <p className="font-medium">{t('policyLimit.title')}</p>
        <p>{t('policyLimit.body', { plan: t(`plan.name.${limit.plan}`), max: limit.max, used: limit.used })}</p>
        {reparseHint && <p className="text-amber-800">{t('policyLimit.reparseHint')}</p>}
      </div>
    </div>
  );
}

/**
 * 상한이 아닌 저장 실패(409·500 …) — 버튼 곁에 남는다(토스트는 몇 초 뒤 사라져 "눌러도 아무 일이 없다"로 보였다, T-198).
 * 상한 실패는 `limitFeedback` 이 가른 대로 `PolicyLimitNotice` 로 보인다 — 여기에는 `otherError` 만 넘긴다.
 */
export function PolicySaveError({ error, fallback }: { error: unknown; fallback: string }) {
  return (
    <div role="alert" className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded">
      {apiErrorMessage(error, fallback)}
    </div>
  );
}

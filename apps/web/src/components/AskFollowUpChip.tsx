import { CornerDownRight, X } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';

/**
 * 이어서 묻기(T-220, SRS SEARCH-12) — 입력 카드 위의 칩. 다음 질문은 이 앞 질문의 답에 이어 묻는다(그 답의 근거 조문을
 * 이어받는다). ✕ 로 잇기를 끊는다 — 보내는 동안에는 잠근다. 앞 질문·답의 글은 다시 보내지 않는다.
 */
export function AskFollowUpChip({ question, onClear, disabled = false }: { question: string; onClear: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div
      className="flex w-fit max-w-full items-center gap-1.5 rounded-full border border-navy-200 bg-navy-50 px-3 py-1 text-xs text-navy-800"
      data-testid="ask-follow-up"
    >
      <CornerDownRight size={12} className="shrink-0" />
      <span className="truncate" title={question}>
        {t('ask.followUp.chip', { question })}
      </span>
      <button
        type="button"
        className="shrink-0 rounded p-0.5 text-navy-600 hover:bg-navy-100 hover:text-navy-900 disabled:opacity-40"
        aria-label={t('ask.followUp.clear')}
        title={t('ask.followUp.clear')}
        onClick={onClear}
        disabled={disabled}
        data-testid="ask-follow-up-clear"
      >
        <X size={12} />
      </button>
    </div>
  );
}

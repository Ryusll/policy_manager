import { useI18n } from '../i18n/useI18n';

/**
 * 승인 카드의 개정 사유 칸(T-161, SRS LAW-21) — '사유 초안 넣기'(버튼 방식, 미리 채우지 않는다)가 서버가 만든 사실 문장을 채운다.
 * 초안은 법령 제명·공포번호·공포일·시행일과 바뀐 글자만 담는다 — 읽고 고쳐서 승인하고, 고치지 않고 승인했는지는 승인 기록에 남는다.
 * 사유는 발행 버전의 개정 사유·승인 감사·알림·개정안 문서에 그대로 쓰이므로 긴 문장도 다 보이게 여러 줄 칸으로 둔다
 */
export default function ApproveNoteField({ value, onChange, draft }: { value: string; onChange: (v: string) => void; draft?: string | null }) {
  const { t } = useI18n();
  return (
    <div className="sm:col-span-2">
      <label htmlFor="approve-note" className="block text-xs text-gray-600 mb-1">
        {t('approveNote.label')} <span className="text-red-600">*</span>
      </label>
      <textarea
        id="approve-note"
        className="input min-h-[4.5rem]"
        rows={3}
        maxLength={500}
        aria-describedby="approve-note-hint"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <button
          type="button"
          className="text-[11px] text-navy-700 hover:underline disabled:text-gray-400 disabled:no-underline"
          disabled={!draft}
          onClick={() => draft && onChange(draft)}
        >
          {t('approveNote.draft')}
        </button>
        <span id="approve-note-hint" className="text-[11px] text-gray-500">
          {t('approveNote.hint')}
        </span>
      </div>
    </div>
  );
}

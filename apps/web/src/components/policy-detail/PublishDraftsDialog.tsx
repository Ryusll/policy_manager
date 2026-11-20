import { useI18n } from '../../i18n/useI18n';

export type PublishDraftsForm = { changeNote: string; effectiveDate: string };

/**
 * 시행 전 초안 한꺼번에 시행 창(규정 상세, 관리자). T-215 9차 검토로 페이지에서 떼어 문구를 messages 키로 옮겼다 — 실패 문구(error)는
 * 창 밖 알림과 같은 글을 페이지가 넘긴다. 시행하는 동안(busy)은 '시행'을 다시 누를 수 없다.
 */
export function PublishDraftsDialog(p: {
  count: number;
  form: PublishDraftsForm;
  onChange: (next: PublishDraftsForm) => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-gray-300 shadow-xl w-full max-w-md" role="dialog" aria-labelledby="publish-drafts-title">
        <div id="publish-drafts-title" className="bg-navy-800 text-white px-5 py-3 font-medium text-sm">
          {t('policyDetail.publishDrafts.title')}
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-600 leading-relaxed">
            {t('policyDetail.publishDrafts.descBefore')}
            <strong>{t('policyDetail.publishDrafts.count', { n: p.count })}</strong>
            {t('policyDetail.publishDrafts.descAfter')}
          </p>
          <label className="block text-xs font-medium text-gray-600">
            {t('policyDetail.publishDrafts.note')}
            <input
              className="input mt-1.5"
              value={p.form.changeNote}
              onChange={(e) => p.onChange({ ...p.form, changeNote: e.target.value })}
              placeholder={t('policyDetail.publishDrafts.notePlaceholder')}
            />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            {t('policyDetail.publishDrafts.date')}
            <input type="date" className="input mt-1.5" value={p.form.effectiveDate} onChange={(e) => p.onChange({ ...p.form, effectiveDate: e.target.value })} />
            <span className="block mt-1 text-[11px] font-normal text-gray-500">{t('policyDetail.publishDrafts.dateHint')}</span>
          </label>
          {p.error && (
            <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
              {p.error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={!p.form.changeNote.trim() || !p.form.effectiveDate || p.busy} onClick={p.onSubmit}>
              {p.busy ? t('policyDetail.publishDrafts.busy') : t('policyDetail.publishDrafts.submit', { n: p.count })}
            </button>
            <button type="button" className="btn-secondary" onClick={p.onCancel}>
              {t('policyDetail.publishDrafts.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

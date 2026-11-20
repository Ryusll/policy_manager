import { useI18n } from '../../i18n/useI18n';

/**
 * 시행중 ↔ 비활성 확인 창(T-15). T-215 10차 검토로 페이지에서 떼어 문구를 키로 옮겼다 — 진행(busy)·실패(error)는 페이지가 이 규정의
 * 것만 넘긴다(앞 규정의 진행·실패가 다른 규정의 창에 보이지 않게).
 *
 * `isActive` 는 표시 전용이다 — 검색에서 빠지지도, 목록에서 사라지지도 않는다(폐지된 규정도 찾을 수 있어야 한다). 사용자는
 * "비활성"을 "안 보이게 됨"으로 읽기 쉬워서, 무엇이 바뀌고 무엇이 안 바뀌는지 적어 둔다.
 */
export function ActiveToggleDialog(p: { next: boolean; title: string; busy: boolean; error: string | null; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-gray-300 shadow-xl w-full max-w-md" role="dialog" aria-labelledby="active-toggle-title">
        <div id="active-toggle-title" className="bg-navy-800 text-white px-5 py-3 font-medium text-sm">
          {t(p.next ? 'policyDetail.status.titleActive' : 'policyDetail.status.titleInactive')}
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-700">
            {t('policyDetail.status.askBefore', { title: p.title })}
            <strong>{t(p.next ? 'policyDetail.status.active' : 'policyDetail.status.inactive')}</strong>
            {t('policyDetail.status.askAfter')}
          </p>
          <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-xs text-gray-700 space-y-1">
            <p>
              <strong>{t('policyDetail.status.changes')}</strong>
              {t('policyDetail.status.changesText')}
            </p>
            <p>
              <strong>{t('policyDetail.status.unchanged')}</strong>
              {t('policyDetail.status.unchangedText')}
              <strong>{t('policyDetail.status.unchangedSearch')}</strong>
              {t('policyDetail.status.unchangedWhy')}
            </p>
          </div>
          {p.error && (
            <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              {p.error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={p.onConfirm} disabled={p.busy} className="btn-primary">
              {p.busy ? t('policyDetail.status.busy') : t('policyDetail.status.confirm')}
            </button>
            <button type="button" onClick={p.onCancel} className="btn-secondary">
              {t('policyDetail.status.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

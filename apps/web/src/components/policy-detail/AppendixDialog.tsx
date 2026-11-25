import { useI18n } from '../../i18n/useI18n';
import { APPENDIX_BODY_MAX, APPENDIX_TITLE_MAX, type AppendixDraft, type AppendixKind } from './appendixDraft';
import { LengthCap } from './LengthCap';
import { Failure, Frame } from './VersionDialogs';

/*
 * 부칙·별표·서식 추가·수정 창(T-224 단계 C, 설계 E12·E14). 페이지에서 떼어 문구를 키로 옮겼다. 입력값은 페이지가 들고, 진행(busy — 이
 * 창의 저장이 도는 중)·막힘(locked — 이 규정의 다른 부칙·별표·서식 쓰기가 도는 중)·실패(error — 이 창에서 보낸 저장의 거절)는 이
 * 규정의 것만 넘긴다. 진행 중에도 취소로 닫을 수 있다 — 그 뒤 결과는 도구 줄·이름 붙은 알림으로 간다(lib/policyWrite).
 */

export function AppendixDialog(p: {
  mode: 'create' | 'edit';
  draft: AppendixDraft;
  onDraft: (update: (d: AppendixDraft) => AppendixDraft) => void;
  kindLabel: Record<AppendixKind, string>;
  busy: boolean;
  locked: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <Frame wide id="appendix-dialog-title" title={t(p.mode === 'create' ? 'bodyWrites.appendix.dialogCreate' : 'bodyWrites.appendix.dialogEdit')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5" htmlFor="appendix-kind">
            {t('bodyWrites.appendix.kind')}
          </label>
          <select
            id="appendix-kind"
            className="input text-sm"
            value={p.draft.kind}
            onChange={(e) => {
              const kind = e.target.value as AppendixKind;
              p.onDraft((d) => ({ ...d, kind }));
            }}
          >
            <option value="supplementary">{p.kindLabel.supplementary}</option>
            <option value="annex">{p.kindLabel.annex}</option>
            <option value="form">{p.kindLabel.form}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5" htmlFor="appendix-sort">
            {t('bodyWrites.appendix.sortOrder')}
          </label>
          <input
            id="appendix-sort"
            type="number"
            className="input text-sm"
            min={0}
            placeholder={t('bodyWrites.appendix.sortOrderPlaceholder')}
            value={p.draft.sortOrder}
            onChange={(e) => {
              const sortOrder = e.target.value;
              p.onDraft((d) => ({ ...d, sortOrder }));
            }}
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5" htmlFor="appendix-title">
          {t('bodyWrites.appendix.title')}
        </label>
        <input
          id="appendix-title"
          className="input text-sm"
          placeholder={t('bodyWrites.appendix.titlePlaceholder')}
          maxLength={APPENDIX_TITLE_MAX}
          value={p.draft.title}
          onChange={(e) => {
            const title = e.target.value;
            p.onDraft((d) => ({ ...d, title }));
          }}
        />
        <LengthCap value={p.draft.title} max={APPENDIX_TITLE_MAX} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5" htmlFor="appendix-body">
          {t('bodyWrites.appendix.body')}
        </label>
        <textarea
          id="appendix-body"
          className="input text-sm font-mono resize-y min-h-[200px]"
          placeholder={t('bodyWrites.appendix.bodyPlaceholder')}
          maxLength={APPENDIX_BODY_MAX}
          value={p.draft.body}
          onChange={(e) => {
            const body = e.target.value;
            p.onDraft((d) => ({ ...d, body }));
          }}
        />
        <LengthCap value={p.draft.body} max={APPENDIX_BODY_MAX} />
      </div>
      <Failure error={p.error} />
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={!p.draft.title.trim() || p.busy || p.locked} onClick={p.onConfirm}>
          {p.busy ? t('versionDialog.busy') : t('bodyWrites.appendix.save')}
        </button>
        <button type="button" className="btn-secondary" onClick={p.onCancel}>
          {t('versionDialog.cancel')}
        </button>
      </div>
    </Frame>
  );
}

import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { useI18n } from '../../i18n/useI18n';

export type RevisionNotify = { enabled: boolean; groupIds: string[]; userIds: string[] };

type Props = {
  isActive: boolean;
  /** 시행 상태 전환 — 확인 창을 연다(바뀌는 것·안 바뀌는 것을 그 창이 알린다) */
  onRequestToggleActive: () => void;
  revisionDate: string;
  onRevisionDate: (v: string) => void;
  effectiveDate: string;
  onEffectiveDate: (v: string) => void;
  saving: boolean;
  onSave: () => void;
  /** 저장·상태 전환 결과 문구 — 접혀 있어도 보인다 */
  message: string | null;
  notify: RevisionNotify;
  onNotify: (update: (prev: RevisionNotify) => RevisionNotify) => void;
  groups: { id: string; name: string; members: unknown[] }[];
  users: { id: string; name: string; email: string }[];
};

/**
 * 규정 정보 편집(T-215, SRS POLICY-13 ④) — 관리자·편집자의 시행 상태 전환·개정일·시행일·알림 발송·저장을 하나로 접는다.
 * 처음에는 접혀 있다. 입력 값은 부르는 쪽(PolicyDetailPage)이 가지고 있어 접었다 펴도 저장하지 않은 편집이 남는다.
 * 저장·상태 전환 결과 문구는 접힌 상태에서도 버튼 옆에 보인다(확인 창에서 상태를 바꾼 뒤에도 알림이 보이게).
 */
export default function PolicyInfoEdit(p: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const setChecked = (field: 'groupIds' | 'userIds', id: string, on: boolean) =>
    p.onNotify((prev) => ({ ...prev, [field]: on ? [...prev[field], id] : prev[field].filter((x) => x !== id) }));

  return (
    <div className="mt-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded border border-navy-500 bg-navy-800/80 px-2.5 py-1.5 text-navy-100 hover:bg-navy-700"
          data-testid="policy-info-edit-toggle"
        >
          {t('policyDetail.info.toggle')}
          <ChevronDown size={13} className={clsx('transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
        {/* 알림 영역은 늘 그려 두고 글만 바꾼다 — 글과 함께 생기는 영역은 화면 읽기 프로그램이 놓치기 쉽다 */}
        <span className={clsx('text-emerald-300', !p.message && 'sr-only')} role="status">
          {p.message ?? ''}
        </span>
      </div>
      {open && (
        <div id={panelId} className="mt-3 space-y-3">
          <button type="button" onClick={p.onRequestToggleActive} className="text-[11px] text-navy-300 underline underline-offset-2 hover:text-white">
            {t(p.isActive ? 'policyDetail.status.makeInactive' : 'policyDetail.status.makeActive')}
          </button>
          {/* 저장하는 동안은 날짜·알림을 바꾸지 못한다 — 저장이 끝나 다시 받을 때 그사이 고친 값이 말없이 덮였다(T-215 12차) */}
          <fieldset disabled={p.saving} className="m-0 min-w-0 space-y-3 border-0 p-0" data-testid="policy-info-fields">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-navy-300">
              {t('policyDetail.info.revisionDate')}
              <input type="date" className="input h-8 text-xs mt-0.5 bg-white text-gray-800 block" value={p.revisionDate} onChange={(e) => p.onRevisionDate(e.target.value)} />
            </label>
            <label className="text-navy-300">
              {t('policyDetail.info.effectiveDate')}
              <input type="date" className="input h-8 text-xs mt-0.5 bg-white text-gray-800 block" value={p.effectiveDate} onChange={(e) => p.onEffectiveDate(e.target.value)} />
            </label>
            <button
              type="button"
              className="rounded border border-navy-500 bg-navy-700 px-2.5 py-1.5 text-white hover:bg-navy-600 disabled:opacity-50"
              disabled={p.saving}
              onClick={p.onSave}
            >
              {t(p.saving ? 'policyDetail.info.saving' : 'policyDetail.info.save')}
            </button>
          </div>
          <div className="rounded-lg border border-navy-600 bg-navy-950/50 p-3 space-y-2">
            <label className="inline-flex items-center gap-2 text-navy-100 font-medium">
              <input type="checkbox" checked={p.notify.enabled} onChange={(e) => p.onNotify((prev) => ({ ...prev, enabled: e.target.checked }))} />
              {t('policyDetail.notify.enable')}
            </label>
            <p className="text-[11px] text-navy-400 leading-relaxed">{t('policyDetail.notify.help')}</p>
            {p.notify.enabled && (
              <div className="grid gap-3 sm:grid-cols-2 pt-1">
                <div>
                  <div className="text-[11px] text-navy-300 mb-1.5 font-semibold">{t('policyDetail.notify.groups')}</div>
                  {p.groups.length === 0 ? (
                    <p className="text-[11px] text-navy-500">
                      {t('policyDetail.notify.noGroups')}{' '}
                      <Link to="/settings" className="text-gold-400 underline">
                        {t('policyDetail.notify.noGroupsLink')}
                      </Link>
                      {t('policyDetail.notify.noGroupsAfter')}
                    </p>
                  ) : (
                    <div className="space-y-1 max-h-28 overflow-y-auto">
                      {p.groups.map((g) => (
                        <label key={g.id} className="flex items-start gap-2 text-navy-200 cursor-pointer">
                          <input type="checkbox" className="mt-0.5" checked={p.notify.groupIds.includes(g.id)} onChange={(e) => setChecked('groupIds', g.id, e.target.checked)} />
                          <span>
                            {g.name}
                            <span className="text-navy-500 ml-1">{t('policyDetail.notify.members', { n: g.members.length })}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[11px] text-navy-300 mb-1.5 font-semibold">{t('policyDetail.notify.users')}</div>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {p.users.map((u) => (
                      <label key={u.id} className="flex items-start gap-2 text-navy-200 cursor-pointer">
                        <input type="checkbox" className="mt-0.5" checked={p.notify.userIds.includes(u.id)} onChange={(e) => setChecked('userIds', u.id, e.target.checked)} />
                        <span>
                          {u.name}
                          <span className="text-navy-500 ml-1">{u.email}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}

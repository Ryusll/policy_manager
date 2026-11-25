import type { ReactNode } from 'react';
import { FileText, Layers } from 'lucide-react';
import { clsx } from 'clsx';
import { useI18n } from '../../i18n/useI18n';
import DropdownMenu, { type MenuItem } from '../DropdownMenu';

type Props = {
  /** 내보내기·복사·일괄 시행 등의 결과 알림 — 상태 영역에 보인다(화면 읽기 프로그램도 읽는다) */
  lawToolMsg: string | null;
  /** 그 글의 종류 — 실패는 붉은 계열로(T-227). 주지 않으면 진행·알림(초록) */
  lawToolKind?: 'info' | 'error';
  view: { mode: 'full' | 'segment'; canSegment: boolean; onChange: (mode: 'full' | 'segment') => void };
  jump: { value: string; options: { id: string; label: string }[]; onJump: (id: string) => void };
  compare: { hasDates: boolean; onOldNew: () => void; onThreeWay: () => void };
  menus: { exportLabel: string; exportItems: MenuItem[]; viewItems: MenuItem[]; moreItems: MenuItem[] };
  /** 시점 조회 줄(PolicyAsOfBar) */
  asOf: ReactNode;
  /** 음성지원·접근성 패널 — 켜져 있을 때만 */
  a11yPanel: ReactNode;
};

const TOOL = 'inline-flex items-center gap-1.5 text-xs font-medium border border-gray-300 bg-white px-2.5 py-1.5 rounded hover:bg-gray-50';
/** 메뉴 폭 — 항목 글(이유·안내 포함)이 한 줄에 들어가게, 좁은 화면에서는 화면 안에서 */
const PANEL = 'min-w-[16rem] max-w-[calc(100vw-2rem)]';

/**
 * 규정 상세 도구 줄(T-215, SRS POLICY-13) — 늘 보이는 것(보기 방식·조문 선택·신구조문대비표·3단비교, 그 아래 시점 조회)과
 * 메뉴 셋(내보내기·보기 설정·더보기, 항목은 lib/policyToolMenus). 메뉴는 T-214 의 공용 메뉴 버튼이다.
 * 음성지원 패널은 메뉴 셋 뒤에 둔다 — 보기 설정에서 켠 뒤 Tab 으로 더보기 다음에 닿는다.
 */
export default function PolicyToolbar(p: Props) {
  const { t } = useI18n();
  const modeClass = (on: boolean) =>
    clsx('inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold', on ? 'bg-navy-700 text-white' : 'bg-white text-navy-800 hover:bg-navy-50');
  return (
    <div className="bg-white border border-gray-300 shadow-sm" data-testid="policy-toolbar">
      <div className="px-3 py-2 sm:px-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Layers size={16} className="text-slate-600 flex-shrink-0" aria-hidden />
          <span className="text-xs font-semibold text-slate-800">{t('policyDetail.tools.title')}</span>
        </div>
        <span
          role="status"
          aria-live="polite"
          data-kind={p.lawToolMsg ? (p.lawToolKind ?? 'info') : undefined}
          className={clsx(
            p.lawToolMsg && 'text-[11px] border rounded px-2 py-0.5',
            p.lawToolMsg && (p.lawToolKind === 'error' ? 'text-red-700 bg-red-50 border-red-200' : 'text-emerald-800 bg-emerald-50 border-emerald-200'),
          )}
        >
          {p.lawToolMsg ?? ''}
        </span>
      </div>
      <div className="px-3 py-2 sm:px-4 flex flex-wrap items-center gap-2 border-b border-gray-100">
        <div className="inline-flex rounded border border-navy-300 overflow-hidden" role="group" aria-label={t('policyDetail.view.group')}>
          <button type="button" aria-pressed={p.view.mode === 'full'} onClick={() => p.view.onChange('full')} className={modeClass(p.view.mode === 'full')}>
            <FileText size={14} aria-hidden />
            {t('policyDetail.view.full')}
          </button>
          {p.view.canSegment ? (
            <button
              type="button"
              aria-pressed={p.view.mode === 'segment'}
              onClick={() => p.view.onChange('segment')}
              className={clsx(modeClass(p.view.mode === 'segment'), 'border-l border-navy-300')}
            >
              {t('policyDetail.view.segment')}
            </button>
          ) : (
            <span className="sr-only">{t('policyDetail.view.readOnlyNote')}</span>
          )}
        </div>
        <label className="sr-only" htmlFor="policy-article-jump">
          {t('policyDetail.jump.label')}
        </label>
        <select id="policy-article-jump" className="input text-xs max-w-[min(100%,18rem)] py-1.5" value={p.jump.value} onChange={(e) => p.jump.onJump(e.target.value)}>
          <option value="">{t('policyDetail.jump.placeholder')}</option>
          {p.jump.options.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={p.compare.onOldNew}
          disabled={!p.compare.hasDates}
          title={p.compare.hasDates ? undefined : t('policyDetail.compare.noDates')}
          className={clsx(TOOL, 'disabled:border-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed')}
        >
          {t('policyDetail.compare.oldNew')}
        </button>
        <button type="button" onClick={p.compare.onThreeWay} className={TOOL}>
          {t('policyDetail.compare.threeWay')}
        </button>
        <DropdownMenu id="policy-menu-export" label={p.menus.exportLabel} items={p.menus.exportItems} buttonClassName={TOOL} panelClassName={PANEL} />
        <DropdownMenu id="policy-menu-view" label={t('policyDetail.menu.view')} items={p.menus.viewItems} buttonClassName={TOOL} panelClassName={PANEL} />
        <DropdownMenu id="policy-menu-more" label={t('policyDetail.menu.more')} items={p.menus.moreItems} buttonClassName={TOOL} panelClassName={PANEL} align="right" />
      </div>
      {p.a11yPanel}
      {p.asOf}
    </div>
  );
}

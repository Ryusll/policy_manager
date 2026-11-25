import { useId } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, PanelLeft, PanelLeftClose } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { POLICY_TOC_PANEL_ID, backToListLink } from '../../lib/policyDetailLinks';

type Props = {
  role: string | null | undefined;
  title: string;
  viewMode: 'full' | 'segment';
  /** 목차 패널이 보이는가(열림 또는 고정) */
  tocVisible: boolean;
  onToggleToc: () => void;
};

/**
 * 규정 상세 위쪽 줄(T-215, SRS POLICY-13) — 현재 위치(목록으로 가는 링크 하나 — 열람자는 통합검색 — 와 규정 제목 · 보기 방식),
 * 목차 보이기·숨기기. 규정 상세는 Layout 의 경로 표시를 그리지 않으므로(routeSections hiddenBelow) 이 줄이 현재 위치다.
 * 연혁·부칙·별표·서식은 목차 패널의 탭이다 — 목차를 숨겼으면 그 길을 버튼 아래 글로 알린다(터치 화면에서도 보이게).
 */
export default function PolicyTopBar({ role, title, viewMode, tocVisible, onToggleToc }: Props) {
  const { t } = useI18n();
  const hintId = useId();
  const back = backToListLink(role);
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <nav className="space-y-2 min-w-0" aria-label={t('layout.breadcrumb.label')}>
        <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-navy-700 hover:underline font-medium" data-testid="policy-back-link">
          <ChevronLeft size={15} aria-hidden /> {t(back.labelKey)}
        </Link>
        <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-gray-600">
          <span className="text-gray-900 font-semibold truncate max-w-[14rem] sm:max-w-2xl" title={title} aria-current="page">
            {title}
          </span>
          <span className="text-gray-400 hidden sm:inline" aria-hidden>
            ·
          </span>
          <span className="text-gray-600 text-xs sm:text-sm">{t(viewMode === 'full' ? 'policyDetail.view.full' : 'policyDetail.view.segment')}</span>
        </p>
      </nav>
      <div className="flex flex-col items-start gap-1 shrink-0 sm:items-end">
        <button
          type="button"
          onClick={onToggleToc}
          className="btn-secondary text-xs"
          aria-expanded={tocVisible}
          // 패널이 있을 때만 가리킨다(숨기면 패널이 그려지지 않는다)
          aria-controls={tocVisible ? POLICY_TOC_PANEL_ID : undefined}
          aria-describedby={tocVisible ? undefined : hintId}
        >
          {tocVisible ? <PanelLeftClose size={15} aria-hidden /> : <PanelLeft size={15} aria-hidden />}
          {t(tocVisible ? 'policyDetail.toc.hide' : 'policyDetail.toc.show')}
        </button>
        {!tocVisible && (
          <p id={hintId} className="text-[11px] text-gray-500">
            {t('policyDetail.toc.showHint')}
          </p>
        )}
      </div>
    </div>
  );
}

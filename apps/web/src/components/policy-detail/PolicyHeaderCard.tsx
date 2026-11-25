import type { ReactNode } from 'react';
import { Paperclip } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { formatKoDate } from '../../lib/legalArticleLabel';

type Props = {
  code: string;
  title: string;
  description?: string | null;
  isActive: boolean;
  /** 관리자·편집자 — 날짜 글줄 아래에 규정 정보 편집(PolicyInfoEdit)을 받는다. 날짜 글줄은 모든 역할에게 보인다(접혀 있어도 저장된 날짜를 읽게) */
  canEdit: boolean;
  revisionDate?: string | null;
  effectiveDate?: string | null;
  filesCount: number;
  onOpenAttachments: () => void;
  infoEdit?: ReactNode;
  /** 안내 띠(시행 전 초안·시행 예정 구조 변경·시행 예정 신설 조문·시행일 채우기·재파싱 검토) — 부르는 쪽이 그린다 */
  children?: ReactNode;
};

/**
 * 규정 상세 머리 카드(T-215, SRS POLICY-13) — 코드·상태 배지·제목·설명, 저장된 개정일·시행일 글줄(SRS POLICY-11 — 모든 역할),
 * 첨부파일, 관리자·편집자의 '규정 정보 편집'(접힘), 그 아래 안내 띠. 보기 방식·적용 양식·전체화면은 도구 줄과 메뉴로 옮겼다(PolicyToolbar).
 */
export default function PolicyHeaderCard(p: Props) {
  const { t } = useI18n();
  const dates = [
    p.revisionDate ? t('policyDetail.info.revisionLine', { date: formatKoDate(p.revisionDate) }) : null,
    p.effectiveDate ? t('policyDetail.info.effectiveLine', { date: formatKoDate(p.effectiveDate) }) : null,
  ].filter(Boolean);
  return (
    <div className="shadow-sm border border-gray-300 bg-white rounded-sm overflow-hidden">
      <div className="bg-navy-900 text-white px-5 py-4 flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono text-xs bg-navy-700 px-2 py-0.5 rounded text-navy-200">{p.code}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded border ${p.isActive ? 'bg-blue-900 text-blue-200 border-blue-700' : 'bg-gray-700 text-gray-300 border-gray-600'}`}
              >
                {t(p.isActive ? 'policyDetail.status.active' : 'policyDetail.status.inactive')}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold leading-snug">{p.title}</h1>
            {p.description && <p className="text-navy-300 text-sm mt-1">{p.description}</p>}
            {dates.length > 0 && <p className="text-navy-300 text-xs mt-2">{dates.join(' · ')}</p>}
            {p.canEdit ? p.infoEdit : null}
          </div>
          <div className="flex-shrink-0">
            <button
              type="button"
              onClick={p.onOpenAttachments}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-navy-100 hover:text-white border border-navy-600 rounded-lg px-4 py-2.5 bg-navy-800/80 w-full sm:w-auto justify-center"
            >
              <Paperclip size={14} aria-hidden />
              {t('policyDetail.attachments')}
              {p.filesCount > 0 && <span className="text-navy-200">({p.filesCount})</span>}
            </button>
          </div>
        </div>
        {p.children}
      </div>
    </div>
  );
}

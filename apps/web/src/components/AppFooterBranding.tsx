import { SITE_LOCKUP } from '../config/siteBranding';
import { usePlatformBranding } from '../hooks/usePlatformBranding';

/** 하단: SaaS 운영·개발사 표기 (통합 관리자 브랜딩). 고객사 로고는 헤더(설정)만 */
export default function AppFooterBranding() {
  const { data } = usePlatformBranding();

  const developerName =
    data?.legalName?.trim() || data?.productLabel?.trim() || SITE_LOCKUP.alt;
  const reg = data?.registrationNo?.trim() || null;
  const imageSrc = data?.logoUrl || data?.lockupImageSrc || SITE_LOCKUP.imageSrc;

  return (
    <footer className="border-t border-navy-800 bg-navy-950 text-navy-400 text-[11px] px-4 py-3">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-md bg-white/95 px-2.5 py-1.5 shadow-sm ring-1 ring-white/10 flex items-center justify-center shrink-0">
            <img
              src={imageSrc}
              alt={developerName}
              className="h-7 w-auto max-w-[200px] object-contain"
              loading="lazy"
            />
          </div>
          <div className="min-w-0 text-center sm:text-left">
            <div className="text-navy-300 text-[10px] uppercase tracking-wide">Powered by</div>
            {developerName ? (
              <div className="text-navy-200 font-medium truncate mt-0.5">{developerName}</div>
            ) : null}
            {reg ? <div className="text-navy-500 mt-0.5">사업자등록번호 {reg}</div> : null}
          </div>
        </div>
      </div>
    </footer>
  );
}

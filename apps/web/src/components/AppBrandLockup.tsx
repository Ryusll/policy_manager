import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { BrandBadge, type BrandBadgePreview } from './BrandBadge';
import { useBrandStore } from '../stores/brandStore';
import { useI18n } from '../i18n/useI18n';

type Variant = 'app' | 'login';

/** 설정(테넌트) 회사 로고 + 서비스명. 플랫폼(개발사) 로고와 분리 */
export function AppBrandLockup({
  variant = 'app',
  preview,
}: {
  variant?: Variant;
  /** 설정 화면 저장 전 미리보기 */
  preview?: BrandBadgePreview;
}) {
  const { t } = useI18n();
  const storeLogo = useBrandStore((s) => s.brandLogoDataUrl);
  const storeW = useBrandStore((s) => s.brandLogoWidth);
  const storeH = useBrandStore((s) => s.brandLogoHeight);
  const tenantLogo = preview ? preview.logo : storeLogo;
  const logoW = preview ? preview.w : storeW;
  const logoH = preview ? preview.h : storeH;

  const isLogin = variant === 'login';
  const logoBoxClass = isLogin
    ? 'px-3 py-2 rounded-lg'
    : 'px-2.5 py-1.5 rounded-md';
  const logoMaxH = isLogin ? 44 : 38;
  const logoMaxW = isLogin ? 200 : 140;

  const body = (
    <>
      <div
        className={clsx(
          logoBoxClass,
          'flex items-center justify-center flex-shrink-0',
          'bg-white shadow-sm ring-1 ring-black/5',
        )}
      >
        {tenantLogo ? (
          <img
            src={tenantLogo}
            alt=""
            className="object-contain object-center"
            style={{
              width: Math.min(logoW, logoMaxW),
              height: Math.min(logoH, logoMaxH),
              maxWidth: logoMaxW,
              maxHeight: logoMaxH,
            }}
            loading="eager"
            decoding="async"
          />
        ) : (
          <BrandBadge variant={isLogin ? 'login' : 'header'} preview={preview} />
        )}
      </div>
      <div
        className={clsx(
          'min-w-0 flex flex-col justify-center border-l border-white/25',
          isLogin ? 'pl-3 sm:pl-4' : 'pl-2.5 sm:pl-3 hidden sm:flex',
        )}
      >
        <span
          className={clsx(
            'font-semibold text-white tracking-tight leading-tight whitespace-nowrap',
            isLogin ? 'text-base sm:text-lg' : 'text-sm',
          )}
        >
          {t('layout.productTitle')}
        </span>
      </div>
      {/* 모바일: 서비스명만 짧게 */}
      <span
        className={clsx(
          'sm:hidden font-semibold text-white text-sm truncate max-w-[8rem]',
          isLogin && 'text-base max-w-[12rem]',
        )}
      >
        {t('layout.productTitle')}
      </span>
    </>
  );

  const className = clsx(
    'flex items-center gap-2.5 sm:gap-3 min-w-0 shrink',
    !preview && 'hover:opacity-95 transition-opacity',
    isLogin && 'gap-3',
  );

  if (preview) {
    return <div className={className}>{body}</div>;
  }

  return (
    <Link to="/" className={className}>
      {body}
    </Link>
  );
}

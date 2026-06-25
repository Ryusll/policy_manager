import { clsx } from 'clsx';
import { useBrandStore, displayBrandMark, DEFAULT_LOGO_WIDTH, DEFAULT_LOGO_HEIGHT } from '../stores/brandStore';

type Variant = 'header' | 'login';

/** 설정 화면 등: 저장 전 미리보기용(미지정 시 스토어 값 사용) */
export type BrandBadgePreview = {
  mark: string;
  logo: string | null;
  w: number;
  h: number;
};

export function BrandBadge({ variant = 'header', preview }: { variant?: Variant; preview?: BrandBadgePreview }) {
  const storeMark = useBrandStore((s) => s.brandMark);
  const storeLogo = useBrandStore((s) => s.brandLogoDataUrl);
  const storeW = useBrandStore((s) => s.brandLogoWidth ?? DEFAULT_LOGO_WIDTH);
  const storeH = useBrandStore((s) => s.brandLogoHeight ?? DEFAULT_LOGO_HEIGHT);

  const brandMark = preview ? preview.mark : storeMark;
  const logo = preview ? preview.logo : storeLogo;
  const logoW = preview ? preview.w : storeW;
  const logoH = preview ? preview.h : storeH;

  if (logo) {
    return (
      <div
        className={clsx(
          'flex items-center justify-center overflow-hidden rounded flex-shrink-0 border border-white/15 bg-white/10',
        )}
        style={{ width: logoW, height: logoH }}
      >
        <img src={logo} alt="" className="max-h-full max-w-full object-contain p-0.5" />
      </div>
    );
  }

  const dim = variant === 'login' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-[11px]';
  return (
    <div
      className={clsx(
        dim,
        'flex items-center justify-center overflow-hidden rounded bg-gold-500 px-0.5 font-bold leading-tight text-white',
      )}
    >
      {displayBrandMark(brandMark)}
    </div>
  );
}

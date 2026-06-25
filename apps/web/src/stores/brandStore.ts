import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 헤더 왼쪽 배지에 표시할 문자(최대 2자). 로고 미사용 시 기본값 */
export const DEFAULT_BRAND_MARK = '베';

export const DEFAULT_LOGO_WIDTH = 32;
export const DEFAULT_LOGO_HEIGHT = 32;
export const MAX_LOGO_BYTES = 220_000;
export const LOGO_SIZE_MIN = 16;
export const LOGO_SIZE_MAX = 96;
export const MAX_LOGO_DATA_URL_LEN = 350_000;

interface BrandState {
  brandMark: string;
  brandLogoDataUrl: string | null;
  brandLogoWidth: number;
  brandLogoHeight: number;
  setBrandMark: (value: string) => void;
  setBrandLogoDataUrl: (value: string | null) => void;
  setBrandLogoSize: (width: number, height: number) => void;
  resetBrandMark: () => void;
  resetAll: () => void;
}

function clampSize(n: number): number {
  return Math.min(LOGO_SIZE_MAX, Math.max(LOGO_SIZE_MIN, Math.round(Number.isFinite(n) ? n : DEFAULT_LOGO_WIDTH)));
}

export const useBrandStore = create<BrandState>()(
  persist(
    (set) => ({
      brandMark: DEFAULT_BRAND_MARK,
      brandLogoDataUrl: null,
      brandLogoWidth: DEFAULT_LOGO_WIDTH,
      brandLogoHeight: DEFAULT_LOGO_HEIGHT,

      setBrandMark: (value: string) => {
        const next = value.trim().slice(0, 2);
        set({ brandMark: next || DEFAULT_BRAND_MARK });
      },

      setBrandLogoDataUrl: (value: string | null) => {
        if (typeof value === 'string' && value.length > MAX_LOGO_DATA_URL_LEN) {
          set({ brandLogoDataUrl: null });
          return;
        }
        set({ brandLogoDataUrl: value });
      },

      setBrandLogoSize: (width: number, height: number) =>
        set({
          brandLogoWidth: clampSize(width),
          brandLogoHeight: clampSize(height),
        }),

      resetBrandMark: () => set({ brandMark: DEFAULT_BRAND_MARK }),

      resetAll: () =>
        set({
          brandMark: DEFAULT_BRAND_MARK,
          brandLogoDataUrl: null,
          brandLogoWidth: DEFAULT_LOGO_WIDTH,
          brandLogoHeight: DEFAULT_LOGO_HEIGHT,
        }),
    }),
    {
      name: 'veda-brand',
      version: 2,
      migrate: (persistedState: unknown) => {
        const s = (persistedState as Partial<BrandState>) ?? {};
        const logo = typeof s.brandLogoDataUrl === 'string' ? s.brandLogoDataUrl : null;
        const logoTooLarge = !!logo && logo.length > MAX_LOGO_DATA_URL_LEN;
        return {
          brandMark: typeof s.brandMark === 'string' ? s.brandMark : DEFAULT_BRAND_MARK,
          brandLogoDataUrl: logoTooLarge ? null : logo,
          brandLogoWidth: clampSize(Number(s.brandLogoWidth ?? DEFAULT_LOGO_WIDTH)),
          brandLogoHeight: clampSize(Number(s.brandLogoHeight ?? DEFAULT_LOGO_HEIGHT)),
        } as Partial<BrandState>;
      },
    },
  ),
);

export function displayBrandMark(mark: string | undefined): string {
  const m = (mark ?? '').trim();
  return m ? m.slice(0, 2) : DEFAULT_BRAND_MARK;
}

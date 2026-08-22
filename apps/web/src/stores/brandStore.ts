import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { tenantBrandingApi, type TenantBrandingDto } from '../api/tenantBranding';

/**
 * 회사(테넌트) 브랜딩 — T-57에서 **서버가 정본**이 됐다.
 *
 * 예전에는 localStorage 전용이었다(ADR-0003). 구현은 빨랐지만 기기·브라우저를 바꾸면
 * 사라지고 팀원끼리 공유도 안 됐다. Pro 이상 유료 기능이라 유실이 곧 클레임이다.
 *
 * localStorage 는 버리지 않고 **캐시로만** 남긴다. 새로고침마다 서버 응답을 기다리면
 * 헤더가 기본 배지 → 회사 로고로 한 번 튀는데, 로고는 화면 맨 위 고정 자리라 눈에 띈다.
 * 캐시로 즉시 그리고, 응답이 오면 조용히 맞춘다.
 */

/** 헤더 왼쪽 배지에 표시할 문자(최대 2자). 로고 미사용 시 기본값 */
export const DEFAULT_BRAND_MARK = '베';

export const DEFAULT_LOGO_WIDTH = 32;
export const DEFAULT_LOGO_HEIGHT = 32;
export const MAX_LOGO_BYTES = 220_000;
export const LOGO_SIZE_MIN = 16;
export const LOGO_SIZE_MAX = 96;
export const MAX_LOGO_DATA_URL_LEN = 350_000;

export type BrandValues = {
  brandMark: string;
  brandLogoDataUrl: string | null;
  brandLogoWidth: number;
  brandLogoHeight: number;
};

interface BrandState extends BrandValues {
  /** 캐시가 어느 회사 것인지. 한 브라우저로 회사를 옮기면 남의 로고가 남는다 */
  cachedTenantId: string | null;
  /** 서버 응답을 한 번이라도 받았는지 */
  loaded: boolean;

  applyServer: (dto: TenantBrandingDto, tenantId: string) => void;
  syncFromServer: (tenantId: string, opts?: { canWrite?: boolean }) => Promise<void>;
  saveToServer: (values: BrandValues) => Promise<void>;
  clearCache: () => void;
}

function clampSize(n: number): number {
  return Math.min(
    LOGO_SIZE_MAX,
    Math.max(LOGO_SIZE_MIN, Math.round(Number.isFinite(n) ? n : DEFAULT_LOGO_WIDTH)),
  );
}

export const DEFAULT_BRAND_VALUES: BrandValues = {
  brandMark: DEFAULT_BRAND_MARK,
  brandLogoDataUrl: null,
  brandLogoWidth: DEFAULT_LOGO_WIDTH,
  brandLogoHeight: DEFAULT_LOGO_HEIGHT,
};

/** 기본값 그대로인지 — 로컬에만 있던 브랜딩을 서버로 올릴지 판단할 때 쓴다 */
export function isDefaultBranding(v: BrandValues): boolean {
  return (
    v.brandMark === DEFAULT_BRAND_MARK &&
    !v.brandLogoDataUrl &&
    v.brandLogoWidth === DEFAULT_LOGO_WIDTH &&
    v.brandLogoHeight === DEFAULT_LOGO_HEIGHT
  );
}

function fromDto(dto: TenantBrandingDto): BrandValues {
  return {
    brandMark: dto.brandMark || DEFAULT_BRAND_MARK,
    brandLogoDataUrl: dto.logoDataUrl ?? null,
    brandLogoWidth: clampSize(Number(dto.logoWidth)),
    brandLogoHeight: clampSize(Number(dto.logoHeight)),
  };
}

export const useBrandStore = create<BrandState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_BRAND_VALUES,
      cachedTenantId: null,
      loaded: false,

      applyServer: (dto, tenantId) =>
        set({ ...fromDto(dto), cachedTenantId: tenantId, loaded: true }),

      /**
       * 서버 값을 받아 화면에 반영한다.
       *
       * 서버에 저장된 적이 없는데(`updatedAt === null`) 이 브라우저에 예전 브랜딩이
       * 남아 있으면 **한 번 올려 준다**. 서버 저장으로 바뀌었다는 이유로 이미 설정해 둔
       * 로고가 사라지면, 사용자에겐 그냥 기능이 고장 난 것이다.
       */
      syncFromServer: async (tenantId, opts) => {
        const before = get();
        // 다른 회사 캐시가 남아 있으면 먼저 지운다 — 남의 로고가 잠깐이라도 보이면 안 된다
        if (before.cachedTenantId && before.cachedTenantId !== tenantId) {
          set({ ...DEFAULT_BRAND_VALUES, cachedTenantId: tenantId, loaded: false });
        }

        const dto = await tenantBrandingApi.get();
        const local: BrandValues = {
          brandMark: before.brandMark,
          brandLogoDataUrl: before.brandLogoDataUrl,
          brandLogoWidth: before.brandLogoWidth,
          brandLogoHeight: before.brandLogoHeight,
        };
        // v2 이하 캐시에는 테넌트 기록이 없다(null). 그 경우도 "내 것"으로 봐야 예전
        // 브랜딩이 이관된다 — 남의 것이었다면 위에서 이미 지워졌다.
        const cacheIsOurs = before.cachedTenantId === null || before.cachedTenantId === tenantId;

        if (dto.updatedAt === null && cacheIsOurs && !isDefaultBranding(local)) {
          if (opts?.canWrite) {
            try {
              const saved = await tenantBrandingApi.update({
                brandMark: local.brandMark,
                logoDataUrl: local.brandLogoDataUrl,
                logoWidth: local.brandLogoWidth,
                logoHeight: local.brandLogoHeight,
              });
              get().applyServer(saved, tenantId);
              return;
            } catch {
              // 올리지 못해도(권한·플랜) 로컬 값은 그대로 보여 준다
            }
          }
          set({ cachedTenantId: tenantId, loaded: true });
          return;
        }

        get().applyServer(dto, tenantId);
      },

      saveToServer: async (values) => {
        const saved = await tenantBrandingApi.update({
          brandMark: values.brandMark.trim().slice(0, 2) || DEFAULT_BRAND_MARK,
          logoDataUrl: values.brandLogoDataUrl,
          logoWidth: clampSize(values.brandLogoWidth),
          logoHeight: clampSize(values.brandLogoHeight),
        });
        set({ ...fromDto(saved), loaded: true });
      },


      clearCache: () =>
        set({ ...DEFAULT_BRAND_VALUES, cachedTenantId: null, loaded: false }),
    }),
    {
      name: 'veda-brand',
      version: 3,
      partialize: (s) => ({
        brandMark: s.brandMark,
        brandLogoDataUrl: s.brandLogoDataUrl,
        brandLogoWidth: s.brandLogoWidth,
        brandLogoHeight: s.brandLogoHeight,
        cachedTenantId: s.cachedTenantId,
      }),
      migrate: (persistedState: unknown) => {
        const s = (persistedState as Partial<BrandState>) ?? {};
        const logo = typeof s.brandLogoDataUrl === 'string' ? s.brandLogoDataUrl : null;
        const logoTooLarge = !!logo && logo.length > MAX_LOGO_DATA_URL_LEN;
        return {
          brandMark: typeof s.brandMark === 'string' ? s.brandMark : DEFAULT_BRAND_MARK,
          brandLogoDataUrl: logoTooLarge ? null : logo,
          brandLogoWidth: clampSize(Number(s.brandLogoWidth ?? DEFAULT_LOGO_WIDTH)),
          brandLogoHeight: clampSize(Number(s.brandLogoHeight ?? DEFAULT_LOGO_HEIGHT)),
          // v2 이하는 테넌트를 기록하지 않았다. `syncFromServer` 가 null 을 "내 것"으로
          // 취급해 서버로 한 번 이관한다.
          cachedTenantId: typeof s.cachedTenantId === 'string' ? s.cachedTenantId : null,
        } as Partial<BrandState>;
      },
    },
  ),
);

export function displayBrandMark(mark: string | undefined): string {
  const m = (mark ?? '').trim();
  return m ? m.slice(0, 2) : DEFAULT_BRAND_MARK;
}

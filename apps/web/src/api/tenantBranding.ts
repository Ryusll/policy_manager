import client from './client';

export type TenantBrandingDto = {
  brandMark: string;
  logoDataUrl: string | null;
  logoWidth: number;
  logoHeight: number;
  /** 서버에 저장된 적이 없으면 null — 로컬 브랜딩 이관 여부를 이 값으로 판단한다 */
  updatedAt: string | null;
};

export type TenantBrandingPatch = Partial<Omit<TenantBrandingDto, 'updatedAt'>>;

export const tenantBrandingApi = {
  get: () => client.get<TenantBrandingDto>('/tenant-branding').then((r) => r.data),
  update: (patch: TenantBrandingPatch) =>
    client.put<TenantBrandingDto>('/tenant-branding', patch).then((r) => r.data),
};

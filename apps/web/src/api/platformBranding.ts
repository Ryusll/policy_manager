import client from './client';

export type PlatformBrandingDto = {
  legalName: string;
  registrationNo: string | null;
  productLabel: string;
  logoUrl: string | null;
  lockupImageSrc: string;
};

export const platformBrandingApi = {
  get: () => client.get<PlatformBrandingDto>('/platform-branding').then((r) => r.data),
};

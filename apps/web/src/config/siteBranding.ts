/**
 * 상단·하단 로고 및 법인 표기.
 * PNG는 `public/branding`에 두고, 배경 투명 알파 채널이 있으면 헤더 색 위에 자연스럽게 올라갑니다.
 */
export const SITE_LOCKUP = {
  imageSrc: '/branding/lockup-astrum-veda.png',
  alt: 'Astrum · Veda',
} as const;

export function getPublicCompanyLegalName(): string {
  const v = import.meta.env.VITE_PUBLIC_COMPANY_LEGAL_NAME;
  return typeof v === 'string' ? v.trim() : '';
}

export function getPublicCompanyRegistration(): string {
  const v = import.meta.env.VITE_PUBLIC_COMPANY_REG_NO;
  return typeof v === 'string' ? v.trim() : '';
}

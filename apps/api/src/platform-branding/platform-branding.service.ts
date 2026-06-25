import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

export const PLATFORM_BRANDING_ID = 'default';
const MAX_LOGO_DATA_URL_LEN = 400_000;

export type PlatformBrandingPublic = {
  legalName: string;
  registrationNo: string | null;
  productLabel: string;
  logoUrl: string | null;
  lockupImageSrc: string;
};

@Injectable()
export class PlatformBrandingService {
  constructor(private prisma: PrismaService) {}

  async ensureDefault() {
    const row = await this.prisma.platformBranding.findUnique({ where: { id: PLATFORM_BRANDING_ID } });
    if (row) return row;
    return this.prisma.platformBranding.create({
      data: {
        id: PLATFORM_BRANDING_ID,
        legalName: '',
        productLabel: 'Policy Manager',
        lockupImageSrc: '/branding/lockup-astrum-veda.png',
      },
    });
  }

  toPublic(row: {
    legalName: string;
    registrationNo: string | null;
    productLabel: string;
    logoDataUrl: string | null;
    lockupImageSrc: string;
  }): PlatformBrandingPublic {
    return {
      legalName: row.legalName ?? '',
      registrationNo: row.registrationNo ?? null,
      productLabel: row.productLabel ?? 'Policy Manager',
      logoUrl: row.logoDataUrl ?? null,
      lockupImageSrc: row.lockupImageSrc || '/branding/lockup-astrum-veda.png',
    };
  }

  async getPublic(): Promise<PlatformBrandingPublic> {
    const row = await this.ensureDefault();
    return this.toPublic(row);
  }

  async update(patch: {
    legalName?: string;
    registrationNo?: string | null;
    productLabel?: string;
    logoDataUrl?: string | null;
    lockupImageSrc?: string;
  }): Promise<PlatformBrandingPublic> {
    await this.ensureDefault();
    if (patch.logoDataUrl != null && patch.logoDataUrl.length > MAX_LOGO_DATA_URL_LEN) {
      throw new BadRequestException('로고 데이터가 너무 큽니다. 더 작은 이미지를 사용해 주세요.');
    }
    const data: Record<string, unknown> = {};
    if (patch.legalName !== undefined) data.legalName = String(patch.legalName).trim().slice(0, 200);
    if (patch.registrationNo !== undefined) {
      const raw = patch.registrationNo;
      data.registrationNo =
        raw == null || String(raw).trim() === '' ? null : String(raw).trim().slice(0, 80);
    }
    if (patch.productLabel !== undefined) {
      const t = String(patch.productLabel).trim().slice(0, 160);
      data.productLabel = t.length ? t : 'Policy Manager';
    }
    if (patch.logoDataUrl !== undefined) data.logoDataUrl = patch.logoDataUrl;
    if (patch.lockupImageSrc !== undefined) {
      const t = String(patch.lockupImageSrc).trim().slice(0, 512);
      data.lockupImageSrc = t.length ? t : '/branding/lockup-astrum-veda.png';
    }
    const row = await this.prisma.platformBranding.update({
      where: { id: PLATFORM_BRANDING_ID },
      data: data as any,
    });
    return this.toPublic(row);
  }
}

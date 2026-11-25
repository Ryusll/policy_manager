import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * 테넌트(고객사) 브랜딩 — T-57.
 *
 * 예전에는 브라우저 localStorage 에만 있었다(ADR-0003). 구현은 빨랐지만 기기·브라우저를
 * 바꾸면 사라지고 팀원끼리 공유도 안 됐다. Pro 이상 **유료 기능**이라 유실이 곧 클레임이다.
 */

export const DEFAULT_BRAND_MARK = '베';
export const DEFAULT_LOGO_SIZE = 32;
export const LOGO_SIZE_MIN = 16;
export const LOGO_SIZE_MAX = 96;
/** 로고는 data URL 로 들어온다. 브라우저 localStorage 한계(약 5MB)와 무관하게 서버에서도 상한을 둔다. */
export const MAX_LOGO_DATA_URL_LEN = 350_000;

export type TenantBrandingPublic = {
  brandMark: string;
  logoDataUrl: string | null;
  logoWidth: number;
  logoHeight: number;
  updatedAt: string | null;
};

/** 저장된 적 없는 테넌트도 화면은 그려야 한다 — 기본값을 돌려준다. */
export const DEFAULT_TENANT_BRANDING: TenantBrandingPublic = {
  brandMark: DEFAULT_BRAND_MARK,
  logoDataUrl: null,
  logoWidth: DEFAULT_LOGO_SIZE,
  logoHeight: DEFAULT_LOGO_SIZE,
  updatedAt: null,
};

function clampSize(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_LOGO_SIZE;
  return Math.min(LOGO_SIZE_MAX, Math.max(LOGO_SIZE_MIN, v));
}

@Injectable()
export class TenantBrandingService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private toPublic(row: {
    brandMark: string;
    logoDataUrl: string | null;
    logoWidth: number;
    logoHeight: number;
    updatedAt: Date;
  }): TenantBrandingPublic {
    return {
      brandMark: row.brandMark || DEFAULT_BRAND_MARK,
      logoDataUrl: row.logoDataUrl ?? null,
      logoWidth: clampSize(row.logoWidth),
      logoHeight: clampSize(row.logoHeight),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async get(tenantId: string): Promise<TenantBrandingPublic> {
    const row = await this.prisma.tenantBranding.findUnique({ where: { tenantId } });
    return row ? this.toPublic(row) : { ...DEFAULT_TENANT_BRANDING };
  }

  async update(
    tenantId: string,
    userId: string,
    patch: {
      brandMark?: string;
      logoDataUrl?: string | null;
      logoWidth?: number;
      logoHeight?: number;
    },
  ): Promise<TenantBrandingPublic> {
    if (patch.logoDataUrl != null && patch.logoDataUrl.length > MAX_LOGO_DATA_URL_LEN) {
      throw new BadRequestException('로고 데이터가 너무 큽니다. 더 작은 이미지를 사용해 주세요.');
    }
    if (patch.logoDataUrl != null && !/^data:image\//i.test(patch.logoDataUrl)) {
      // 외부 URL 을 받으면 헤더가 매번 남의 서버를 부르게 된다(추적·가용성 문제).
      throw new BadRequestException('로고는 이미지 data URL 이어야 합니다.');
    }

    const data: Record<string, unknown> = {};
    if (patch.brandMark !== undefined) {
      const mark = String(patch.brandMark).trim().slice(0, 2);
      data.brandMark = mark || DEFAULT_BRAND_MARK;
    }
    if (patch.logoDataUrl !== undefined) data.logoDataUrl = patch.logoDataUrl;
    if (patch.logoWidth !== undefined) data.logoWidth = clampSize(patch.logoWidth);
    if (patch.logoHeight !== undefined) data.logoHeight = clampSize(patch.logoHeight);

    const row = await this.prisma.tenantBranding.upsert({
      where: { tenantId },
      create: {
        tenantId,
        brandMark: (data.brandMark as string) ?? DEFAULT_BRAND_MARK,
        logoDataUrl: (data.logoDataUrl as string | null) ?? null,
        logoWidth: (data.logoWidth as number) ?? DEFAULT_LOGO_SIZE,
        logoHeight: (data.logoHeight as number) ?? DEFAULT_LOGO_SIZE,
        updatedBy: userId,
      },
      update: { ...data, updatedBy: userId },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: 'branding.update',
      entityType: 'TenantBranding',
      entityId: tenantId,
      details: { fields: Object.keys(data) },
    });

    return this.toPublic(row);
  }
}

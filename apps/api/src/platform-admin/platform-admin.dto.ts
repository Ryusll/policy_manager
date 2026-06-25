import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTenantPlanDto {
  @ApiProperty({ enum: ['starter', 'pro', 'enterprise'] })
  @IsEnum(['starter', 'pro', 'enterprise'])
  plan: 'starter' | 'pro' | 'enterprise';

  @ApiProperty({ enum: ['active', 'trial', 'past_due', 'canceled'] })
  @IsEnum(['active', 'trial', 'past_due', 'canceled'])
  billingStatus: 'active' | 'trial' | 'past_due' | 'canceled';

  @ApiProperty({ required: false, description: '플랜 만료일(ISO-8601). null/미입력 시 해제' })
  @IsOptional()
  @IsDateString()
  planExpiresAt?: string;
}

export class UpdateTenantUserRoleDto {
  @ApiProperty({ enum: ['admin', 'editor', 'viewer'] })
  @IsEnum(['admin', 'editor', 'viewer'])
  role: 'admin' | 'editor' | 'viewer';
}

export class UpdatePlatformRoleDto {
  @ApiProperty({ enum: ['none', 'global_admin'] })
  @IsEnum(['none', 'global_admin'])
  platformRole: 'none' | 'global_admin';
}

export class TenantListQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  q?: string;
}

/** 통합 관리자: 서비스 운영사 푸터·로고(단일 행) */
export class UpdatePlatformBrandingDto {
  @ApiProperty({ required: false, description: '법인명(푸터 상단)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiProperty({ required: false, nullable: true, description: '사업자등록번호' })
  @IsOptional()
  registrationNo?: string | null;

  @ApiProperty({ required: false, description: '서비스/제품명(법인명 비었을 때 표시)' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  productLabel?: string;

  @ApiProperty({ required: false, nullable: true, description: '로고 data URL 또는 null(제거)' })
  @IsOptional()
  logoDataUrl?: string | null;

  @ApiProperty({ required: false, description: '기본 락업 이미지 경로( public 기준 )' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  lockupImageSrc?: string;
}


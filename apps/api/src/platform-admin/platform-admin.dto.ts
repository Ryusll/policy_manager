import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

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


const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * 고객사 개설 (T-122). 마스터 비밀번호는 받지 않는다 — 서버가 임시 비밀번호를 만들어 한 번만
 * 돌려주고, 마스터는 첫 로그인 때 바꾼다. 아스트룸 담당자가 비밀번호를 고르면 약한 값을 쓰거나
 * 여러 고객사에 같은 값을 쓰게 된다.
 */
export class CreateTenantDto {
  @ApiProperty({ description: '회사명', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: '조직 코드 — 로그인 화면의 "기관 코드". 영문 소문자·숫자·하이픈 2~40자', example: 'acme' })
  @Transform(lower)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,39}$/, {
    message: '조직 코드는 영문 소문자·숫자·하이픈 2~40자이고 하이픈으로 시작할 수 없습니다.',
  })
  slug: string;

  @ApiProperty({ enum: ['starter', 'pro', 'enterprise'], default: 'starter' })
  @IsOptional()
  @IsEnum(['starter', 'pro', 'enterprise'])
  plan?: 'starter' | 'pro' | 'enterprise';

  @ApiProperty({ description: '고객사 마스터(첫 관리자) 이메일 — 로그인 아이디' })
  @Transform(lower)
  @IsEmail()
  masterEmail: string;

  @ApiProperty({ description: '마스터 이름', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  masterName: string;
}

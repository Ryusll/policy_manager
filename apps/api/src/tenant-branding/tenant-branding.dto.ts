import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { LOGO_SIZE_MAX, LOGO_SIZE_MIN, MAX_LOGO_DATA_URL_LEN } from './tenant-branding.service';

export class UpdateTenantBrandingDto {
  @ApiProperty({ required: false, description: '로고 미사용 시 헤더 배지에 표시할 문자(최대 2자)' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  brandMark?: string;

  @ApiProperty({ required: false, description: '회사 로고 이미지 data URL. null 이면 로고 해제' })
  @IsOptional()
  // `null`(로고 해제)과 문자열을 모두 받아야 해서, null 일 때는 문자열 검증을 건너뛴다.
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(MAX_LOGO_DATA_URL_LEN)
  logoDataUrl?: string | null;

  @ApiProperty({ required: false, minimum: LOGO_SIZE_MIN, maximum: LOGO_SIZE_MAX })
  @IsOptional()
  @IsInt()
  @Min(LOGO_SIZE_MIN)
  @Max(LOGO_SIZE_MAX)
  logoWidth?: number;

  @ApiProperty({ required: false, minimum: LOGO_SIZE_MIN, maximum: LOGO_SIZE_MAX })
  @IsOptional()
  @IsInt()
  @Min(LOGO_SIZE_MIN)
  @Max(LOGO_SIZE_MAX)
  logoHeight?: number;
}

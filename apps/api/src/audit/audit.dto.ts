import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class AuditLogQueryDto {
  @ApiProperty({ required: false, description: '정확히 일치. 끝에 `.` 을 붙이면 접두어 묶음(예: `version.`)' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @ApiProperty({ required: false, description: '수행자 사용자 ID' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @ApiProperty({ required: false, description: '시작일 YYYY-MM-DD (그날 00:00부터)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from 은 YYYY-MM-DD 형식이어야 합니다.' })
  from?: string;

  @ApiProperty({ required: false, description: '종료일 YYYY-MM-DD (그날 끝까지 포함)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to 는 YYYY-MM-DD 형식이어야 합니다.' })
  to?: string;

  @ApiProperty({ required: false, description: '1부터' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiProperty({ required: false, description: '기본 50, 최대 200' })
  @IsOptional()
  @IsString()
  limit?: string;
}

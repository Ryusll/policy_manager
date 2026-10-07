import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class LawChangeListQueryDto {
  @ApiPropertyOptional({ description: '이 법령의 변경만' })
  @IsOptional()
  @IsString()
  lawId?: string;

  @ApiPropertyOptional({ description: 'true 면 우리 회사의 확정 연결이 걸린 변경만' })
  @IsOptional()
  // 쿼리스트링은 문자열이다. 암묵 변환은 "false" 도 true 로 만드므로 원문을 직접 본다
  @Transform(({ obj, key }) => ['true', '1'].includes(String(obj[key])))
  @IsBoolean()
  affected?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class LawImpactQueryDto {
  @ApiPropertyOptional({
    description: '영향 분석 기준일(YYYY-MM-DD). 생략하면 법령 시행일과 오늘 중 늦은 날',
    example: '2026-12-01',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '기준일(asOf)은 YYYY-MM-DD 형식이어야 합니다.' })
  asOf?: string;
}

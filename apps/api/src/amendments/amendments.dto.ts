import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';

export class GenerateAmendmentsDto {
  @ApiProperty({ description: '후보를 만들 법령 변경 이벤트' })
  @IsUUID('4', { message: 'changeEventId 는 변경 이벤트 id 여야 합니다.' })
  changeEventId: string;

  @ApiPropertyOptional({
    description: '영향 분석 기준일(YYYY-MM-DD) — 이날 시행 중인 본문이 제1 조문. 생략하면 법령 시행일과 오늘 중 늦은 날',
    example: '2027-01-01',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '기준일(asOf)은 YYYY-MM-DD 형식이어야 합니다.' })
  asOf?: string;
}

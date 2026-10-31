import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class AskDto {
  @ApiProperty({ description: '직원의 질문(2~500자). 예: 결혼하면 경조금이 얼마인가요?' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2, { message: '질문을 2자 이상 입력하세요.' })
  @MaxLength(500, { message: '질문은 500자까지 입력할 수 있습니다.' })
  question: string;
}

export class AskSettingsDto {
  @ApiProperty({ description: '회사의 규정 질문(AI) 사용 여부. 끄면 질문할 수 없다' })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    required: false,
    description: '켤 때 필수 — 관리자가 화면에서 확인한 외부 전송 고지 판(`GET /ask/status` 의 notice.version). 지금 판과 다르면 400 (T-146)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  noticeVersion?: number;
}

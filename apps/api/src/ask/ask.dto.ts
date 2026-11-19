import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ASK_SCOPE_MAX } from './ask-candidates';

export class AskDto {
  @ApiProperty({ description: '직원의 질문(2~500자). 예: 결혼하면 경조금이 얼마인가요?' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2, { message: '질문을 2자 이상 입력하세요.' })
  @MaxLength(500, { message: '질문은 500자까지 입력할 수 있습니다.' })
  question: string;

  @ApiPropertyOptional({
    type: [String],
    description: `살펴볼 규정(그 회사의 활성 규정 id, 최대 ${ASK_SCOPE_MAX}개) — 비우면 회사의 시행 중 규정 전체에서 찾는다(T-219)`,
  })
  @IsOptional()
  @IsArray({ message: '규정 범위는 규정 id 목록이어야 합니다.' })
  @ArrayMaxSize(ASK_SCOPE_MAX, { message: `규정 범위는 ${ASK_SCOPE_MAX}개까지 고를 수 있습니다.` })
  @ArrayUnique({ message: '같은 규정을 두 번 고를 수 없습니다.' })
  @IsUUID('4', { each: true, message: '규정 범위는 규정 id 여야 합니다.' })
  policyIds?: string[];

  @ApiPropertyOptional({
    description: '이어 물을 앞 질문의 기록 id(앞 응답의 id) — 그 답의 근거 조문을 이번 후보로 이어받는다(T-220). 본인의, 답을 냈고 근거(회사 조문)를 남긴 기록만',
  })
  @IsOptional()
  @IsUUID('4', { message: '앞 질문은 기록 id 여야 합니다.' })
  parentId?: string;
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

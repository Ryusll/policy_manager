import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const RELATION_TYPES = ['delegation', 'application', 'citation', 'obligation', 'reference'] as const;
export type LawRelationTypeValue = (typeof RELATION_TYPES)[number];

/** 사람이 확정 상태로 바꿀 때 쓰는 값. `suggested` 는 기계만 쓴다 — 사람이 되돌리지 않는다 */
const CONFIRM_STATES = ['confirmed', 'rejected'] as const;
export type ConfirmStateValue = (typeof CONFIRM_STATES)[number];

export class CreateLawLinkDto {
  @ApiProperty({ description: '법령조항 id (LawArticle.id)' })
  @IsUUID()
  lawArticleId: string;

  @ApiProperty({ description: '사내 조문 id (Article.id)' })
  @IsUUID()
  articleId: string;

  @ApiProperty({ enum: RELATION_TYPES })
  @IsEnum(RELATION_TYPES)
  relationType: LawRelationTypeValue;

  @ApiPropertyOptional({ description: '적용 범위 (예: "정규직에 한함")' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  scope?: string;

  @ApiPropertyOptional({ description: '관계의 근거 문구' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  evidenceText?: string;
}

export class UpdateLawLinkDto {
  @ApiPropertyOptional({ enum: RELATION_TYPES })
  @IsOptional()
  @IsEnum(RELATION_TYPES)
  relationType?: LawRelationTypeValue;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  scope?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  evidenceText?: string;

  @ApiPropertyOptional({
    enum: CONFIRM_STATES,
    description: '확정(confirmed) 또는 반려(rejected). suggested 로는 되돌릴 수 없다',
  })
  @IsOptional()
  @IsEnum(CONFIRM_STATES)
  confirmState?: ConfirmStateValue;
}

export class SuggestLawLinksDto {
  @ApiProperty({ description: '인용을 스캔할 사내 조문 id' })
  @IsUUID()
  articleId: string;
}

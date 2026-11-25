import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * 텍스트 가져오기 한 번에 저장(T-135) — 규정 목록의 "기존 규정 가져오기"가 화면에서 나눈 장·조문을 한 요청으로 보낸다.
 * 긴 원문은 JSON 기본 한도(100kb)를 넘으므로 이 경로만 전용 형식(`POLICY_IMPORT_MEDIA_TYPE`)으로 더 크게 받는다.
 */
export const POLICY_IMPORT_MEDIA_TYPE = 'application/vnd.policy-import+json';
export const POLICY_IMPORT_BODY_LIMIT = '20mb';

export class ImportPolicyArticleDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  number: number;

  @ApiProperty({ required: false, description: '가지 번호("제3조의2"의 2)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  branchNumber?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  clauseNumber?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  itemNumber?: number;

  @ApiProperty({ required: false, description: '조 제목(항·목 행은 비운다)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiProperty({ required: false, description: '본문 — 비어 있으면 버전을 만들지 않는다(조 제목 행)' })
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  content?: string;
}

export class ImportPolicyChapterDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  number: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @ApiProperty({ required: false, description: '원문에 장 표기가 없어 만든 장이면 true(숨김 장)' })
  @IsOptional()
  @IsBoolean()
  suppressHeader?: boolean;

  @ApiProperty({ type: [ImportPolicyArticleDto] })
  @IsArray()
  @ArrayMaxSize(20_000)
  @ValidateNested({ each: true })
  @Type(() => ImportPolicyArticleDto)
  articles: ImportPolicyArticleDto[];
}

export class ImportPolicyLogDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsIn(['mixed', 'korean', 'english'])
  parseProfile?: 'mixed' | 'korean' | 'english';

  @ApiProperty({ required: false, description: '원문에서 나눈 조 수(항·목으로 펼치기 전)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  articleCount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  cleanupOptions?: Record<string, unknown>;
}

export class ImportPolicyDocumentDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  code: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  /** 관리자가 가져오면 바로 시행한다 — 그 본문이 실제로 시행된 날(필수). 편집자는 보내도 초안으로 남는다 */
  @ApiProperty({ required: false, description: '가져오는 본문이 시행된 날 (YYYY-MM-DD) — 관리자 필수' })
  @IsOptional()
  @IsString()
  effectiveDate?: string;

  @ApiProperty({ type: [ImportPolicyChapterDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1_000)
  @ValidateNested({ each: true })
  @Type(() => ImportPolicyChapterDto)
  chapters: ImportPolicyChapterDto[];

  @ApiProperty({ required: false, type: ImportPolicyLogDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImportPolicyLogDto)
  log?: ImportPolicyLogDto;
}

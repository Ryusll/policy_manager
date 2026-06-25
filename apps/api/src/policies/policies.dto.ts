import { IsString, IsOptional, IsBoolean, IsInt, Min, MaxLength, IsIn, IsDateString, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PolicyRevisionNotifyDto } from '../notifications/notifications.dto';

export class CreatePolicyDto {
  @ApiProperty()
  @IsString()
  code: string;

  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false, description: '담당 부서(예: 인사팀, 보안팀)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @ApiProperty({ required: false, description: '규정 분류(예: 정보보안, 인사, 재무)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiProperty({ required: false, description: '적용 양식 ID' })
  @IsOptional()
  @IsString()
  templateId?: string;
}

export class UpdatePolicyDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false, description: '담당 부서(메타데이터)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @ApiProperty({ required: false, description: '규정 분류(메타데이터)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ required: false, nullable: true, description: '적용 양식 ID (null로 해제 가능)' })
  @IsOptional()
  @IsString()
  templateId?: string | null;

  @ApiProperty({ required: false, nullable: true, description: '개정일 (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  revisionDate?: string | null;

  @ApiProperty({ required: false, nullable: true, description: '시행일 (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string | null;

  @ApiProperty({
    required: false,
    description: '시행 승인 시 알림 수신 설정(팀·개인)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PolicyRevisionNotifyDto)
  revisionNotify?: PolicyRevisionNotifyDto;
}

export class CreateChapterDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  number: number;

  @ApiProperty({ required: false, description: '장 제목 (suppressHeader 시 생략 가능)' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ required: false, description: 'true면 목차·인쇄에서 장 제목 숨김(조문만 구성)' })
  @IsOptional()
  @IsBoolean()
  suppressHeader?: boolean;
}

export class UpdateChapterDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  number?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  suppressHeader?: boolean;
}

export class CreateArticleDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  number: number;

  @ApiProperty({ required: false, description: '조 제목 (항·목만 추가할 때는 비워도 됨)' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ required: false, description: '항 번호 (예: 1항)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  clauseNumber?: number;

  @ApiProperty({ required: false, description: '목 번호 (예: 1목)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  itemNumber?: number;

  @ApiProperty({ required: false, description: '"판" 배지: 관련 판례 존재 여부' })
  @IsOptional()
  @IsBoolean()
  hasPrecedent?: boolean;

  @ApiProperty({ required: false, description: '"법" 배지: 관련 법령 존재 여부' })
  @IsOptional()
  @IsBoolean()
  hasRelatedLaw?: boolean;

  @ApiProperty({ required: false, description: '"규" 배지: 연관 규정 존재 여부' })
  @IsOptional()
  @IsBoolean()
  hasRelatedRule?: boolean;

  @ApiProperty({ required: false, description: '관련 판례·사건번호 등 메모(자유 입력)' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  relatedPrecedentNote?: string;

  @ApiProperty({ required: false, description: '관련 법령·조문 등 메모(자유 입력)' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  relatedLawNote?: string;

  @ApiProperty({ required: false, description: '연관 규정 코드·명칭 등 메모(자유 입력)' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  relatedRuleNote?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  content?: string;
}

export class UpdateArticleDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  number?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ required: false, description: '항 번호 비우려면 null' })
  @IsOptional()
  clauseNumber?: number | null;

  @ApiProperty({ required: false, description: '목 번호 비우려면 null' })
  @IsOptional()
  itemNumber?: number | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  hasPrecedent?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  hasRelatedLaw?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  hasRelatedRule?: boolean;

  @ApiProperty({ required: false, description: '관련 판례·사건번호 등 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  relatedPrecedentNote?: string;

  @ApiProperty({ required: false, description: '관련 법령·조문 등 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  relatedLawNote?: string;

  @ApiProperty({ required: false, description: '연관 규정 코드·명칭 등 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  relatedRuleNote?: string;
}

const appendixKinds = ['supplementary', 'annex', 'form'] as const;

export class CreatePolicyAppendixDto {
  @ApiProperty({ enum: appendixKinds, description: 'supplementary=부칙, annex=별표, form=서식' })
  @IsIn(appendixKinds)
  kind: (typeof appendixKinds)[number];

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  title: string;

  @ApiProperty({ description: '본문(텍스트·간단 HTML 가능). 저장 시 길이 제한 적용.' })
  @IsString()
  @MaxLength(500000)
  body: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdatePolicyAppendixDto {
  @ApiProperty({ required: false, enum: appendixKinds })
  @IsOptional()
  @IsIn(appendixKinds)
  kind?: (typeof appendixKinds)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500000)
  body?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreatePolicyImportLogDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  policyId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sourceName?: string;

  @ApiProperty({ required: false, enum: ['mixed', 'korean', 'english'] })
  @IsOptional()
  @IsIn(['mixed', 'korean', 'english'])
  parseProfile?: 'mixed' | 'korean' | 'english';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  chapterCount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  articleCount?: number;

  @ApiProperty({ required: false, description: '자동 정리 옵션 JSON' })
  @IsOptional()
  cleanupOptions?: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  message?: string;
}
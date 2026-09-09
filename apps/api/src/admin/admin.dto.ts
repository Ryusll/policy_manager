import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImportArticleDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  number: number;

  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ required: false, description: 'true면 v1을 바로 published로' })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class ImportChapterDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  number: number;

  @ApiProperty({ required: false, description: '장 제목 (suppressHeader 시 생략)' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ required: false, description: 'true면 장 머리글을 쓰지 않는다' })
  @IsOptional()
  @IsBoolean()
  suppressHeader?: boolean;

  @ApiProperty({ type: [ImportArticleDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportArticleDto)
  articles?: ImportArticleDto[];
}

export class ImportPolicyDto {
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

  @ApiProperty({ type: [ImportChapterDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportChapterDto)
  chapters?: ImportChapterDto[];

  /**
   * 장 없이 조문만 있는 규정(T-84). 예전에는 이 형태를 표현할 수 없어
   * **없는 장 제목을 지어내야** 했다 — T-83 이 다른 가져오기 경로에서
   * 없앤 바로 그 문제다. 서버가 숨김 장 한 건으로 눕혀 담는다.
   */
  @ApiProperty({ type: [ImportArticleDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportArticleDto)
  articles?: ImportArticleDto[];
}

export class ImportPoliciesDto {
  @ApiProperty({ type: [ImportPolicyDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportPolicyDto)
  policies: ImportPolicyDto[];
}

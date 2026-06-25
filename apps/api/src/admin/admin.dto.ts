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

  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty({ type: [ImportArticleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportArticleDto)
  articles: ImportArticleDto[];
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

  @ApiProperty({ type: [ImportChapterDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportChapterDto)
  chapters: ImportChapterDto[];
}

export class ImportPoliciesDto {
  @ApiProperty({ type: [ImportPolicyDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportPolicyDto)
  policies: ImportPolicyDto[];
}

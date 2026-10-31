import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTemplateDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({
    description: '자유형 레이아웃 JSON. rawHtml(문자열)을 포함할 수 있습니다.',
    example: { rawHtml: '<h1>{{policy.title}}</h1><div>{{content}}</div>' },
  })
  @IsObject()
  layoutJson: Record<string, unknown>;

  @ApiProperty({ required: false, default: '' })
  @IsOptional()
  @IsString()
  cssText?: string;
}

export class UpdateTemplateDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  layoutJson?: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  cssText?: string;
}

export class CloneTemplateDto {
  @ApiProperty({ required: false, description: '새 템플릿 이름. 미입력 시 "(복제)" 접미사' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

export class RestoreTemplateDto {
  @ApiProperty({ description: '복원할 이력(감사 로그) ID. `GET /templates/:id/revisions` 의 `id`' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  revisionId: string;
}

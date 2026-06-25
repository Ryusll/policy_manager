import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateRegulationParseTreeDto {
  @ApiProperty({ description: '수정된 조항 트리 (루트 노드 배열)' })
  @IsArray()
  roots: unknown[];
}

export class CommitRegulationParseDto {
  @ApiProperty({ description: '새 규정 코드(고유)' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  code: string;

  @ApiProperty({ description: '규정 제목' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;
}

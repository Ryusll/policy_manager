import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateRegulationParseTreeDto {
  @ApiProperty({ description: '수정된 조항 트리 (루트 노드 배열)' })
  @IsArray()
  // `@Type(() => Object)`가 없으면 전역 ValidationPipe의 enableImplicitConversion이
  // 각 원소를 필드의 반영 타입(Array)으로 변환해 노드가 통째로 `[]`가 된다.
  // 그 상태로 커밋하면 조문이 "[undefined] undefined"로 만들어진다.
  @Type(() => Object)
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

export class CreateFromLawGoKrDto {
  @ApiProperty({ description: '법제처 법령일련번호(MST). 검색 결과의 `mst` 값' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  mst: string;
}

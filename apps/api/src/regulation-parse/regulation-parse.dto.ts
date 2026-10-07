import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

  /**
   * 가져오는 본문이 시행된 날(사내 규정 시행일). 첫 버전이 이 날짜로 시행된다.
   * 필수인 이유: 시행일 없는 발행본은 시점 조회 규칙(common/as-of.ts)에서 빠져
   * 법령 개정 분석의 기준 본문이 되지 못한다. "오늘"로 채우면 이미 시행 중인
   * 규정의 과거 시점 조회가 틀어진다(PAT-02).
   */
  @ApiProperty({ description: '가져오는 본문이 시행된 날 (YYYY-MM-DD)' })
  @IsDateString()
  effectiveDate: string;
}

export class CreateFromLawGoKrDto {
  @ApiProperty({ description: '법제처 법령일련번호(MST). 검색 결과의 `mst` 값' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  mst: string;
}

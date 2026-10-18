import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

export class RegisterLawDto {
  @ApiProperty({ description: '법제처 MST(법령일련번호). /lawgokr/search 결과의 mst', example: '267900' })
  @IsString()
  @Matches(/^\d+$/, { message: 'mst는 숫자여야 합니다.' })
  mst: string;

  @ApiPropertyOptional({ description: '법령원 코드. 기본 law.go.kr', example: 'law.go.kr' })
  @IsOptional()
  @IsString()
  sourceCode?: string;
}

export class RunLawSyncDto {
  @ApiPropertyOptional({ description: '이번에 확인할 법령 수(확인이 오래된 순)', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: '이 법령만 확인한다(점검·시험) — 주면 limit 은 쓰지 않는다(T-151)' })
  @IsOptional()
  @IsUUID()
  lawId?: string;
}

export class LawSyncRunsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

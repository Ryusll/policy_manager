import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

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

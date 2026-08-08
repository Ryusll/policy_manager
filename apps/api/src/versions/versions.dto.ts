import { IsString, IsOptional, MinLength, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateVersionDto {
  @ApiProperty()
  @IsString()
  content: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  changeNote?: string;
}

export class UpdateVersionDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  changeNote?: string;
}

export class ApproveVersionDto {
  @ApiProperty({ description: '시행 승인 시 개정 사유(필수)' })
  @IsString()
  @MinLength(1, { message: '개정 사유를 입력하세요.' })
  changeNote: string;

  @ApiProperty({
    required: false,
    description: '시행일 (YYYY-MM-DD). 생략하면 승인일. 시점 조회의 기준이 된다.',
  })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}
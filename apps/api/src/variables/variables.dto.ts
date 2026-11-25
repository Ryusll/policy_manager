import { IsString, IsOptional, MinLength, MaxLength, IsBoolean, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateVariableDto {
  @ApiProperty({ example: 'DEPT_IN_CHARGE' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  key: string;

  @ApiProperty({ example: '담당 부서' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** 첫 값(선택) — 유효기간은 시작일(비우면 처음부터)부터 끝 없음 */
  @ApiProperty({ required: false, example: '운영팀' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  value?: string;

  @ApiProperty({ required: false, example: '2026-01-01' })
  @IsOptional()
  @IsString()
  validFrom?: string;
}

export class UpdateVariableDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

/** 값 추가·고치기 — 유효기간 [시작, 종료). 날짜를 비우면(빈 문자열·null) 시작은 처음부터, 종료는 끝 없음 */
export class UpsertValueDto {
  @ApiProperty({ required: false, example: '관리팀' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  value?: string;

  @ApiProperty({ required: false, nullable: true, example: '2026-07-01' })
  @IsOptional()
  @IsString()
  validFrom?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  validTo?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** 기간 미확정 값(옛 기본값)을 지금 기간 그대로 확정 */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  confirmPeriod?: boolean;
}

/** 지금 시행 중인 버전의 문구를 변수에 잇는다 — 위치는 저장된 본문 기준 UTF-16 [start, end) */
export class CreateBindingDto {
  @ApiProperty()
  @IsString()
  variableId: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  start: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  end: number;

  /** 화면이 본 그 구간의 문구 — 본문이 그 사이 바뀌었으면 409 */
  @ApiProperty({ example: '운영팀' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text: string;
}

import { IsString, IsOptional, MinLength, MaxLength, IsDateString } from 'class-validator';
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

/**
 * 아직 한 번도 시행된 적 없는 조문의 초안을 한꺼번에 시행한다.
 * 기존 규정을 옮겨 적거나 새 규정을 처음 만들 때, 조문마다 검토 요청·승인을 반복하지 않게 한다.
 */
export class PublishDraftsDto {
  @ApiProperty({ description: '시행 사유(필수). 예: 제정, 기존 규정 등록' })
  @IsString()
  @MinLength(1, { message: '시행 사유를 입력하세요.' })
  changeNote: string;

  /**
   * 이 조문들이 실제로 시행된 날. 필수이고 "오늘"로 채우지 않는다 — 이 경로로 들어오는 건 대개
   * 옮겨 적은 기존 규정이라, 오늘로 시행하면 그 전 날짜의 시점 조회에서 빠진다(PAT-02, 가져오기와 같은 규칙).
   */
  @ApiProperty({ description: '이 조문들이 실제로 시행된 날 (YYYY-MM-DD). 기존 규정을 옮겨 적었다면 원래 시행일' })
  @IsDateString({}, { message: '시행일(YYYY-MM-DD)을 입력하세요.' })
  effectiveDate: string;
}

/** 시행일 없이 발행된 버전의 시행일 보정 (PAT-02) */
export class FillEffectiveDateDto {
  @ApiProperty({ description: '본문이 실제로 시행된 날 (YYYY-MM-DD). 최초 제정일이 아니라 지금 본문의 시행일' })
  @IsDateString()
  effectiveDate: string;

  @ApiProperty({ description: '보정 근거(필수). 예: 이사회 의결록 2019-03-01 시행' })
  @IsString()
  @MinLength(1, { message: '보정 근거를 입력하세요.' })
  @MaxLength(500)
  reason: string;
}

export class RejectVersionDto {
  @ApiProperty({ description: '반려 사유(필수). 사유 없이 되돌리면 편집자는 왜 반려됐는지 알 수 없다.' })
  @IsString()
  @MinLength(1, { message: '반려 사유를 입력하세요.' })
  @MaxLength(2000)
  reason: string;
}

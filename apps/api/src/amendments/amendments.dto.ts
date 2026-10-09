import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class GenerateAmendmentsDto {
  @ApiProperty({ description: '후보를 만들 법령 변경 이벤트' })
  @IsUUID('4', { message: 'changeEventId 는 변경 이벤트 id 여야 합니다.' })
  changeEventId: string;

  @ApiPropertyOptional({
    description: '영향 분석 기준일(YYYY-MM-DD) — 이날 시행 중인 본문이 제1 조문. 생략하면 법령 시행일과 오늘 중 늦은 날',
    example: '2027-01-01',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '기준일(asOf)은 YYYY-MM-DD 형식이어야 합니다.' })
  asOf?: string;

  @ApiPropertyOptional({ description: '예정 사내 시행일(YYYY-MM-DD) — 변수 값을 고르는 날(T-109 ②). 생략하면 기준일', example: '2027-01-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '예정 사내 시행일은 YYYY-MM-DD 형식이어야 합니다.' })
  plannedEffectiveDate?: string;
}

/** 목록 상태 필터 — `open` 은 처리할 것(작성·검토), `all` 은 전부 */
export const AMENDMENT_LIST_STATES = ['open', 'draft', 'review', 'approved', 'rejected', 'all'] as const;
export type AmendmentListState = (typeof AMENDMENT_LIST_STATES)[number];

export class AmendmentListQueryDto {
  @ApiPropertyOptional({ enum: AMENDMENT_LIST_STATES, default: 'open', description: 'open = 작성·검토(처리할 것)' })
  @IsOptional()
  @IsIn(AMENDMENT_LIST_STATES as unknown as string[], { message: '상태 필터가 올바르지 않습니다.' })
  state?: AmendmentListState;

  @ApiPropertyOptional({ description: '이 규정의 후보만' })
  @IsOptional()
  @IsUUID('4', { message: 'policyId 는 규정 id 여야 합니다.' })
  policyId?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive'], description: '규정 시행 여부 — 생략하면 모두(비활성 규정의 후보도 숨기지 않는다)' })
  @IsOptional()
  @IsIn(['active', 'inactive'], { message: 'policyActive 는 active 또는 inactive 여야 합니다.' })
  policyActive?: 'active' | 'inactive';

  @ApiPropertyOptional({ description: '이 법령 변경 이벤트의 후보만' })
  @IsOptional()
  @IsUUID('4', { message: 'changeEventId 는 변경 이벤트 id 여야 합니다.' })
  changeEventId?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** 낙관적 잠금 — 화면이 본 판·잠금 버전. 그 사이 누가 고치거나 검토를 요청했으면 409 */
class LockedRequestDto {
  @ApiProperty({ description: '화면이 보고 있는 판 번호' })
  @IsInt()
  @Min(1)
  expectedRevision: number;

  @ApiProperty({ description: '화면이 보고 있는 잠금 버전' })
  @IsInt()
  @Min(0)
  expectedLockVersion: number;
}

export class EditAmendmentDto extends LockedRequestDto {
  @ApiProperty({ description: '손질한 후보 본문 — 새 판이 된다' })
  @IsString()
  @MinLength(1, { message: '후보 본문을 입력하세요.' })
  @MaxLength(20000)
  candidateContent: string;

  @ApiProperty({ description: '수정 사유 — 필수(누가 왜 고쳤는지가 승인 판단의 근거가 된다)' })
  @IsString()
  @MaxLength(500)
  note: string;
}

export class RequestReviewDto extends LockedRequestDto {
  @ApiPropertyOptional({ description: '요청 사유. 본문이 제1 조문과 (공백 말고) 다르지 않으면 필수 — "개정이 필요 없다"는 판단을 검토로 받는다' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ApproveAmendmentDto extends LockedRequestDto {
  @ApiProperty({ description: '사내 규정 시행일(YYYY-MM-DD) — 기본값 없음. 오늘이나 그 뒤(소급 안 됨)', example: '2027-01-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '사내 규정 시행일은 YYYY-MM-DD 형식이어야 합니다.' })
  effectiveDate: string;

  @ApiProperty({ description: '개정 사유 — 필수. 발행되는 버전의 개정 사유(changeNote)가 된다' })
  @IsString()
  @MaxLength(500)
  changeNote: string;

  @ApiPropertyOptional({ description: '사내 시행일이 법령 시행일보다 이를 때 그 이유 — 그 경우 필수' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  earlyReason?: string;
}

export class RejectAmendmentDto extends LockedRequestDto {
  @ApiProperty({ description: '반려 사유 — 필수("개정 불필요" 판단도 여기)' })
  @IsString()
  @MaxLength(1000)
  reason: string;
}

export class RegenerateAmendmentDto {
  @ApiPropertyOptional({ description: '이 날 시행 중인 본문을 기준으로(승인하려던 시행일). 생략하면 법령 시행일과 오늘 중 늦은 날' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '기준일(asOf)은 YYYY-MM-DD 형식이어야 합니다.' })
  asOf?: string;

  @ApiPropertyOptional({ description: '예정 사내 시행일 — 변수 값을 고르는 날(T-109 ②). 생략하면 asOf(주지 않았으면 기준일)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '예정 사내 시행일은 YYYY-MM-DD 형식이어야 합니다.' })
  plannedEffectiveDate?: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ASK_HISTORY_PAGE, ASK_HISTORY_PAGE_MAX } from './ask-history.service';

/** 내 지난 질문 목록(T-218) */
export class AskHistoryQueryDto {
  @ApiPropertyOptional({ description: '이 기록 다음(더 오래된 것)부터 — 앞 쪽 응답의 nextCursor' })
  @IsOptional()
  @IsUUID('4', { message: 'cursor 는 지난 질문 id 여야 합니다.' })
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: ASK_HISTORY_PAGE_MAX, default: ASK_HISTORY_PAGE })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ASK_HISTORY_PAGE_MAX)
  limit?: number;
}

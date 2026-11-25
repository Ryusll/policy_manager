import { Controller, Get, Param, ParseUUIDPipe, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AskHistoryService } from './ask-history.service';
import { AskHistoryQueryDto } from './ask-history.dto';

/**
 * T-218 내 지난 질문(SRS SEARCH-10). 모든 역할이 자기 질문만 본다 — 관리자도 남의 질문은 보지 못한다.
 * 기록을 읽기만 하고 AI 를 부르지 않으므로 월 한도에 세지 않는다.
 */
@ApiTags('ask')
@ApiBearerAuth()
@Controller('ask/history')
export class AskHistoryController {
  constructor(private readonly history: AskHistoryService) {}

  @Get()
  @ApiOperation({
    summary: '내 지난 질문 목록 — 본인 것만, 최신순, 보관 기간(90일) 안',
    description:
      '응답 { items: [{ id, question, createdAt, outcome }], nextCursor }. outcome 은 answered·no_regulations·no_candidates·' +
      'no_basis·refused·failed(오류)·unfinished(처리 중이었거나 끊김) — 기록의 오류 문구는 내보내지 않는다. ' +
      '다음 쪽은 cursor=nextCursor. 꺼진 회사 403 AI_QA_DISABLED, 고지 재확인 대기 403 AI_QA_NOTICE_CHANGED, ' +
      '모르는 cursor 400 AI_QA_HISTORY_CURSOR.',
  })
  list(@Request() req: { user: { tenantId: string; id: string } }, @Query() query: AskHistoryQueryDto) {
    return this.history.list(req.user.tenantId, req.user.id, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: '지난 질문 다시 보기 — 물은 때의 답과 근거 그대로(AI 를 부르지 않고 한도에 세지 않는다)',
    description:
      '응답 { id, question, createdAt, outcome, snapshot, result }. result 는 질문 응답과 같은 모양(usage 없음)이고 오류·처리 중이면 null, ' +
      'snapshot=false 는 근거를 남기기 전의 기록(답 본문만). 남의 것·다른 회사 것·보관 기간이 지난 것은 404 AI_QA_HISTORY_NOT_FOUND.',
  })
  get(@Request() req: { user: { tenantId: string; id: string } }, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.history.get(req.user.tenantId, req.user.id, id);
  }
}

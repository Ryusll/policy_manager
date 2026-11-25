import { Body, Controller, Get, HttpCode, Patch, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/guards/decorators';
import { AskService } from './ask.service';
import { AskDto, AskSettingsDto } from './ask.dto';

/**
 * T-130 규정 근거 AI 질의응답.
 *
 * 묻기는 열람자를 포함한 모든 직원에게 연다 — 직원이 규정을 묻는 기능이고, 근거는 열람자도 볼 수 있는
 * 시행 중 본문뿐이다. 켜고 끄기는 회사 관리자만(질문할 때 관련 조문이 외부 AI 로 간다). 회사마다 꺼진 채
 * 시작하고, 관리자가 외부 전송 고지를 확인해야 켜진다(T-146, D-09 재결정 2026-10-14).
 */
@ApiTags('ask')
@ApiBearerAuth()
@Controller('ask')
export class AskController {
  constructor(private readonly askService: AskService) {}

  @Get('status')
  @ApiOperation({
    summary:
      '규정 질문 설정 상태 — 서버 설정 여부·회사 켜짐(고지 판까지 맞을 때만)·다시 확인 필요·외부 전송 고지·' +
      '이번 달 회사/내 사용량과 한도 (키 노출 없음)',
  })
  status(@Request() req: { user: { tenantId: string; id: string } }) {
    return this.askService.status(req.user.tenantId, req.user.id);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: '규정에 대해 묻기 — 시행 중 조문만 근거로 답과 근거 조문을 돌려준다',
    description:
      '근거가 없으면 answerable=false(reason: no_regulations·no_candidates·no_basis·refused). ' +
      '꺼져 있으면 403 AI_QA_DISABLED, 고지가 바뀌어 관리자가 다시 확인해야 하면 403 AI_QA_NOTICE_CHANGED, ' +
      '이번 달 회사 한도를 넘으면 429 AI_QA_MONTHLY_LIMIT, ' +
      '내 한도를 넘으면 429 AI_QA_USER_MONTHLY_LIMIT, 서버 미설정이면 503. ' +
      'AI 를 부르기 전에 한도에 세고, AI 를 부르지 않고 끝난 질문만 돌려준다(실패·거절도 센다). ' +
      'policyIds(T-219)를 주면 그 규정 안에서만 찾는다 — 그 회사의 활성 규정이 아닌 것이 섞이면 400 AI_QA_SCOPE_INVALID(기록·한도 차감 없음, ' +
      '꺼짐·고지 403 다음·한도 429 앞에 본다). 응답의 scope 는 물을 때 고른 범위의 그때 이름·코드(비었으면 회사 전체). ' +
      'parentId(T-220)를 주면 그 답의 근거 조문을 이번 후보로 이어받는다 — 본인의 답을 냈고 근거(회사 조문)를 남긴 기록(90일 안)이 아니면 400 AI_QA_PARENT_INVALID. ' +
      '응답의 id 를 다음 질문의 parentId 로 보낸다.',
  })
  ask(@Request() req: { user: { tenantId: string; id: string } }, @Body() dto: AskDto) {
    return this.askService.ask(req.user.tenantId, req.user.id, dto.question, dto.policyIds, dto.parentId);
  }

  @Patch('settings')
  @Roles('admin')
  @ApiOperation({
    summary:
      '회사의 규정 질문(AI) 켜기/끄기 (관리자). 켤 때는 확인한 고지 판(noticeVersion)이 지금 판이어야 한다 — ' +
      '아니면 400 AI_QA_NOTICE_REQUIRED. 확인한 사람·시각·판을 남기고 감사 ai_qa.settings_change',
  })
  settings(@Request() req: { user: { tenantId: string; id: string } }, @Body() dto: AskSettingsDto) {
    return this.askService.setEnabled(req.user.tenantId, req.user.id, dto.enabled, dto.noticeVersion);
  }
}

import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Request, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/guards/decorators';
import { AmendmentsService } from './amendments.service';
import { AmendmentCorrectionService } from './amendment-correction';
import { AmendmentDocumentService } from './amendment-document.service';
import {
  AmendmentDocumentDto,
  AmendmentListQueryDto,
  ApproveAmendmentDto,
  CorrectRejectionDto,
  EditAmendmentDto,
  GenerateAmendmentsDto,
  RegenerateAmendmentDto,
  RejectAmendmentDto,
  RequestReviewDto,
} from './amendments.dto';

/**
 * 개정 후보 (T-106·T-107·T-108). admin·editor 만 — 개정 초안은 확정 전 내부 문서다(설계안 6절).
 * 승인·반려는 관리자만 — 일반 조문 승인(`versions/:id/approve`)과 같다.
 */
@ApiTags('amendments')
@ApiBearerAuth()
@Controller('amendments')
@Roles('admin', 'editor')
export class AmendmentsController {
  constructor(
    private readonly service: AmendmentsService,
    private readonly correction: AmendmentCorrectionService,
    private readonly documents: AmendmentDocumentService,
  ) {}

  @Post('generate')
  @HttpCode(200)
  @ApiOperation({
    summary: '법령 변경 이벤트로 우리 회사 영향 조문의 개정 후보를 만든다(규칙 기반). 이미 있는 후보는 다시 만들지 않는다',
  })
  generate(@Request() req: any, @Body() dto: GenerateAmendmentsDto) {
    return this.service.generateForEvent(req.user.tenantId, dto.changeEventId, {
      asOf: dto.asOf,
      plannedEffectiveDate: dto.plannedEffectiveDate,
      userId: req.user.id,
    });
  }

  @Post('document/pdf')
  @HttpCode(200) // 파일을 돌려주므로 201 이 아니다
  @ApiOperation({
    summary: '개정안 문서 PDF(T-162) — 같은 규정의 후보를 신구조문대비표(현행·개정안·비고)·개정 이유·법령 근거로. 반려·다른 규정이 섞이면 400',
  })
  async documentPdf(@Request() req: { user: { tenantId: string; id: string } }, @Body() dto: AmendmentDocumentDto, @Res() res: Response) {
    const { pdf, policy } = await this.documents.renderPdf(req.user.tenantId, req.user.id, dto.candidateIds);
    // 제목을 먼저 자르고 접미사를 붙인다 — 긴 제목에서 '_개정안'이 잘리지 않게
    const base = `${`${policy.code || 'policy'}_${policy.title || ''}`.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 72)}_개정안`;
    res.setHeader('Content-Type', 'application/pdf');
    // RFC 5987 — encodeURIComponent 가 남기는 ' ( ) * 도 인코딩한다
    const encoded = encodeURIComponent(base).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    res.setHeader('Content-Disposition', `attachment; filename="amendment.pdf"; filename*=UTF-8''${encoded}.pdf`);
    res.setHeader('Content-Length', String(pdf.length));
    res.end(pdf);
  }

  @Get()
  @ApiOperation({ summary: '개정 후보 목록 — 기본은 처리할 것(작성·검토). 규정·이벤트 필터, 페이지' })
  list(@Request() req: any, @Query() query: AmendmentListQueryDto) {
    return this.service.list(req.user.tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '개정 후보 — 제1 조문·후보 본문·변경 근거·비교 정보' })
  get(@Request() req: any, @Param('id') id: string) {
    return this.service.get(req.user.tenantId, id);
  }

  @Get(':id/history')
  @ApiOperation({ summary: '판(생성본부터 손질할 때마다)과 상태 전환 이력 — 판마다 직전 판 대비 바뀐 곳' })
  history(@Request() req: any, @Param('id') id: string) {
    return this.service.history(req.user.tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: '손질 — 새 판을 만든다(수정 사유 필수). 검토 중이면 작성으로 되돌린다. 화면이 본 판·잠금 버전이 다르면 409',
  })
  edit(@Request() req: any, @Param('id') id: string, @Body() dto: EditAmendmentDto) {
    return this.service.edit(req.user.tenantId, id, req.user.id, dto);
  }

  @Post(':id/review')
  @HttpCode(200)
  @ApiOperation({ summary: '검토 요청(작성 → 검토) — 검토 대상 판을 남긴다. 본문이 기준 본문과 같으면 이유 필수' })
  requestReview(@Request() req: any, @Param('id') id: string, @Body() dto: RequestReviewDto) {
    return this.service.requestReview(req.user.tenantId, id, req.user.id, dto);
  }

  @Post(':id/regenerate')
  @HttpCode(200)
  @ApiOperation({ summary: '다시 만들기 — 같은 변경·조문으로 지금 기준 본문의 후보(옛 후보는 그대로)' })
  regenerate(@Request() req: any, @Param('id') id: string, @Body() dto: RegenerateAmendmentDto) {
    return this.service.regenerate(req.user.tenantId, id, req.user.id, dto.asOf, dto.plannedEffectiveDate);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles('admin')
  @ApiOperation({
    summary: '승인 → 같은 조문의 후속 버전 발행(관리자). 검토를 요청한 판만, 사내 시행일 필수·소급 안 됨, 기준 본문이 어긋나면 409(reason)',
  })
  approve(@Request() req: any, @Param('id') id: string, @Body() dto: ApproveAmendmentDto) {
    return this.service.approve(req.user.tenantId, id, req.user.id, dto);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles('admin')
  @ApiOperation({ summary: '반려(관리자) — 검토 중인 후보만, 사유 필수. 발행본은 그대로' })
  reject(@Request() req: any, @Param('id') id: string, @Body() dto: RejectAmendmentDto) {
    return this.service.reject(req.user.tenantId, id, req.user.id, dto);
  }

  @Post(':id/correct-rejection')
  @HttpCode(200)
  @Roles('admin')
  @ApiOperation({
    summary: '반려 정정(관리자, T-178) — 본문을 바꾸지 않고 반려를 되돌려 작성 상태로. 사유 필수, 원 반려 기록은 그대로',
  })
  async correctRejection(@Request() req: { user: { tenantId: string; id: string } }, @Param('id') id: string, @Body() dto: CorrectRejectionDto) {
    await this.correction.correctRejection(req.user.tenantId, id, req.user.id, dto);
    return this.service.get(req.user.tenantId, id);
  }
}

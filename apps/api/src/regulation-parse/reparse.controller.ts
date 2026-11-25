import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/guards/decorators';
import { ApproveReparseDto, CompareReparseDto, RejectReparseDto, ReparseDecisionsDto, ResolveMissingDto } from './regulation-parse.dto';
import { ReparseService } from './reparse.service';
import { ReparseBundleService } from './reparse-bundle.service';

/** 재파싱 검토(T-110) — 다시 가져온 원문을 기존 규정의 조문과 맞춘 결과와 결정 */
@ApiTags('reparse')
@ApiBearerAuth()
@Controller()
export class ReparseController {
  constructor(
    private readonly reparse: ReparseService,
    private readonly bundle: ReparseBundleService,
  ) {}

  @Post('regulation-parse/:id/reparse')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '다시 가져온 원문을 기존 규정과 비교(계층·내용 지문) — 규정 데이터는 바꾸지 않는다' })
  compare(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompareReparseDto) {
    return this.reparse.compare(req.user.tenantId, req.user.id, id, dto.policyId);
  }

  @Get('reparse-reviews/:id')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '재파싱 검토 — 항목별 판정·근거·결정, 비교 뒤 규정·원문이 바뀌었는지' })
  get(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.reparse.get(req.user.tenantId, id);
  }

  @Patch('reparse-reviews/:id/decisions')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '재파싱 검토 항목의 결정(옮김·개정·새 조문·고르기·잇기·보류·그대로 둠·폐지)' })
  decide(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReparseDecisionsDto) {
    return this.reparse.decide(req.user.tenantId, req.user.id, req.user.role, id, dto.items);
  }

  @Post('reparse-reviews/:id/apply')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '반영(T-110 ②) — 기존 조문의 묶음 초안(본문·제안 계층)을 만들고 새 조문·장·절은 계획에. 지금 본문·계층은 그대로' })
  apply(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.bundle.apply(req.user.tenantId, req.user.id, id);
  }

  @Post('reparse-reviews/:id/submit')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '묶음 검토 요청 — 묶음 초안을 한꺼번에 검토 중으로' })
  submit(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.bundle.submit(req.user.tenantId, req.user.id, id);
  }

  @Post('reparse-reviews/:id/approve')
  @Roles('admin')
  @ApiOperation({ summary: '묶음 승인 — 같은 시행일로 후속 버전 발행·새 조문·장·절·폐지(전부 되거나 전부 안 됨)' })
  approve(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveReparseDto) {
    return this.bundle.approve(req.user.tenantId, req.user.id, id, dto);
  }

  @Post('reparse-reviews/:id/reject')
  @Roles('admin')
  @ApiOperation({ summary: '묶음 반려 — 묶음 초안을 반려하고 원문을 다시 비교할 수 있게' })
  reject(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectReparseDto) {
    return this.bundle.reject(req.user.tenantId, req.user.id, id, dto.reason);
  }

  @Post('reparse-reviews/:id/items/:itemId/resolve')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '승인·반려 뒤 원문에 없는 조문 — 유지로 닫거나 오늘 폐지(관리자)' })
  resolveMissing(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: ResolveMissingDto,
  ) {
    return this.bundle.resolveMissing(req.user.tenantId, req.user.id, req.user.role, id, itemId, dto.decision);
  }

  @Get('policies/:policyId/reparse-reviews')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '이 규정의 재파싱 검토 목록(최근 20건)' })
  list(@Request() req: any, @Param('policyId', ParseUUIDPipe) policyId: string) {
    return this.reparse.listForPolicy(req.user.tenantId, policyId);
  }
}

import {
  Controller, Get, Post, Put, Param, Body, Request, HttpCode, Query, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VersionsService } from './versions.service';
import {
  CreateVersionDto,
  UpdateVersionDto,
  ApproveVersionDto,
  RejectVersionDto,
  PublishDraftsDto,
  FillEffectiveDateDto,
  ArchiveVersionDto,
  WithdrawVersionDto,
} from './versions.dto';
import { Roles } from '../common/guards/decorators';

/** 초안·검토 중 본문은 편집 권한자에게만(T-138) — 열람자에게는 발행 이력만 준다(규정 상세의 T-117 과 같은 기준) */
const issuedOnlyFor = (role: string | undefined) => ({ issuedOnly: role !== 'admin' && role !== 'editor' });

@ApiTags('versions')
@ApiBearerAuth()
@Controller()
export class VersionsController {
  constructor(private versionsService: VersionsService) {}

  @Get('articles/:articleId/versions')
  @ApiOperation({ summary: 'List versions for an article' })
  findByArticle(@Request() req: any, @Param('articleId') articleId: string) {
    return this.versionsService.findByArticle(req.user.tenantId, articleId, issuedOnlyFor(req.user.role));
  }

  @Post('articles/:articleId/versions')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: 'Create new version' })
  create(
    @Request() req: any,
    @Param('articleId') articleId: string,
    @Body() dto: CreateVersionDto,
  ) {
    return this.versionsService.create(req.user.tenantId, articleId, dto, req.user.id);
  }

  // versions/:id 보다 먼저 선언해야 한다 — 뒤에 두면 "diff" 가 버전 id 로 잡혀 늘 404 였다(T-134)
  @Get('versions/diff')
  @ApiOperation({ summary: 'Diff two versions' })
  diff(
    @Request() req: any,
    @Query('v1') v1: string,
    @Query('v2') v2: string,
  ) {
    // 빈 id 로 찾으면 id 조건 없이 그 회사의 아무 버전이나 골라 비교한다
    if (!v1 || !v2) throw new BadRequestException('비교할 두 버전(v1·v2)을 주세요.');
    return this.versionsService.diff(req.user.tenantId, v1, v2, issuedOnlyFor(req.user.role));
  }

  @Get('versions/:id')
  @ApiOperation({ summary: 'Get version detail' })
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.versionsService.findOne(req.user.tenantId, id, issuedOnlyFor(req.user.role));
  }

  @Put('versions/:id')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: 'Update draft version' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateVersionDto) {
    return this.versionsService.update(req.user.tenantId, id, dto, req.user.id);
  }

  @Post('versions/:id/submit')
  @Roles('admin', 'editor')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit version for review' })
  submitForReview(@Request() req: any, @Param('id') id: string) {
    return this.versionsService.submitForReview(req.user.tenantId, id, req.user.id);
  }

  @Post('versions/:id/approve')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve version (publish) — 개정 사유 필수' })
  approve(@Request() req: any, @Param('id') id: string, @Body() dto: ApproveVersionDto) {
    return this.versionsService.approve(
      req.user.tenantId,
      id,
      req.user.id,
      dto.changeNote,
      dto.effectiveDate,
    );
  }

  @Post('policies/:policyId/publish-drafts')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: '시행본이 없는 조문(새 조문, 폐지 뒤 다시 쓴 조문)의 초안을 한꺼번에 시행 — 폐지한 조문은 폐지일 이후 시행일만 (T-126)' })
  publishDrafts(@Request() req: any, @Param('policyId') policyId: string, @Body() dto: PublishDraftsDto) {
    return this.versionsService.publishInitialDrafts(
      req.user.tenantId,
      policyId,
      req.user.id,
      dto.changeNote,
      dto.effectiveDate,
    );
  }

  @Post('policies/:policyId/fill-effective-date')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: '시행일 없이 발행된 버전에 확인한 시행일 넣기 (가져오기 데이터 보정)' })
  fillEffectiveDate(@Request() req: any, @Param('policyId') policyId: string, @Body() dto: FillEffectiveDateDto) {
    return this.versionsService.fillMissingEffectiveDates(
      req.user.tenantId,
      policyId,
      req.user.id,
      dto.effectiveDate,
      dto.reason,
    );
  }

  @Post('versions/:id/reject')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: '반려 — 초안으로 되돌린다. 사유 필수 (T-10)' })
  reject(@Request() req: any, @Param('id') id: string, @Body() dto: RejectVersionDto) {
    return this.versionsService.reject(req.user.tenantId, id, req.user.id, dto.reason);
  }

  @Post('versions/:id/archive')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '폐지 — 게시본을 내리고 폐지 시행일(비우면 오늘, 한국 날짜)부터 조문을 시행에서 뺀다(repealedOn). 미래 날짜면 그날까지 지금 본문이 시행 중(T-132 ③). 응답의 remainingPublished 가 0이면 조문에 게시본이 없다 (T-10, T-126)',
  })
  archive(@Request() req: any, @Param('id') id: string, @Body() dto: ArchiveVersionDto) {
    return this.versionsService.archive(req.user.tenantId, id, req.user.id, { repealedOn: dto?.repealedOn });
  }

  @Post('versions/:id/cancel-repeal')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: '폐지 예정 취소 — 아직 오지 않은 폐지 시행일을 지운다. 지난 폐지는 취소하지 않는다 (T-132 ③)' })
  cancelRepeal(@Request() req: any, @Param('id') id: string) {
    return this.versionsService.cancelRepeal(req.user.tenantId, id, req.user.id);
  }

  @Post('versions/:id/withdraw')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: '시행 예정 철회 — 승인했지만 시행일 전인 마지막 버전을 초안으로 되돌린다 (T-132 ②)' })
  withdraw(@Request() req: any, @Param('id') id: string, @Body() dto: WithdrawVersionDto) {
    return this.versionsService.withdraw(req.user.tenantId, id, req.user.id, dto.reason);
  }
}

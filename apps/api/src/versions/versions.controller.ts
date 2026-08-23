import {
  Controller, Get, Post, Put, Delete, Param, Body, Request, HttpCode, Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VersionsService } from './versions.service';
import { CreateVersionDto, UpdateVersionDto, ApproveVersionDto, RejectVersionDto } from './versions.dto';
import { Roles } from '../common/guards/decorators';

@ApiTags('versions')
@ApiBearerAuth()
@Controller()
export class VersionsController {
  constructor(private versionsService: VersionsService) {}

  @Get('articles/:articleId/versions')
  @ApiOperation({ summary: 'List versions for an article' })
  findByArticle(@Request() req: any, @Param('articleId') articleId: string) {
    return this.versionsService.findByArticle(req.user.tenantId, articleId);
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

  @Get('versions/:id')
  @ApiOperation({ summary: 'Get version detail' })
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.versionsService.findOne(req.user.tenantId, id);
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
  @ApiOperation({ summary: '폐지 — 게시본을 내린다. 응답의 remainingPublished 가 0이면 조문에 게시본이 없다 (T-10)' })
  archive(@Request() req: any, @Param('id') id: string) {
    return this.versionsService.archive(req.user.tenantId, id, req.user.id);
  }

  @Get('versions/diff')
  @ApiOperation({ summary: 'Diff two versions' })
  diff(
    @Request() req: any,
    @Query('v1') v1: string,
    @Query('v2') v2: string,
  ) {
    return this.versionsService.diff(req.user.tenantId, v1, v2);
  }
}

import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LawLinksService } from './law-links.service';
import { CreateLawLinkDto, SuggestLawLinksDto, UpdateLawLinkDto } from './law-links.dto';
import { Roles } from '../common/guards/decorators';

/**
 * 법령 관계 정보 (T-101). 전량 admin·editor — 개정 후보 생성(T-105 이후)의 입력이 되는
 * 데이터라 편집 권한이 있는 사람만 만들고 확정한다. viewer 에게는 열지 않는다.
 */
@ApiTags('law-links')
@ApiBearerAuth()
@Controller('law-links')
@Roles('admin', 'editor')
export class LawLinksController {
  constructor(private readonly service: LawLinksService) {}

  @Get()
  @ApiOperation({ summary: '법령 관계 조회 — articleId 또는 lawArticleId 중 하나 필수' })
  @ApiQuery({ name: 'articleId', required: false })
  @ApiQuery({ name: 'lawArticleId', required: false })
  list(@Request() req: any, @Query('articleId') articleId?: string, @Query('lawArticleId') lawArticleId?: string) {
    const tenantId = req.user.tenantId;
    if (articleId && lawArticleId) {
      throw new BadRequestException('articleId 와 lawArticleId 는 동시에 줄 수 없습니다.');
    }
    if (articleId) return this.service.byArticle(tenantId, articleId);
    if (lawArticleId) return this.service.byLawArticle(tenantId, lawArticleId);
    throw new BadRequestException('articleId 또는 lawArticleId 중 하나가 필요합니다.');
  }

  @Post()
  @ApiOperation({ summary: '연결 생성 (수동) — 바로 확정 상태로 저장된다' })
  create(@Request() req: any, @Body() dto: CreateLawLinkDto) {
    return this.service.create(req.user.tenantId, req.user.id, dto);
  }

  @Post('suggest')
  @ApiOperation({ summary: '본문 인용 패턴으로 자동 추천 (suggested 상태로 생성)' })
  suggest(@Request() req: any, @Body() dto: SuggestLawLinksDto) {
    return this.service.suggest(req.user.tenantId, dto.articleId);
  }

  @Patch(':id')
  @ApiOperation({ summary: '확정·반려·관계 유형 수정' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateLawLinkDto) {
    return this.service.update(req.user.tenantId, id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '연결 삭제' })
  remove(@Request() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.tenantId, id);
  }
}

import { Body, Controller, Get, Param, Patch, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/guards/decorators';
import { CommentsService } from './comments.service';
import { CreateArticleCommentDto, UpdateArticleCommentDto } from './comments.dto';

@ApiTags('comments')
@ApiBearerAuth()
@Controller()
export class CommentsController {
  constructor(private commentsService: CommentsService) {}

  @Get('articles/:articleId/comments')
  @ApiOperation({ summary: 'List article comments' })
  list(@Request() req: any, @Param('articleId') articleId: string) {
    return this.commentsService.listByArticle(req.user.tenantId, articleId);
  }

  @Post('articles/:articleId/comments')
  @Roles('admin', 'editor', 'viewer')
  @ApiOperation({ summary: 'Create article comment' })
  create(
    @Request() req: any,
    @Param('articleId') articleId: string,
    @Body() dto: CreateArticleCommentDto,
  ) {
    return this.commentsService.create(req.user.tenantId, articleId, req.user.id, dto);
  }

  @Patch('comments/:id')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: 'Resolve/unresolve article comment' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateArticleCommentDto) {
    return this.commentsService.update(req.user.tenantId, id, dto);
  }
}


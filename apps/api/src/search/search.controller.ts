import { Controller, Get, Query, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private searchService: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Full-text search across policies and versions' })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  search(
    @Request() req: any,
    @Query('q') q: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.searchService.search(req.user.tenantId, q, +page, +limit);
  }

  @Get('related-preview')
  @ApiOperation({ summary: 'Related preview for 판/법/규' })
  @ApiQuery({ name: 'type', required: true, enum: ['precedent', 'law', 'rule'] })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'sort', required: false, enum: ['relevance', 'latest'] })
  @ApiQuery({ name: 'scope', required: false, enum: ['title', 'fulltext'] })
  relatedPreview(
    @Request() req: any,
    @Query('type') type: 'precedent' | 'law' | 'rule',
    @Query('q') q: string,
    @Query('limit') limit = '5',
    @Query('sort') sort: 'relevance' | 'latest' = 'relevance',
    @Query('scope') scope: 'title' | 'fulltext' = 'fulltext',
  ) {
    return this.searchService.relatedPreview(req.user.tenantId, type, q, +limit, sort, scope);
  }
}
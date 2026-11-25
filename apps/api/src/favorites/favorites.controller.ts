import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { FavoritesService } from './favorites.service';

export class AddFavoriteDto {
  @ApiProperty()
  @IsString()
  policyId: string;

  @ApiProperty({ required: false, description: '조문 즐겨찾기면 조문 ID, 규정 전체면 생략' })
  @IsOptional()
  @IsString()
  articleId?: string;
}

@ApiTags('favorites')
@ApiBearerAuth()
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: '내 즐겨찾기 목록' })
  list(@Request() req: any) {
    return this.favoritesService.list(req.user.tenantId, req.user.id);
  }

  @Get('lookup')
  @ApiOperation({ summary: '이 대상이 담겨 있는지 확인 (별 표시용)' })
  lookup(
    @Request() req: any,
    @Query('policyId') policyId: string,
    @Query('articleId') articleId?: string,
  ) {
    return this.favoritesService.find(req.user.tenantId, req.user.id, policyId, articleId || null);
  }

  @Post()
  @ApiOperation({ summary: '즐겨찾기에 담기 (이미 있으면 그대로)' })
  add(@Request() req: any, @Body() dto: AddFavoriteDto) {
    return this.favoritesService.add(req.user.tenantId, req.user.id, dto.policyId, dto.articleId);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '즐겨찾기 빼기' })
  async remove(@Request() req: any, @Param('id') id: string) {
    await this.favoritesService.remove(req.user.tenantId, req.user.id, id);
  }
}

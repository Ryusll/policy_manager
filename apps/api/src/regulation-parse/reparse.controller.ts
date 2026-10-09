import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/guards/decorators';
import { CompareReparseDto, ReparseDecisionsDto } from './regulation-parse.dto';
import { ReparseService } from './reparse.service';

/** 재파싱 검토(T-110) — 다시 가져온 원문을 기존 규정의 조문과 맞춘 결과와 결정 */
@ApiTags('reparse')
@ApiBearerAuth()
@Controller()
export class ReparseController {
  constructor(private readonly reparse: ReparseService) {}

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

  @Get('policies/:policyId/reparse-reviews')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '이 규정의 재파싱 검토 목록(최근 20건)' })
  list(@Request() req: any, @Param('policyId', ParseUUIDPipe) policyId: string) {
    return this.reparse.listForPolicy(req.user.tenantId, policyId);
  }
}

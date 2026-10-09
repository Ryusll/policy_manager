import {
  Controller, Get, Post, Put, Delete, Param, Body, Request, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VariablesService } from './variables.service';
import { CreateBindingDto, CreateVariableDto, UpdateVariableDto, UpsertValueDto } from './variables.dto';
import { Roles } from '../common/guards/decorators';

@ApiTags('variables')
@ApiBearerAuth()
@Controller()
export class VariablesController {
  constructor(private variablesService: VariablesService) {}

  @Get('variables')
  @ApiOperation({ summary: '변수 목록 — 값·유효기간, 오늘 쓸 값, 검토 필요(기간 겹침·미확정), 시행 중 본문의 연결 수 (T-109)' })
  findAll(@Request() req: any) {
    return this.variablesService.findAll(req.user.tenantId);
  }

  @Get('variables/:id')
  @ApiOperation({ summary: '변수 하나 — 값·유효기간과 시행 중 본문의 연결 (T-109)' })
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.variablesService.findOne(req.user.tenantId, id);
  }

  @Post('variables')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '변수 등록 — 첫 값(선택)과 시작일' })
  create(@Request() req: any, @Body() dto: CreateVariableDto) {
    return this.variablesService.create(req.user.tenantId, dto, req.user.id);
  }

  @Put('variables/:id')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '변수 표시명·설명 고치기' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateVariableDto) {
    return this.variablesService.update(req.user.tenantId, id, dto);
  }

  @Delete('variables/:id')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: '변수 삭제 — 값·연결도 함께 지워진다' })
  remove(@Request() req: any, @Param('id') id: string) {
    return this.variablesService.remove(req.user.tenantId, id, req.user.id);
  }

  @Post('variables/:id/values')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '값 추가 — 유효기간 [시작, 종료), 겹치면 저장하되 검토 필요로 (T-109)' })
  addValue(@Request() req: any, @Param('id') id: string, @Body() dto: UpsertValueDto) {
    return this.variablesService.addValue(req.user.tenantId, id, dto, req.user.id);
  }

  @Put('variables/:id/values/:valueId')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '값 고치기 — 기간을 넣거나 confirmPeriod 면 기간 미확정 값이 확정된다 (T-109)' })
  updateValue(@Request() req: any, @Param('id') id: string, @Param('valueId') valueId: string, @Body() dto: UpsertValueDto) {
    return this.variablesService.updateValue(req.user.tenantId, id, valueId, dto, req.user.id);
  }

  @Delete('variables/:id/values/:valueId')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '값 지우기 (T-109)' })
  removeValue(@Request() req: any, @Param('id') id: string, @Param('valueId') valueId: string) {
    return this.variablesService.removeValue(req.user.tenantId, id, valueId, req.user.id);
  }

  @Get('versions/:versionId/variable-bindings')
  @ApiOperation({ summary: '이 버전 본문의 변수 연결 (T-109)' })
  listBindings(@Request() req: any, @Param('versionId') versionId: string) {
    return this.variablesService.listForVersion(req.user.tenantId, versionId);
  }

  @Post('versions/:versionId/variable-bindings')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '시행 중인 버전의 문구를 변수에 잇기 — 구간 [start, end)와 그 문구 (T-109)' })
  createBinding(@Request() req: any, @Param('versionId') versionId: string, @Body() dto: CreateBindingDto) {
    return this.variablesService.createBinding(req.user.tenantId, versionId, dto, req.user.id);
  }

  @Delete('variable-bindings/:id')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '변수 연결 풀기 — 이력으로 남긴다 (T-109)' })
  releaseBinding(@Request() req: any, @Param('id') id: string) {
    return this.variablesService.releaseBinding(req.user.tenantId, id, req.user.id);
  }
}

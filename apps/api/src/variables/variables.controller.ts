import {
  Controller, Get, Post, Put, Delete, Param, Body, Request, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VariablesService } from './variables.service';
import { CreateVariableDto, UpdateVariableDto } from './variables.dto';
import { Roles } from '../common/guards/decorators';

@ApiTags('variables')
@ApiBearerAuth()
@Controller('variables')
export class VariablesController {
  constructor(private variablesService: VariablesService) {}

  @Get()
  @ApiOperation({ summary: 'List all variables' })
  findAll(@Request() req: any) {
    return this.variablesService.findAll(req.user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get variable with usage info' })
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.variablesService.findOne(req.user.tenantId, id);
  }

  @Post()
  @Roles('admin', 'editor')
  @ApiOperation({ summary: 'Create variable' })
  create(@Request() req: any, @Body() dto: CreateVariableDto) {
    return this.variablesService.create(req.user.tenantId, dto);
  }

  @Put(':id')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: 'Update variable' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateVariableDto) {
    return this.variablesService.update(req.user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete variable' })
  remove(@Request() req: any, @Param('id') id: string) {
    return this.variablesService.remove(req.user.tenantId, id);
  }

  @Post(':id/usages')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: 'Track variable usage in a version' })
  trackUsage(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { versionId: string; variableIds: string[] },
  ) {
    return this.variablesService.trackUsage(req.user.tenantId, body.versionId, body.variableIds);
  }
}
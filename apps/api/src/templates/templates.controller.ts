import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MinPlan, Roles } from '../common/guards/decorators';
import { CloneTemplateDto, CreateTemplateDto, UpdateTemplateDto } from './templates.dto';
import { TemplatesService } from './templates.service';

@ApiTags('templates')
@ApiBearerAuth()
@MinPlan('pro')
@Controller('templates')
export class TemplatesController {
  constructor(private templatesService: TemplatesService) {}

  @Get()
  @ApiOperation({ summary: '회사 템플릿 목록 조회' })
  findAll(@Request() req: any) {
    return this.templatesService.findAll(req.user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: '템플릿 상세 조회' })
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.templatesService.findOne(req.user.tenantId, id);
  }

  @Get(':id/revisions')
  @ApiOperation({ summary: '템플릿 변경 이력 조회' })
  listRevisions(@Request() req: any, @Param('id') id: string) {
    return this.templatesService.listRevisions(req.user.tenantId, id);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: '템플릿 생성' })
  create(@Request() req: any, @Body() dto: CreateTemplateDto) {
    return this.templatesService.create(req.user.tenantId, dto, req.user.id);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: '템플릿 수정' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.templatesService.update(req.user.tenantId, id, dto, req.user.id);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: '템플릿 삭제' })
  remove(@Request() req: any, @Param('id') id: string) {
    return this.templatesService.remove(req.user.tenantId, id, req.user.id);
  }

  @Post(':id/clone')
  @Roles('admin')
  @ApiOperation({ summary: '템플릿 복제' })
  clone(@Request() req: any, @Param('id') id: string, @Body() dto: CloneTemplateDto) {
    return this.templatesService.clone(req.user.tenantId, id, dto, req.user.id);
  }

  @Post(':id/set-default')
  @Roles('admin')
  @ApiOperation({ summary: '기본 템플릿 지정' })
  setDefault(@Request() req: any, @Param('id') id: string) {
    return this.templatesService.setDefault(req.user.tenantId, id, req.user.id);
  }
}

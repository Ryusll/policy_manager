import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { ImportPoliciesDto } from './admin.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/decorators';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Post('import/policies')
  @ApiOperation({ summary: '일괄 규정 import (JSON) — 관리자 전용' })
  importPolicies(@Request() req: any, @Body() dto: ImportPoliciesDto) {
    return this.adminService.importPolicies(req.user.tenantId, req.user.id, dto);
  }
}

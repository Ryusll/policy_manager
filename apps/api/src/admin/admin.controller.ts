import { Body, Controller, HttpCode, Post, Request, UseGuards } from '@nestjs/common';
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

  @Post('import/policies/validate')
  @HttpCode(200) // 만드는 게 아니라 검사만 한다
  @ApiOperation({
    summary: '일괄 가져오기 사전 검사 — 넣기 전에 문제를 전부 모아 돌려준다 (T-13)',
  })
  validateImportPolicies(@Request() req: any, @Body() dto: ImportPoliciesDto) {
    return this.adminService.validateImportPolicies(req.user.tenantId, dto);
  }

  @Post('import/policies')
  @ApiOperation({ summary: '일괄 규정 import (JSON) — 관리자 전용' })
  importPolicies(@Request() req: any, @Body() dto: ImportPoliciesDto) {
    return this.adminService.importPolicies(req.user.tenantId, req.user.id, dto);
  }
}

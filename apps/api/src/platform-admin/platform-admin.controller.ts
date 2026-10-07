import { Body, Controller, Get, Param, Patch, Post, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformRoles } from '../common/guards/decorators';
import { PlatformAdminService } from './platform-admin.service';
import {
  CreateTenantDto,
  TenantListQueryDto,
  UpdatePlatformBrandingDto,
  UpdatePlatformRoleDto,
  UpdateTenantPlanDto,
  UpdateTenantUserRoleDto,
} from './platform-admin.dto';
import { PlatformBrandingService } from '../platform-branding/platform-branding.service';

@ApiTags('platform-admin')
@ApiBearerAuth()
@Controller('platform-admin')
@PlatformRoles('global_admin')
export class PlatformAdminController {
  constructor(
    private readonly service: PlatformAdminService,
    private readonly platformBranding: PlatformBrandingService,
  ) {}

  @Post('tenants')
  @ApiOperation({
    summary: '고객사 개설 + 마스터 계정 발급 (T-122)',
    description: '임시 비밀번호는 응답에 한 번만 실린다. 마스터는 첫 로그인 때 비밀번호를 바꿔야 한다.',
  })
  createTenant(@Request() req: any, @Body() dto: CreateTenantDto) {
    return this.service.createTenant(req.user.id, dto);
  }

  @Get('tenants')
  @ApiOperation({ summary: '전체 테넌트 목록 조회' })
  listTenants(@Query() query: TenantListQueryDto) {
    return this.service.listTenants(query);
  }

  @Get('tenants/:tenantId/users')
  @ApiOperation({ summary: '특정 테넌트 사용자 목록 조회' })
  listTenantUsers(@Param('tenantId') tenantId: string) {
    return this.service.listTenantUsers(tenantId);
  }

  @Patch('tenants/:tenantId/plan')
  @ApiOperation({ summary: '특정 테넌트 플랜/만료/청구상태 변경' })
  updateTenantPlan(
    @Request() req: any,
    @Param('tenantId') tenantId: string,
    @Body() dto: UpdateTenantPlanDto,
  ) {
    return this.service.updateTenantPlan(req.user.id, tenantId, dto);
  }

  @Patch('tenants/:tenantId/users/:userId/role')
  @ApiOperation({ summary: '특정 테넌트 사용자 역할 변경(admin/editor/viewer)' })
  updateTenantUserRole(
    @Request() req: any,
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateTenantUserRoleDto,
  ) {
    return this.service.updateTenantUserRole(req.user.id, tenantId, userId, dto);
  }

  @Patch('users/:userId/platform-role')
  @ApiOperation({ summary: '플랫폼 관리자 역할 변경(none/global_admin)' })
  updatePlatformRole(
    @Request() req: any,
    @Param('userId') userId: string,
    @Body() dto: UpdatePlatformRoleDto,
  ) {
    return this.service.updatePlatformRole(req.user.id, userId, dto);
  }

  @Patch('branding')
  @ApiOperation({ summary: '서비스 운영사 푸터·로고 수정(전역 단일 설정)' })
  updateBranding(@Body() dto: UpdatePlatformBrandingDto) {
    return this.platformBranding.update(dto);
  }
}


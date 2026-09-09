import { Body, Controller, Get, Put, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MinPlan, Roles } from '../common/guards/decorators';
import { UpdateTenantBrandingDto } from './tenant-branding.dto';
import { TenantBrandingService } from './tenant-branding.service';

@ApiTags('tenant-branding')
@ApiBearerAuth()
@Controller('tenant-branding')
export class TenantBrandingController {
  constructor(private service: TenantBrandingService) {}

  /**
   * 조회는 플랜·역할을 가리지 않는다 — 헤더는 모든 사용자가 그린다.
   * 여기에 `@MinPlan` 을 걸면 Starter 테넌트의 화면이 통째로 깨진다.
   */
  @Get()
  @ApiOperation({ summary: '회사 브랜딩 조회 (모든 구성원)' })
  get(@Request() req: any) {
    return this.service.get(req.user.tenantId);
  }

  /**
   * 저장은 관리자 + Pro 이상.
   *
   * 역할 제한은 서버 저장으로 옮기면서 새로 생긴 요구다. localStorage 시절에는 각자
   * 자기 브라우저만 바뀌어서 아무나 만져도 그만이었지만, 이제는 한 사람이 바꾸면
   * **회사 전체 화면과 인쇄물**이 바뀐다.
   */
  @Put()
  @Roles('admin')
  @MinPlan('pro')
  @ApiOperation({ summary: '회사 브랜딩 저장 (관리자 · Pro 이상)' })
  update(@Request() req: any, @Body() dto: UpdateTenantBrandingDto) {
    return this.service.update(req.user.tenantId, req.user.id, dto);
  }
}

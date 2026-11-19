import { Controller, Get, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/guards/decorators';
import { DashboardService } from './dashboard.service';

/**
 * 대시보드 (T-213, SRS LAW-29·LAW-19 수정) — 관리자·편집자만. 열람자는 대시보드 화면에 오지 않고(통합검색이 첫 화면),
 * 개정 후보·법령 연결 숫자는 확정 전 내부 정보라 열람자에게 주지 않는다(개정 후보·법령 연결 API 와 같은 역할 범위).
 */
@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@Roles('admin', 'editor')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  @ApiOperation({
    summary: '대시보드 지표 카드·법령 개정 구역 — 관리 규정·연결 법령·개정 검토 대기·사내 시행 예정, 연결 법령 확인 상태, 최근 법령 개정 다섯 줄',
  })
  overview(@Request() req: { user: { tenantId: string } }) {
    return this.dashboard.overview(req.user.tenantId);
  }
}

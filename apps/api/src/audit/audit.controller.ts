import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/decorators';
import { AuditLogService } from './audit-log.service';
import { AuditLogQueryDto } from './audit.dto';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
@UseGuards(RolesGuard)
@Roles('admin')
export class AuditController {
  constructor(private readonly auditLogs: AuditLogService) {}

  /** 액션·사용자 목록이 `:id` 보다 먼저 와야 한다 — 아니면 "actions" 가 기록 id 로 잡힌다 */
  @Get('actions')
  @ApiOperation({ summary: '이 회사에 쌓인 액션 종류와 건수 (필터용)' })
  listActions(@Request() req: any) {
    return this.auditLogs.listActions(req.user.tenantId);
  }

  @Get('actors')
  @ApiOperation({ summary: '기록을 남긴 적 있는 사용자 목록 (필터용)' })
  listActors(@Request() req: any) {
    return this.auditLogs.listActors(req.user.tenantId);
  }

  @Get()
  @ApiOperation({
    summary: '감사 로그 목록 (관리자)',
    description:
      '`action` 은 정확히 일치, 끝에 `.` 을 붙이면 접두어 묶음(`version.`). 목록에는 `details` 본문이 없다 — 상세에서 받는다.',
  })
  findAll(@Request() req: any, @Query() query: AuditLogQueryDto) {
    return this.auditLogs.list(req.user.tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '감사 기록 상세 — `details` 본문 포함' })
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.auditLogs.findOne(req.user.tenantId, id);
  }
}

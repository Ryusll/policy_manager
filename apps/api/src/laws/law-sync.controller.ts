import { Body, Controller, Get, HttpCode, Post, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformRoles } from '../common/guards/decorators';
import { LawSyncService } from './law-sync.service';
import { LawSyncRunsQueryDto, RunLawSyncDto } from './laws.dto';

/**
 * 법령 주기 동기화 (T-104) — 플랫폼 관리자용.
 *
 * 경로를 `/admin` 이 아니라 `/platform-admin` 아래에 둔 이유: `/admin` 은 **회사 관리자**
 * 전용 컨트롤러(`@Roles('admin')`)다. 법령은 모든 회사가 함께 쓰는 데이터라 플랫폼 관리자만 돌린다.
 * 예약 실행은 이 API 가 아니라 서버 cron 의 CLI 다(`law-sync.cli.ts` 주석 참고).
 */
@ApiTags('law-sync')
@ApiBearerAuth()
@Controller('platform-admin/law-sync')
@PlatformRoles('global_admin')
export class LawSyncController {
  constructor(private readonly sync: LawSyncService) {}

  @Post('run')
  @HttpCode(200)
  @ApiOperation({ summary: '법령 동기화 지금 실행 — 확인이 오래된 법령부터 limit 건(lawId 를 주면 그 법령만)' })
  run(@Request() req: any, @Body() dto: RunLawSyncDto) {
    return this.sync.run({ trigger: 'manual', limit: dto.limit, triggeredBy: req.user.id, lawIds: dto.lawId ? [dto.lawId] : undefined });
  }

  @Get('runs')
  @ApiOperation({ summary: '법령 동기화 실행 이력 (최근 순)' })
  runs(@Query() query: LawSyncRunsQueryDto) {
    return this.sync.listRuns(query.limit);
  }
}

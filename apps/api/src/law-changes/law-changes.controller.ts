import { Controller, Get, Param, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/guards/decorators';
import { LawChangesService } from './law-changes.service';
import { LawChangeListQueryDto, LawImpactQueryDto } from './law-changes.dto';

/**
 * 법령 변경 이벤트와 우리 회사 영향 (T-105).
 *
 * admin·editor 만 — 어느 조문이 어느 법에 걸려 있는지는 확정 전 내부 정보다(설계안 6절,
 * 개정 후보와 같은 기준). viewer 는 법령 화면 자체에 들어오지 않는다.
 */
@ApiTags('law-changes')
@ApiBearerAuth()
@Controller('law-changes')
@Roles('admin', 'editor')
export class LawChangesController {
  constructor(private readonly service: LawChangesService) {}

  @Get()
  @ApiOperation({ summary: '법령 변경 이벤트 목록 + 각 이벤트의 우리 회사 영향 수(확정·확인 필요)' })
  list(@Request() req: any, @Query() query: LawChangeListQueryDto) {
    return this.service.list(req.user.tenantId, query);
  }

  @Get(':id/impact')
  @ApiOperation({ summary: '이 변경이 걸리는 우리 회사 조문과 각 조문의 제1 조문(기준일 시행본)' })
  impact(@Request() req: any, @Param('id') id: string, @Query() query: LawImpactQueryDto) {
    return this.service.impact(req.user.tenantId, id, query.asOf);
  }
}

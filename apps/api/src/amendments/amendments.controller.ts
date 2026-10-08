import { Body, Controller, Get, HttpCode, Param, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/guards/decorators';
import { AmendmentsService } from './amendments.service';
import { GenerateAmendmentsDto } from './amendments.dto';

/**
 * 개정 후보 (T-106). admin·editor 만 — 개정 초안은 확정 전 내부 문서다(설계안 6절).
 * 목록·손질·검토 요청은 T-107, 승인·반려는 T-108.
 */
@ApiTags('amendments')
@ApiBearerAuth()
@Controller('amendments')
@Roles('admin', 'editor')
export class AmendmentsController {
  constructor(private readonly service: AmendmentsService) {}

  @Post('generate')
  @HttpCode(200)
  @ApiOperation({
    summary: '법령 변경 이벤트로 우리 회사 영향 조문의 개정 후보를 만든다(규칙 기반). 이미 있는 후보는 다시 만들지 않는다',
  })
  generate(@Request() req: any, @Body() dto: GenerateAmendmentsDto) {
    return this.service.generateForEvent(req.user.tenantId, dto.changeEventId, {
      asOf: dto.asOf,
      userId: req.user.id,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '개정 후보 — 제1 조문·후보 본문·변경 근거·비교 정보' })
  get(@Request() req: any, @Param('id') id: string) {
    return this.service.get(req.user.tenantId, id);
  }
}

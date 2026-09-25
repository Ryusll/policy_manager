import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LawsService } from './laws.service';
import { RegisterLawDto } from './laws.dto';
import { Roles } from '../common/guards/decorators';

/**
 * 법령 (T-100).
 *
 * ⚠️ **테넌트 공용 데이터다**(ADR-0020). 다른 컨트롤러와 달리 `req.user.tenantId`를 쓰지 않는다.
 * 근로기준법은 모든 고객사에 같은 내용이라 테넌트마다 복사할 이유가 없다.
 * 조회는 모든 로그인 사용자에게 열되, **등록·삭제는 admin·editor로 제한**한다
 * — 등록은 법제처 외부 호출을 일으키고, 호출량이 인증값 단위로 제한된다.
 */
@ApiTags('laws')
@ApiBearerAuth()
@Controller('laws')
export class LawsController {
  constructor(private readonly lawsService: LawsService) {}

  @Get()
  @ApiOperation({ summary: '등록된 법령 목록 (테넌트 공용)' })
  list() {
    return this.lawsService.list();
  }

  @Post()
  @Roles('admin', 'editor')
  @HttpCode(200)
  @ApiOperation({
    summary: '법제처 MST로 법령 등록(추적 시작)',
    description:
      '본문을 받아 조·항·호를 LawArticle 로 저장한다. 이미 등록된 MST 면 조항을 다시 받아 갈아끼운다.',
  })
  register(@Body() dto: RegisterLawDto) {
    return this.lawsService.register(dto.mst, dto.sourceCode);
  }

  @Get(':id')
  @ApiOperation({ summary: '법령 1건' })
  findOne(@Param('id') id: string) {
    return this.lawsService.findOne(id);
  }

  @Get(':id/articles')
  @ApiOperation({ summary: '법령조항 목록 (원문 순서)' })
  articles(@Param('id') id: string) {
    return this.lawsService.articles(id);
  }

  @Delete(':id')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '추적 해제' })
  remove(@Param('id') id: string) {
    return this.lawsService.remove(id);
  }
}

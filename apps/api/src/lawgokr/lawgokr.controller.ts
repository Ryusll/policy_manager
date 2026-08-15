import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LawGoKrService } from './lawgokr.service';
import { Roles } from '../common/guards/decorators';

/**
 * 법제처 프록시 엔드포인트.
 *
 * 가져오기(import) 계열이라 권한은 규정 등록과 같게 admin·editor로 둔다.
 * 조회만 하는 API지만 외부 호출량이 인증값 단위로 제한되므로 viewer에게는 열지 않는다.
 */
@ApiTags('lawgokr')
@ApiBearerAuth()
@Controller('lawgokr')
export class LawGoKrController {
  constructor(private readonly lawGoKrService: LawGoKrService) {}

  @Get('status')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '법제처 연동 설정 여부 확인 (인증값 노출 없음)' })
  status() {
    return { configured: this.lawGoKrService.isConfigured() };
  }

  @Get('search')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '법령명 검색 (법제처 lawSearch.do 래핑)' })
  @ApiQuery({ name: 'q', required: true, description: '검색어(법령명)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'display', required: false, description: '건수 (최대 100)' })
  @ApiQuery({
    name: 'sort',
    required: false,
    description: 'lasc(법령오름차순, 기본) · ldes · dasc · ddes · efasc · efdes',
  })
  @ApiQuery({ name: 'scope', required: false, description: 'title(기본) · fulltext(본문검색)' })
  search(
    @Query('q') q: string,
    @Query('page') page = '1',
    @Query('display') display = '20',
    @Query('sort') sort = 'lasc',
    @Query('scope') scope: 'title' | 'fulltext' = 'title',
  ) {
    const query = (q || '').trim();
    if (!query) throw new BadRequestException('검색어(q)를 입력하세요.');
    return this.lawGoKrService.search({
      query,
      page: Number(page) || 1,
      display: Number(display) || 20,
      sort,
      searchScope: scope === 'fulltext' ? 2 : 1,
    });
  }

  @Get('laws/:mst')
  @Roles('admin', 'editor')
  @ApiOperation({
    summary: '법령 본문 조회 → 조·항·호·목 트리',
    description:
      '검색 결과의 mst(법령일련번호)로 본문을 받아 내부 조항 트리로 변환해 돌려준다. ' +
      '응답의 tree.roots는 PDF 가져오기와 같은 형식이라 그대로 미리보기·커밋에 쓸 수 있다.',
  })
  getLaw(@Param('mst') mst: string) {
    return this.lawGoKrService.getLaw(mst);
  }
}

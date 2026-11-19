import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LawGoKrService } from './lawgokr.service';
import { LAW_SEARCH_QUERY_MAX, LAW_SEARCH_SORTS } from './lawgokr-search-rank';
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
  @ApiOperation({
    summary: '법령명 검색 (법제처 lawSearch.do 래핑)',
    description:
      '정렬을 주지 않은 법령명 검색은 검색어와 맞는 순이다(이름 같음 → 약칭 같음 → 이름이 시작 → 약칭이 시작 → 이름에 포함 → ' +
      '약칭에 포함 → 나머지, T-210). 결과가 500건 이하면 모두 받아 줄 세우고 응답에 ranked=true(total 은 줄 세운 건수), ' +
      '넘으면 가나다순 그대로 쪽을 넘기며 ranked=false 다.',
  })
  @ApiQuery({ name: 'q', required: true, description: '검색어(법령명·약칭)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'display', required: false, description: '건수 (최대 100)' })
  @ApiQuery({
    name: 'sort',
    required: false,
    description:
      '주지 않으면 법령명 검색은 relevance(검색어와 맞는 순), 본문 검색은 lasc. ' +
      '직접 주면 법제처 순서 그대로다: lasc(법령오름차순) · ldes · dasc · ddes · nasc · ndes · efasc · efdes. 그 밖의 값은 400',
  })
  @ApiQuery({ name: 'scope', required: false, description: 'title(기본) · fulltext(본문검색)' })
  search(
    @Query('q') q: string,
    @Query('page') page = '1',
    @Query('display') display = '20',
    @Query('sort') sort?: string,
    @Query('scope') scope: 'title' | 'fulltext' = 'title',
  ) {
    // 전역 ValidationPipe 가 문자열로 바꿔 준다(q=a&q=b → 'a,b'). 파이프를 거치지 않고 배열이 와도 500 이 아니라 400 이 되게 막아 둔다
    const query = typeof q === 'string' ? q.trim() : '';
    if (!query) throw new BadRequestException('검색어(q)를 입력하세요.');
    if (query.length > LAW_SEARCH_QUERY_MAX) {
      throw new BadRequestException(`검색어는 ${LAW_SEARCH_QUERY_MAX}자까지 넣을 수 있습니다.`);
    }
    if (sort && !LAW_SEARCH_SORTS.has(sort)) {
      throw new BadRequestException('정렬값(sort)이 올바르지 않습니다. 비우거나 relevance·lasc·ldes·dasc·ddes·nasc·ndes·efasc·efdes 가운데 하나를 넣으세요.');
    }
    return this.lawGoKrService.search({
      query,
      page: Number(page) || 1,
      display: Number(display) || 20,
      sort: sort || undefined,
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

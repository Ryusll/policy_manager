import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LawGoKrCache } from './lawgokr.cache';
import { mapLawDetail, mapSearchItem } from './lawgokr.mapper';
import {
  LawDetailMeta,
  LawGoKrLawServiceResponse,
  LawGoKrSearchItem,
  LawGoKrSearchResponse,
  LawSearchResult,
  OneOrMany,
} from './lawgokr.types';
import { RegulationArticleNode } from '../regulation-parse/regulation-tree.builder';
import { VERSION_LIST_PAGE_SIZE, lawDetailCacheKey, lawSearchCacheKey, lawVersionListCacheKey } from './lawgokr-cache-keys';

/**
 * T-53. 법제처 국가법령정보 공동활용 OPEN API 프록시.
 *
 * 프론트가 법제처를 직접 부르지 않고 반드시 이 모듈을 거치게 한다. 이유가 둘 있다:
 * 1. 인증값(OC)이 브라우저 번들에 실리면 그대로 공개된다. 서버에만 둔다.
 * 2. law.go.kr은 CORS 헤더를 주지 않아 브라우저에서는 애초에 호출이 막힌다.
 *
 * 운영 주의 — 법제처는 OC와 함께 **호출한 서버의 IP·도메인**을 검증해 거절할 수 있다.
 * 그때 돌아오는 응답이 `{ result, msg }`(HTTP 200)이며, 이 서비스는 이를 503으로 바꿔 알린다.
 * IP 등록이 늘 필요한 건 아니다 — 2026-10-07 운영 서버는 로컬과 같은 OC로, IP를 따로 등록하지
 * 않고도 통과했다. open.law.go.kr의 "API인증키관리" 화면에는 IP 칸이 없다(등록 위치로 안내하지 말 것).
 */
@Injectable()
export class LawGoKrService {
  private readonly log = new Logger(LawGoKrService.name);
  private readonly baseUrl = (process.env.LAW_GO_KR_BASE_URL || 'https://www.law.go.kr/DRF').replace(/\/+$/, '');
  private readonly timeoutMs = Number(process.env.LAW_GO_KR_TIMEOUT_MS || 15000);
  /** 목록은 자주 바뀌지 않고, 본문은 사실상 불변(시행일이 바뀌면 MST가 바뀐다) */
  private readonly searchTtl = Number(process.env.LAW_GO_KR_SEARCH_TTL || 600);
  private readonly detailTtl = Number(process.env.LAW_GO_KR_DETAIL_TTL || 86400);

  constructor(private readonly cache: LawGoKrCache) {}

  /** 인증값이 설정돼 있는지. 컨트롤러의 연결 상태 확인용 */
  isConfigured(): boolean {
    return Boolean(process.env.LAW_GO_KR_OC?.trim());
  }

  private oc(): string {
    const oc = process.env.LAW_GO_KR_OC?.trim();
    if (!oc) {
      throw new ServiceUnavailableException(
        '법제처 API 인증값(LAW_GO_KR_OC)이 설정되지 않았습니다. ' +
          '.env에 발급받은 인증값을 넣고 API를 재기동하세요.',
      );
    }
    return oc;
  }

  /**
   * 법제처 호출 1회.
   *
   * 법제처는 실패도 HTTP 200 + JSON으로 내려준다. 상태 코드만 보고 성공으로 판정하면
   * 오류 메시지가 그대로 파싱 대상이 되므로, 본문 모양으로 실패를 가려낸다.
   */
  private async call<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}/${path}`);
    url.searchParams.set('OC', this.oc());
    url.searchParams.set('type', 'JSON');
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    } catch (e: any) {
      const reason = e?.name === 'AbortError' ? `응답 시간 초과(${this.timeoutMs}ms)` : e?.message || e;
      // URL에 OC가 들어 있으므로 절대 로그에 URL을 남기지 않는다.
      this.log.warn(`법제처 호출 실패 [${path}]: ${reason}`);
      throw new BadGatewayException(`법제처 API 호출에 실패했습니다: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    const body = await res.text();
    if (!res.ok) {
      this.log.warn(`법제처 응답 오류 [${path}] status=${res.status}`);
      throw new BadGatewayException(`법제처 API가 오류를 반환했습니다 (HTTP ${res.status}).`);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch {
      // 인증값이 아예 틀리면 JSON 대신 HTML 오류 페이지가 오기도 한다.
      this.log.warn(`법제처 응답을 JSON으로 읽지 못했습니다 [${path}] (앞부분: ${body.slice(0, 80)})`);
      throw new BadGatewayException('법제처 API 응답 형식이 올바르지 않습니다.');
    }

    // 인증/IP 검증 실패: { result: '사용자 정보 검증에 실패하였습니다.', msg: '...IP주소 및 도메인주소를 등록...' }
    if (parsed && typeof parsed.result === 'string' && parsed.LawSearch === undefined) {
      const detail = [parsed.result, parsed.msg].filter(Boolean).join(' ');
      this.log.error(`법제처 인증 실패 [${path}]: ${detail}`);
      throw new ServiceUnavailableException(
        `법제처 API 인증에 실패했습니다: ${detail} ` +
          '(인증값이 맞는지, 그리고 법제처에 등록된 서버 IP·도메인에 이 서버가 들어 있는지 확인하세요.)',
      );
    }

    return parsed as T;
  }

  private static toArray<T>(value: OneOrMany<T> | undefined): T[] {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
  }

  /** 법령명 검색. `search=2`면 본문까지 훑는다. */
  async search(options: {
    query: string;
    page?: number;
    display?: number;
    sort?: string;
    searchScope?: 1 | 2;
  }): Promise<LawSearchResult> {
    const query = options.query.trim();
    const page = Math.max(1, Math.trunc(options.page || 1));
    const display = Math.min(100, Math.max(1, Math.trunc(options.display || 20)));
    const sort = options.sort || 'lasc';
    const scope = options.searchScope === 2 ? 2 : 1;

    const cacheKey = lawSearchCacheKey({ scope, sort, display, page, query });
    const cached = await this.cache.get<LawSearchResult>(cacheKey);
    if (cached) return cached;

    const raw = await this.call<LawGoKrSearchResponse>('lawSearch.do', {
      target: 'law',
      query,
      page,
      display,
      sort,
      search: scope,
    });

    const box = raw.LawSearch;
    const result: LawSearchResult = {
      total: Number(box?.totalCnt ?? 0) || 0,
      page,
      display,
      items: LawGoKrService.toArray<LawGoKrSearchItem>(box?.law)
        .map(mapSearchItem)
        .filter((item) => item.mst),
    };

    await this.cache.set(cacheKey, result, this.searchTtl);
    return result;
  }

  /**
   * 판 목록 한 쪽(T-151, PAT-07) — 시행일법령 목록(`target=eflaw`)을 **법령ID(`LID`)로** 공포일 내림차순 100건씩.
   *
   * 현행 목록(`target=law`)은 **현행만** 준다(2026-10-14 실호출). 이 목록은 연혁·현행·시행예정을 모두 주고, 같은 판(MST)이
   * 단계 시행일마다 따로 나온다. 검색어 없이 `LID` 로 부르면 그 법령의 판만 온다(근로기준법 001872 → 54건) — 법령명으로
   * 찾을 때처럼 시행령이 섞이거나, 제명이 바뀐 판을 놓치는 일이 없다. 부르는 쪽도 법령ID 로 한 번 더 거른다.
   */
  async searchVersions(lawId: string, page = 1): Promise<LawSearchResult> {
    const id = lawId.trim();
    if (!/^\d+$/.test(id)) throw new NotFoundException('법령ID는 숫자여야 합니다.');
    const p = Math.max(1, Math.trunc(page));
    const cacheKey = lawVersionListCacheKey(id, p);
    const cached = await this.cache.get<LawSearchResult>(cacheKey);
    if (cached) return cached;

    const raw = await this.call<LawGoKrSearchResponse>('lawSearch.do', {
      target: 'eflaw',
      LID: id,
      // 연혁·시행예정·현행을 모두 달라고 밝힌다 — 빼면 현행 한 건만 온다(2026-10-30 실호출: 근로기준법 001872 → 1건, nw=1,2,3 → 54건,
      // 소득세법 225건·조세특례제한법 375건도 쪽마다 총건수가 같고 섞인 채 공포일 내림차순). 현행만 받으면 저장 판이 현행이 아닌 법령은
      // '확인 실패'로 멈추고, 저장 판이 현행인 법령은 시행 예정 판을 조용히 놓친다(T-186 운영 반영 전 검증에서 찾음)
      nw: '1,2,3',
      page: p,
      display: VERSION_LIST_PAGE_SIZE,
      sort: 'ddes',
    });
    const box = raw.LawSearch;
    const result: LawSearchResult = {
      total: Number(box?.totalCnt ?? 0) || 0,
      page: p,
      display: VERSION_LIST_PAGE_SIZE,
      // MST 가 빈 행도 버리지 않는다 — 판 목록(groupVersions)이 저장 판 뒤의 행이면 멈춘다(조용히 버리면 사이 판이 빠진다)
      items: LawGoKrService.toArray<LawGoKrSearchItem>(box?.law).map(mapSearchItem),
    };
    await this.cache.set(cacheKey, result, this.searchTtl);
    return result;
  }

  /**
   * 법령 본문 조회 → 메타 + 조항 트리(T-54 매퍼).
   *
   * 캐시에는 매핑이 끝난 결과를 넣는다. 원본은 건당 수백 KB인데 우리가 쓰는 건
   * 트리뿐이고, 매핑 규칙이 바뀌면 어차피 캐시 키를 갈아야 해서 원본을 들고 있을 이유가 없다.
   */
  async getLaw(mst: string): Promise<{ meta: LawDetailMeta; tree: { roots: RegulationArticleNode[] } }> {
    const key = mst.trim();
    if (!/^\d+$/.test(key)) {
      throw new NotFoundException('법령일련번호(MST)는 숫자여야 합니다.');
    }

    const cacheKey = lawDetailCacheKey(key);
    const cached = await this.cache.get<{ meta: LawDetailMeta; tree: { roots: RegulationArticleNode[] } }>(cacheKey);
    if (cached) return cached;

    const raw = await this.call<LawGoKrLawServiceResponse & { Law?: unknown }>('lawService.do', {
      target: 'law',
      MST: key,
    });

    // 없는 법령: { "Law": "일치하는 법령이 없습니다. ..." } — 역시 HTTP 200으로 온다.
    if (typeof (raw as any).Law === 'string') {
      throw new NotFoundException(`법제처에서 해당 법령을 찾을 수 없습니다 (MST=${key}).`);
    }
    const detail = raw.법령;
    if (!detail?.기본정보) {
      throw new BadGatewayException('법제처 응답에 법령 기본정보가 없습니다.');
    }

    const mapped = mapLawDetail(detail, key);
    if (!mapped.tree.roots.length) {
      this.log.warn(`법제처 응답에 조문이 없습니다 (MST=${key}).`);
    }
    // 법령ID 가 빠진 응답은 캐시하지 않는다 — 등록이 그 응답으로는 새로 만들지 않는데(502), 캐시에 남으면 다시 시도해도 하루 동안
    // 같은 응답을 받는다(T-151 검토)
    if (mapped.meta.lawId) await this.cache.set(cacheKey, mapped, this.detailTtl);
    else this.log.warn(`법제처 응답에 법령ID 가 없습니다 (MST=${key}) — 캐시하지 않습니다.`);
    return mapped;
  }
}

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

/**
 * T-53. 법제처 국가법령정보 공동활용 OPEN API 프록시.
 *
 * 프론트가 법제처를 직접 부르지 않고 반드시 이 모듈을 거치게 한다. 이유가 둘 있다:
 * 1. 인증값(OC)이 브라우저 번들에 실리면 그대로 공개된다. 서버에만 둔다.
 * 2. law.go.kr은 CORS 헤더를 주지 않아 브라우저에서는 애초에 호출이 막힌다.
 *
 * 운영 주의 — 법제처는 **OC와 서버 IP를 함께** 검증한다. 배포 서버의 공인 IP를
 * open.law.go.kr 마이페이지에 등록하지 않으면 로컬에서 되던 호출이 운영에서 실패한다.
 * 그때 돌아오는 응답이 `{ result, msg }`이며, 이 서비스는 이를 503으로 바꿔 알린다.
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
          '(open.law.go.kr 마이페이지에서 이 서버의 공인 IP가 등록돼 있는지 확인하세요.)',
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

    const cacheKey = `lawgokr:search:${scope}:${sort}:${display}:${page}:${query}`;
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

    const cacheKey = `lawgokr:law:v1:${key}`;
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
    await this.cache.set(cacheKey, mapped, this.detailTtl);
    return mapped;
  }
}

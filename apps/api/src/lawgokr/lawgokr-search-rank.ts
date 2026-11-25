import { BadGatewayException } from '@nestjs/common';
import type { LawSearchResult, LawSearchResultItem } from './lawgokr.types';

/**
 * 법령명 검색 결과를 검색어와 맞는 순으로 줄 세운다 (T-210, SRS LAW-28).
 *
 * 법제처 `lawSearch.do` 는 법령명뿐 아니라 약칭에 걸린 것까지 가나다순으로, 한 번에 100건까지만 준다. 일치순 정렬값은 없다
 * (이름·공포일·시행일의 오름·내림뿐). 그래서 "상법"을 찾으면 약칭이 '…보상법'인 법령들에 밀려 상법이 56건 중 34번째에 오고,
 * 첫 쪽만 보여 주던 화면에는 끝까지 내려도 나오지 않았다(2026-11-18 실호출). 결과를 모두 받아 우리 쪽에서 순서를 다시 세운다.
 */

/** 검색 정렬값 — 검색어와 맞는 순. 법제처에는 없는 값이라 법제처로 넘기지 않는다(법제처에는 늘 가나다순 `lasc` 로 청한다) */
export const LAW_SEARCH_RELEVANCE = 'relevance';

/**
 * 검색이 받는 정렬값 — 맞는 순과 법제처의 여덟 가지(법령명·공포일·공포번호·시행일의 오름·내림). 법제처는 모르는 값을 조용히
 * 무시하므로(2026-11-18 실호출), 그대로 넘기면 줄 세우지 않은 결과가 나가고 값마다 캐시 키가 따로 생긴다 — 그 밖의 값은 400.
 */
export const LAW_SEARCH_SORTS: ReadonlySet<string> = new Set([
  LAW_SEARCH_RELEVANCE,
  ...['lasc', 'ldes', 'dasc', 'ddes', 'nasc', 'ndes', 'efasc', 'efdes'],
]);

/** 검색어 길이 상한 — 법령명을 적기에는 넉넉하다. 검색어가 캐시 키에 그대로 들어가므로 끝없이 길게 받지 않는다 */
export const LAW_SEARCH_QUERY_MAX = 200;

/** 법제처가 한 번에 주는 최대 건수. 줄 세울 때는 이 크기로 쪽을 받는다 */
export const RANK_PAGE_SIZE = 100;

/**
 * 이 건수까지만 모두 받아 줄 세운다(법제처 호출 최대 5번). 넘는 검색어는 '법'(4,535건)·'시행령'(1,522건)처럼 너무 넓어서
 * 이름이 같은 법령이 있을 수 없고, 다 받자면 호출이 수십 번이다 — 가나다순 그대로 쪽을 넘기고 화면이 그 사실을 알린다.
 */
export const RANK_POOL_MAX = 500;

/**
 * 가운뎃점·마침표로 쓰이는 글자. 눈으로 구별이 안 돼 코드값으로 적는다 — 마침표(002E·FF0E), 가운뎃점(00B7), 법제처가 쓰는
 * 아래아(318D), 가타카나 가운뎃점(30FB·FF65), 하이픈 점(2027), 글머리 점(2022), 점 연산자(2219·22C5)
 */
const DOT_CHARS = new Set(
  [0x002e, 0xff0e, 0x00b7, 0x318d, 0x30fb, 0xff65, 0x2027, 0x2022, 0x2219, 0x22c5].map((code) => String.fromCharCode(code)),
);

/** 견줄 때 쓰는 꼴 — 띄어쓰기와 가운뎃점을 빼고 영문은 소문자로. '개인정보보호법'과 '개인정보 보호법', '5·18'과 '5ㆍ18'을 같게 본다 */
export function normalizeLawName(value: string | null | undefined): string {
  let out = '';
  for (const ch of (value ?? '').normalize('NFC').toLowerCase()) {
    if (!/\s/.test(ch) && !DOT_CHARS.has(ch)) out += ch;
  }
  return out;
}

type Named = Pick<LawSearchResultItem, 'title' | 'shortTitle'>;

/** 맞는 정도(작을수록 먼저). `query` 는 normalizeLawName 을 거친 값 */
function matchTier(query: string, item: Named): number {
  const name = normalizeLawName(item.title);
  const short = normalizeLawName(item.shortTitle);
  if (name === query) return 0;
  if (short === query) return 1;
  if (name.startsWith(query)) return 2;
  if (short.startsWith(query)) return 3;
  if (name.includes(query)) return 4;
  if (short.includes(query)) return 5;
  // 글자로는 안 맞지만 법제처가 걸어 준 것(예: '형법' → 약칭 '형집행법')
  return 6;
}

/**
 * 검색어와 맞는 순으로 줄 세운 새 배열을 준다. 같은 단계 안에서는 받은 순서(법제처의 가나다순 — 법률·시행령·시행규칙 차례)를 지킨다.
 * 받은 배열은 건드리지 않는다 — 캐시에 든 쪽을 그대로 받으므로 제자리 정렬은 캐시를 망가뜨린다.
 */
export function rankLawSearchItems<T extends Named>(query: string, items: readonly T[]): T[] {
  const wanted = normalizeLawName(query);
  if (!wanted) return [...items];
  return items
    .map((item, index) => ({ item, index, tier: matchTier(wanted, item) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((entry) => entry.item);
}

/** 법제처 가나다순 n쪽(RANK_PAGE_SIZE 건). `fresh` 면 캐시를 건너뛰고 새로 받는다 */
type FetchPage = (page: number, fresh?: boolean) => Promise<LawSearchResult>;

/** 모든 쪽을 받는다. 전체가 RANK_POOL_MAX 를 넘으면 1쪽만 보고 그만둔다(null). 한 쪽이라도 실패하면 그대로 실패한다 */
async function gatherPages(fetchPage: FetchPage, fresh: boolean): Promise<LawSearchResult[] | null> {
  const first = await fetchPage(1, fresh);
  if (first.total > RANK_POOL_MAX) return null;
  const pageCount = Math.ceil(first.total / RANK_PAGE_SIZE);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) => fetchPage(i + 2, fresh)));
  return [first, ...rest];
}

/**
 * 쪽마다 실린 총건수가 같은가 — 다르면 받은 시각이 다른 쪽이 섞였다(쪽마다 따로 캐시한다). 그대로 이으면 쪽 경계의 법령이 빠진다.
 * 총건수 안의 쪽이 줄 없이 오는 것(법제처가 쪽을 비워 줌)은 쪽을 받을 때 실패로 막는다(`lawgokr.service` 의 fetchSearchPage) —
 * 여기서 거른 뒤의 줄 수로 보면 법령일련번호가 빈 행만 있는 쪽까지 빈 쪽으로 오인한다.
 */
const sameTotal = (pages: LawSearchResult[]) => pages.every((p) => p.total === pages[0].total);

/**
 * 법령명 검색을 모두 받아 줄 세운 뒤 청한 쪽만큼 잘라 준다.
 *
 * - 전체가 RANK_POOL_MAX 를 넘으면 받지 않고 `null` — 부르는 쪽이 가나다순 그대로 넘긴다.
 * - 한 쪽이라도 실패하면 그대로 실패한다. 일부만 줄 세워 주면 빠진 쪽에 있던 법령이 '없는 것'으로 보인다.
 * - 쪽마다 실린 총건수가 다르면 받은 시각이 다른 쪽이 섞인 것이다(쪽마다 따로 캐시한다). 그대로 이으면 쪽 경계의 법령이 조용히
 *   빠진다 — 캐시를 건너뛰고 한 번 다시 받고, 그래도 다르면 일부만 주지 않고 실패한다. 총건수 안의 빈 쪽은 쪽을 받을 때 실패한다.
 * - `total` 은 줄 세운 건수다(MST 가 없어 빠진 행, 받는 사이 목록이 밀려 겹친 행을 뺀 수) — 화면의 쪽 계산이 빈 쪽을 만들지 않게.
 */
export async function searchRanked(fetchPage: FetchPage, query: string, page: number, display: number): Promise<LawSearchResult | null> {
  let pages = await gatherPages(fetchPage, false);
  if (pages && !sameTotal(pages)) {
    pages = await gatherPages(fetchPage, true);
    if (pages && !sameTotal(pages)) {
      throw new BadGatewayException('법제처 목록이 받는 사이에 바뀌었습니다. 잠시 뒤 다시 검색해 주세요.');
    }
  }
  if (!pages) return null;

  const seen = new Set<string>();
  const pool: LawSearchResultItem[] = [];
  for (const item of pages.flatMap((p) => p.items)) {
    if (seen.has(item.mst)) continue;
    seen.add(item.mst);
    pool.push(item);
  }

  const ranked = rankLawSearchItems(query, pool);
  return { total: ranked.length, page, display, items: ranked.slice((page - 1) * display, page * display), ranked: true };
}

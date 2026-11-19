import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LawGoKrService } from '../apps/api/src/lawgokr/lawgokr.service';
import { mapSearchItem } from '../apps/api/src/lawgokr/lawgokr.mapper';
import type { LawGoKrSearchItem } from '../apps/api/src/lawgokr/lawgokr.types';

/**
 * 법령명 검색 시험(T-210)의 가짜 법제처 — `fetch` 를 바꿔 끼우고, 캐시는 메모리 Map 으로 둔다.
 * 고정 자료는 2026-11-18 실제 "상법" 응답(56건, 상법이 가나다순 34번째)이다.
 */
export const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'lawgokr-search-sangbeop.json'), 'utf8'));
export const sangbeopRows: LawGoKrSearchItem[] = fixture.LawSearch.law;
export const sangbeop = sangbeopRows.map(mapSearchItem);

/** 법제처 원문 모양의 행 */
export function row(mst: string, name: string, short = ''): LawGoKrSearchItem {
  return { 법령일련번호: mst, 법령ID: mst.padStart(6, '0'), 법령명한글: name, 법령약칭명: short, 법령구분명: '법률', 현행연혁코드: '현행' };
}

export const titles = (items: { title: string }[]) => items.map((i) => i.title);

/** 메모리 캐시를 단 서비스. 제한 시간·주소 같은 환경 값은 만들 때 읽으니, 바꿀 값은 먼저 넣고 부른다 */
export function service() {
  const store = new Map<string, unknown>();
  const cache: any = {
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    set: (k: string, v: unknown) => (store.set(k, v), Promise.resolve()),
  };
  return { svc: new LawGoKrService(cache), store };
}

/** 가짜 법제처 — 이미 가나다순인 전체에서 page·display 만큼만 잘라 준다(실제처럼 한 쪽씩). failPage 쪽은 HTTP 500 */
export function stubLawGoKr(all: LawGoKrSearchItem[], failPage?: number) {
  process.env.LAW_GO_KR_OC = 'test-oc';
  const urls: URL[] = [];
  vi.stubGlobal('fetch', (url: string | URL) => {
    const u = new URL(String(url));
    urls.push(u);
    const page = Number(u.searchParams.get('page') ?? 1);
    const display = Number(u.searchParams.get('display') ?? 20);
    if (page === failPage) return Promise.resolve(new Response('upstream down', { status: 500 }));
    const law = all.slice((page - 1) * display, page * display);
    const body = { LawSearch: { totalCnt: String(all.length), page: String(page), law } };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  return urls;
}

/** 법제처로 나간 요청의 칸 */
export const sent = (u: URL) => ({
  target: u.searchParams.get('target'),
  query: u.searchParams.get('query'),
  sort: u.searchParams.get('sort'),
  display: u.searchParams.get('display'),
  page: u.searchParams.get('page'),
  search: u.searchParams.get('search'),
});

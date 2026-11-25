import { describe, it, expect, afterEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { LawGoKrController } from '../apps/api/src/lawgokr/lawgokr.controller';
import { mapSearchItem } from '../apps/api/src/lawgokr/lawgokr.mapper';
import { lawSearchCacheKey } from '../apps/api/src/lawgokr/lawgokr-cache-keys';
import { RANK_POOL_MAX, rankLawSearchItems } from '../apps/api/src/lawgokr/lawgokr-search-rank';
import type { LawGoKrSearchItem, LawSearchResult } from '../apps/api/src/lawgokr/lawgokr.types';
import { fixture, row, sangbeop, sangbeopRows, sent, service, stubLawGoKr, titles } from './lawSearchStub';

/**
 * 법령명 검색 엔드포인트의 서비스·컨트롤러 (T-210, SRS LAW-28) — 가짜 법제처(fetch 대역, tests/lawSearchStub.ts)로 요청과 응답을 본다.
 * 순위 규칙과 '모두 받아 줄 세우기' 자체는 tests/lawSearchRank.test.ts 가 본다.
 *
 * 막고 싶은 사고(2026-11-18 PM 신고): "상법"을 찾으면 법제처가 약칭에 걸린 것까지 56건을 가나다순으로 주고 상법은 34번째다.
 * 서버가 첫 쪽만 그대로 넘기면 찾던 법령이 화면에 끝까지 안 나온다. 고정 자료는 그날의 실제 응답이다.
 */
describe('LawGoKrService.search — 기본 순서 (T-210)', () => {
  const oc = process.env.LAW_GO_KR_OC;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (oc === undefined) delete process.env.LAW_GO_KR_OC;
    else process.env.LAW_GO_KR_OC = oc;
  });

  it('정렬을 주지 않은 법령명 검색: 화면이 20건만 청해도 법제처에서 100건을 받아 "상법"을 첫 줄로 준다', async () => {
    const urls = stubLawGoKr(sangbeopRows);
    const { svc } = service();
    const r = await svc.search({ query: ' 상법 ', display: 20 });
    expect(r.items[0].title).toBe('상법');
    expect(r.items).toHaveLength(20);
    expect(r).toMatchObject({ total: 56, page: 1, display: 20, ranked: true });
    expect(urls.map(sent)).toEqual([{ target: 'law', query: '상법', sort: 'lasc', display: '100', page: '1', search: '1' }]);
  });

  it('다음 쪽은 같은 줄 세운 목록에서 이어지고, 법제처를 다시 부르지 않는다', async () => {
    const urls = stubLawGoKr(sangbeopRows);
    const { svc } = service();
    const pages = [await svc.search({ query: '상법', display: 20 }), await svc.search({ query: '상법', display: 20, page: 2 }), await svc.search({ query: '상법', display: 20, page: 3 })];
    expect(pages.flatMap((p) => p.items.map((i) => i.mst))).toEqual(rankLawSearchItems('상법', sangbeop).map((i) => i.mst));
    expect(pages.map((p) => p.items.length)).toEqual([20, 20, 16]);
    expect(urls).toHaveLength(1);
  });

  it('쪽은 예전과 같은 가나다순 키로 캐시하고, 캐시에 든 쪽의 순서는 바꾸지 않는다', async () => {
    stubLawGoKr(sangbeopRows);
    const { svc, store } = service();
    await svc.search({ query: '상법' });
    const key = lawSearchCacheKey({ scope: 1, sort: 'lasc', display: 100, page: 1, query: '상법' });
    expect([...store.keys()]).toEqual([key]);
    expect((store.get(key) as LawSearchResult).items[0].title).toBe('1980년해직공무원의보상등에관한특별조치법');
    expect((store.get(key) as LawSearchResult).ranked).toBeUndefined();
  });

  it('결과가 100건을 넘으면 남은 쪽도 받아, 가나다순 3쪽에 있던 같은 이름을 첫 줄로 준다', async () => {
    const all = Array.from({ length: 249 }, (_, i) => row(String(1000 + i), `가나다 보상 등에 관한 법률 ${i}`, `가나다${i}보상법`));
    all.splice(230, 0, row('900', '상법'));
    const urls = stubLawGoKr(all);
    const { svc } = service();
    const r = await svc.search({ query: '상법' });
    expect(r.items[0]).toMatchObject({ mst: '900', title: '상법' });
    expect(r).toMatchObject({ total: 250, ranked: true });
    expect(urls.map((u) => u.searchParams.get('page')).sort()).toEqual(['1', '2', '3']);
    expect(urls.every((u) => u.searchParams.get('display') === '100' && u.searchParams.get('sort') === 'lasc')).toBe(true);
  });

  it(`${RANK_POOL_MAX}건을 넘으면 줄 세우지 않고 청한 쪽을 가나다순 그대로 주며 ranked:false 로 알린다`, async () => {
    const all = Array.from({ length: RANK_POOL_MAX + 1 }, (_, i) => row(String(5000 + i), `법률 ${String(i).padStart(3, '0')}`));
    const urls = stubLawGoKr(all);
    const { svc } = service();
    const r = await svc.search({ query: '법', page: 3, display: 20 });
    expect(r).toMatchObject({ total: RANK_POOL_MAX + 1, page: 3, display: 20, ranked: false });
    expect(r.items.map((i) => i.mst)).toEqual(all.slice(40, 60).map((x) => x.법령일련번호));
    // 총건수를 알려고 1쪽(100건)을 한 번, 청한 쪽을 한 번
    expect(urls.map(sent)).toEqual([
      { target: 'law', query: '법', sort: 'lasc', display: '100', page: '1', search: '1' },
      { target: 'law', query: '법', sort: 'lasc', display: '20', page: '3', search: '1' },
    ]);
  });

  it('정렬값을 직접 주면 예전처럼 법제처 순서 그대로 한 번만 부르고 ranked 를 싣지 않는다', async () => {
    const urls = stubLawGoKr(sangbeopRows);
    const { svc } = service();
    const r = await svc.search({ query: '상법', display: 20, sort: 'lasc' });
    expect(titles(r.items)).toEqual(titles(sangbeop.slice(0, 20)));
    expect(r).toMatchObject({ total: 56, page: 1, display: 20 });
    expect('ranked' in r).toBe(false);
    expect(urls.map(sent)).toEqual([{ target: 'law', query: '상법', sort: 'lasc', display: '20', page: '1', search: '1' }]);

    await svc.search({ query: '상법', display: 5, sort: 'ddes' });
    expect(sent(urls[1])).toMatchObject({ sort: 'ddes', display: '5' });
  });

  it('본문 검색은 줄 세우지 않는다 — 이름으로 견줄 근거가 없다', async () => {
    const urls = stubLawGoKr(sangbeopRows);
    const { svc } = service();
    const r = await svc.search({ query: '상법', display: 20, searchScope: 2 });
    expect(titles(r.items)).toEqual(titles(sangbeop.slice(0, 20)));
    expect('ranked' in r).toBe(false);
    expect(urls.map(sent)).toEqual([{ target: 'law', query: '상법', sort: 'lasc', display: '20', page: '1', search: '2' }]);
  });

  it('맞는 순을 직접 청해도 본문 검색이면 법제처 순서 그대로다 — 모두 받으러 가지 않는다', async () => {
    const urls = stubLawGoKr(sangbeopRows);
    const { svc } = service();
    const r = await svc.search({ query: '상법', display: 20, searchScope: 2, sort: 'relevance' });
    expect(titles(r.items)).toEqual(titles(sangbeop.slice(0, 20)));
    expect(urls.map(sent)).toEqual([{ target: 'law', query: '상법', sort: 'lasc', display: '20', page: '1', search: '2' }]);
  });

  it('MST 가 없어 빠진 행이 있으면 total 은 법제처 총건수가 아니라 줄 세운 건수다 — 화면이 빈 쪽을 만들지 않게', async () => {
    stubLawGoKr([row('', '상법 (MST 없는 행)'), row('11', '상법 시행령'), row('12', '상법')]);
    const { svc } = service();
    const r = await svc.search({ query: '상법' });
    expect(titles(r.items)).toEqual(['상법', '상법 시행령']);
    expect(r).toMatchObject({ total: 2, ranked: true });
  });

  it('컨트롤러: 정렬 없이 온 요청은 맞는 순으로, 정렬을 준 요청은 그 순서로 서비스에 넘긴다 — 빈 검색어는 400', async () => {
    stubLawGoKr(sangbeopRows);
    const { svc } = service();
    const controller = new LawGoKrController(svc);
    const ranked = await controller.search('상법', '1', '20', undefined, 'title');
    expect(ranked.items[0].title).toBe('상법');
    expect(ranked.ranked).toBe(true);
    // 화면이 sort= 처럼 빈 값을 보내도 정렬을 주지 않은 것으로 본다
    expect((await controller.search('상법', '1', '20', '', 'title')).items[0].title).toBe('상법');
    const asc = await controller.search('상법', '1', '20', 'lasc', 'title');
    expect(asc.items[0].title).toBe('1980년해직공무원의보상등에관한특별조치법');
    expect(() => controller.search('   ', '1', '20', undefined, 'title')).toThrow(BadRequestException);
  });

  it('컨트롤러 거부: 모르는 정렬값·너무 긴 검색어·여러 번 온 검색어는 법제처와 캐시 키로 넘기지 않고 400', async () => {
    const urls = stubLawGoKr(sangbeopRows);
    const { svc, store } = service();
    const controller = new LawGoKrController(svc);
    // 법제처는 모르는 정렬값을 조용히 무시한다(실호출) — 넘기면 줄 세우지 않은 결과가 값마다 다른 키로 캐시된다
    expect(() => controller.search('상법', '1', '20', 'abc', 'title')).toThrow(BadRequestException);
    expect(() => controller.search('상법', '1', '20', 'Relevance', 'title')).toThrow(BadRequestException);
    expect(() => controller.search('상법', '1', '20', ['lasc', 'ddes'] as unknown as string, 'title')).toThrow(BadRequestException);
    expect(() => controller.search('가'.repeat(201), '1', '20', undefined, 'title')).toThrow(BadRequestException);
    // 파이프를 거치지 않고 배열이 온 경우 — HTTP 로는 전역 파이프가 'a,b' 한 문자열로 바꾼다
    expect(() => controller.search(['상법', '민법'] as unknown as string, '1', '20', undefined, 'title')).toThrow(BadRequestException);
    expect(urls).toHaveLength(0);
    expect(store.size).toBe(0);
    // 받는 값은 그대로 법제처로 간다
    await controller.search('가'.repeat(200), '1', '20', 'ndes', 'title');
    expect(sent(urls[0])).toMatchObject({ sort: 'ndes', query: '가'.repeat(200) });
  });

  it('자소가 풀린 검색어는 합친 꼴로 법제처에 보낸다 — 법제처는 풀린 꼴에 0건을 준다(2026-11-18 실호출)', async () => {
    const urls = stubLawGoKr(sangbeopRows);
    const { svc } = service();
    const loose = '상법'.normalize('NFD'); // 맥 파일 이름에서 복사하면 이 꼴이다
    expect(loose).not.toBe('상법');
    const r = await svc.search({ query: loose });
    expect(urls[0].searchParams.get('query')).toBe('상법');
    expect(r.items[0].title).toBe('상법');
  });

  it('캐시에 받은 시각이 다른 쪽이 섞여 총건수가 어긋나면 캐시를 건너뛰고 법제처에서 모두 다시 받는다', async () => {
    const old = Array.from({ length: 150 }, (_, i) => row(String(3000 + i), `법률 ${String(i).padStart(3, '0')}`));
    const now = [row('2999', '가나다 새 법률'), ...old]; // 가나다순 맨 앞에 법령 하나가 새로 들어왔다
    const urls = stubLawGoKr(now);
    const { svc, store } = service();
    const key = (page: number) => lawSearchCacheKey({ scope: 1, sort: 'lasc', display: 100, page, query: '법률 099' });
    const cachedPage = (all: LawGoKrSearchItem[], page: number): LawSearchResult => ({
      total: all.length,
      page,
      display: 100,
      items: all.slice((page - 1) * 100, page * 100).map(mapSearchItem),
    });
    store.set(key(1), cachedPage(now, 1)); // 방금 받은 1쪽(151건)
    store.set(key(2), cachedPage(old, 2)); // 150건 때 받은 2쪽 — 그대로 이으면 '법률 099'가 어느 쪽에도 없다

    const r = await svc.search({ query: '법률 099' });
    expect(r.items[0].title).toBe('법률 099');
    expect(r).toMatchObject({ total: 151, ranked: true });
    expect(urls.map((u) => u.searchParams.get('page')).sort()).toEqual(['1', '2']); // 캐시를 건너뛰고 두 쪽 다 새로 받았다
    expect((store.get(key(2)) as LawSearchResult).total).toBe(151); // 새로 받은 쪽으로 캐시를 덮어쓴다
  });

  it('총건수 안의 쪽이 줄 없이 오면(법제처가 쪽을 비워 줌) 0건으로 읽지 않고 502 — 캐시하지 않아 다시 부르면 그 쪽만 새로 받는다', async () => {
    const all = Array.from({ length: 151 }, (_, i) => row(String(4000 + i), `법률 ${String(i).padStart(3, '0')}`));
    process.env.LAW_GO_KR_OC = 'test-oc';
    const pages: string[] = [];
    let emptied = false;
    vi.stubGlobal('fetch', (url: string | URL) => {
      const u = new URL(String(url));
      const page = Number(u.searchParams.get('page'));
      pages.push(String(page));
      // 2쪽이 총건수 151 을 단 채 줄 없이 한 번 온다 — 그대로 이으면 '전체 100건'이 되고 51건이 흔적 없이 빠진다
      const law = page === 2 && !emptied ? ((emptied = true), undefined) : all.slice((page - 1) * 100, page * 100);
      return Promise.resolve(new Response(JSON.stringify({ LawSearch: { resultCode: '00', totalCnt: '151', page: String(page), law } }), { status: 200 }));
    });
    const { svc, store } = service();
    await expect(svc.search({ query: '법률' })).rejects.toMatchObject({ status: 502 });
    expect([...store.keys()]).toEqual([lawSearchCacheKey({ scope: 1, sort: 'lasc', display: 100, page: 1, query: '법률' })]); // 빈 쪽은 캐시하지 않는다
    const r = await svc.search({ query: '법률' });
    expect(r).toMatchObject({ total: 151, ranked: true });
    expect(pages).toEqual(['1', '2', '2']); // 다시 부르면 받아 둔 1쪽은 캐시에서, 2쪽만 새로
  });

  it('법령일련번호가 빈 행만 있는 쪽은 비어 온 것이 아니다 — 그 행만 빼고 줄 세운다(502 가 아니다)', async () => {
    const all = Array.from({ length: 101 }, (_, i) => row(String(5000 + i), `법률 ${String(i).padStart(3, '0')}`));
    all[100] = row('', '법률 100(번호 없는 행)'); // 2쪽의 단 한 줄
    stubLawGoKr(all);
    const { svc } = service();
    const r = await svc.search({ query: '법률' });
    expect(r).toMatchObject({ total: 100, ranked: true });
  });

  it('검색 응답의 본문이 멈추면 제한 시간에 502 로 끝내고, 그 쪽을 기다리던 자리를 비워 다음 요청은 새로 부른다', async () => {
    process.env.LAW_GO_KR_OC = 'test-oc';
    const timeout = process.env.LAW_GO_KR_TIMEOUT_MS;
    process.env.LAW_GO_KR_TIMEOUT_MS = '80'; // 서비스를 만들 때 읽는다
    try {
      let calls = 0;
      vi.stubGlobal('fetch', (_url: string | URL, init?: RequestInit) => {
        calls += 1;
        if (calls > 1) return Promise.resolve(new Response(JSON.stringify(fixture), { status: 200 }));
        // 머리만 보내고 본문을 끝내지 않는 응답 — 중단 신호가 오면 본문 읽기가 실패한다(실제 fetch 와 같다)
        const body = new ReadableStream({
          start(c) {
            init?.signal?.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      });
      const { svc } = service();
      const hung = svc.search({ query: '상법' });
      const joined = svc.search({ query: '상법' }); // 같은 쪽 — 법제처 호출 하나를 같이 기다린다
      await expect(hung).rejects.toMatchObject({ status: 502 });
      await expect(joined).rejects.toMatchObject({ status: 502 });
      const r = await svc.search({ query: '상법' }); // 자리가 비었으니 새로 부른다
      expect(r.items[0].title).toBe('상법');
      expect(calls).toBe(2);
    } finally {
      if (timeout === undefined) delete process.env.LAW_GO_KR_TIMEOUT_MS;
      else process.env.LAW_GO_KR_TIMEOUT_MS = timeout;
    }
  });

  it('같은 검색을 동시에 여러 번 청해도 법제처는 쪽마다 한 번만 부른다', async () => {
    const urls = stubLawGoKr(sangbeopRows);
    const { svc } = service();
    const [a, b, c] = await Promise.all([svc.search({ query: '상법' }), svc.search({ query: '상법' }), svc.search({ query: '상법', page: 2 })]);
    expect(urls).toHaveLength(1);
    expect(a.items[0].title).toBe('상법');
    expect(b.items.map((i) => i.mst)).toEqual(a.items.map((i) => i.mst));
    expect(c.page).toBe(2);
  });

  it('법제처가 검색 상자 없이 답하거나 결과 코드가 실패면 0건이 아니라 502 다 — 캐시하지 않아 다음 요청은 다시 받는다', async () => {
    process.env.LAW_GO_KR_OC = 'test-oc';
    const bodies: unknown[] = [
      {},
      { LawSearch: { resultCode: '99', resultMsg: 'fail', totalCnt: '0' } },
      { LawSearch: { resultCode: '00', resultMsg: 'success', totalCnt: '1', law: row('7', '상법') } }, // 한 건이면 배열이 아니다
    ];
    let n = 0;
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(bodies[n++]), { status: 200 })));
    const { svc, store } = service();
    await expect(svc.search({ query: '상법' })).rejects.toMatchObject({ status: 502 });
    await expect(svc.search({ query: '상법' })).rejects.toMatchObject({ status: 502 });
    expect(store.size).toBe(0); // '없는 법령'으로 10분 캐시되지 않는다
    expect(titles((await svc.search({ query: '상법' })).items)).toEqual(['상법']);
    expect(n).toBe(3);
  });

  it('진짜 0건(상자가 있고 결과 코드 00)은 실패가 아니다 — 빈 목록을 맞는 순 결과로 준다', async () => {
    process.env.LAW_GO_KR_OC = 'test-oc';
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ LawSearch: { resultCode: '00', totalCnt: '0' } }), { status: 200 })));
    const { svc } = service();
    expect(await svc.search({ query: '없는법령' })).toEqual({ total: 0, page: 1, display: 20, items: [], ranked: true });
  });

  it('다시 눌러도 풀리지 않는 실패(인증값 없음·법제처의 인증 거절)는 503 에 code 를 싣는다 — 화면이 문의하라고 안내한다', async () => {
    const { svc } = service();
    delete process.env.LAW_GO_KR_OC;
    await expect(svc.search({ query: '상법' })).rejects.toMatchObject({ status: 503, response: { code: 'LAWGOKR_NOT_CONFIGURED' } });

    process.env.LAW_GO_KR_OC = 'test-oc';
    const refused = { result: '사용자 정보 검증에 실패하였습니다.', msg: 'IP주소 및 도메인주소를 등록해 주세요.' };
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(refused), { status: 200 })));
    await expect(svc.search({ query: '상법' })).rejects.toMatchObject({ status: 503, response: { code: 'LAWGOKR_AUTH' } });
  });

  it('받다가 한 쪽이 실패하면 502 로 답하고 일부만 주지 않는다 — 다시 부르면 실패한 쪽만 새로 받는다', async () => {
    const all = Array.from({ length: 150 }, (_, i) => row(String(2000 + i), `법률 ${i}`));
    const { svc } = service();
    stubLawGoKr(all, 2);
    await expect(svc.search({ query: '법률' })).rejects.toMatchObject({ status: 502 });

    const urls = stubLawGoKr(all);
    const r = await svc.search({ query: '법률' });
    expect(r).toMatchObject({ total: 150, ranked: true });
    expect(urls.map((u) => u.searchParams.get('page'))).toEqual(['2']);
  });
});

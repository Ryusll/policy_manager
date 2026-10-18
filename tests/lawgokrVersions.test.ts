import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LawGoKrService } from '../apps/api/src/lawgokr/lawgokr.service';
import { lawSearchCacheKey, lawVersionListCacheKey } from '../apps/api/src/lawgokr/lawgokr-cache-keys';

/**
 * 판 목록 조회 `searchVersions` (T-151, PAT-07). 법제처 대신 실응답 고정 자료(tests/fixtures/lawgokr-eflaw-2026.json)를 돌려준다.
 *
 * 막고 싶은 사고:
 * 1. 현행 목록(`target=law`, 현행만 준다)을 불러 시행 예정·연혁 판을 놓친다
 * 2. 판 목록과 현행 검색이 같은 캐시 키를 써서 서로의 결과를 돌려준다
 * 3. 공포일 순서가 아닌 정렬로 받아 "기준 공포일에서 멈추기"가 판을 빠뜨린다
 * 4. 법령명으로 찾아 제명이 바뀐 판을 놓치거나 이름이 겹치는 다른 법령이 섞인다 — 법령ID(`LID`)로 부른다
 */
const fixture = readFileSync(join(__dirname, 'fixtures', 'lawgokr-eflaw-2026.json'), 'utf8');

function service() {
  const store = new Map<string, unknown>();
  const cache: any = {
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    set: (k: string, v: unknown) => (store.set(k, v), Promise.resolve()),
  };
  return { svc: new LawGoKrService(cache), store };
}

describe('LawGoKrService.searchVersions (T-151)', () => {
  const oc = process.env.LAW_GO_KR_OC;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (oc === undefined) delete process.env.LAW_GO_KR_OC;
    else process.env.LAW_GO_KR_OC = oc;
  });

  it('시행일법령 목록(target=eflaw)을 법령ID 로, 공포일 내림차순 100건씩 쪽 번호와 함께 부르고 판 행으로 읽는다', async () => {
    process.env.LAW_GO_KR_OC = 'test-oc';
    const urls: URL[] = [];
    vi.stubGlobal('fetch', (url: string | URL) => {
      urls.push(new URL(String(url)));
      return Promise.resolve(new Response(fixture, { status: 200 }));
    });
    const { svc } = service();
    const r = await svc.searchVersions(' 001872 ', 2);
    const q = urls[0].searchParams;
    expect(urls[0].pathname).toMatch(/lawSearch\.do$/);
    expect({ target: q.get('target'), LID: q.get('LID'), sort: q.get('sort'), display: q.get('display'), page: q.get('page'), query: q.get('query') }).toEqual({
      target: 'eflaw',
      LID: '001872',
      sort: 'ddes',
      display: '100',
      page: '2',
      query: null, // 이름으로 찾지 않는다
    });
    expect(r).toMatchObject({ total: 8, page: 2, display: 100 });
    expect(r.items).toHaveLength(8); // 같은 판의 단계 행을 합치는 것은 판 목록(groupVersions)이 한다
    expect(r.items.find((i) => i.mst === '286771')).toMatchObject({ lawId: '001872', promulgationDate: '2026-06-09', promulgationNo: '21784', revisionType: '일부개정', status: '시행예정' });
  });

  it('결과는 판 목록 전용 키로 캐시하고, 다음에는 법제처를 부르지 않는다 — 현행 검색 키와 겹치지 않는다', async () => {
    process.env.LAW_GO_KR_OC = 'test-oc';
    let calls = 0;
    vi.stubGlobal('fetch', () => ((calls += 1), Promise.resolve(new Response(fixture, { status: 200 }))));
    const { svc, store } = service();
    await svc.searchVersions('001872', 1);
    await svc.searchVersions('001872', 1);
    expect(calls).toBe(1);
    expect([...store.keys()]).toEqual([lawVersionListCacheKey('001872', 1)]);
    expect(lawVersionListCacheKey('001872', 1)).not.toBe(lawSearchCacheKey({ scope: 1, sort: 'ddes', display: 100, page: 1, query: '001872' }));
  });

  it('MST 가 빈 행도 버리지 않고 돌려준다 — 저장 판 뒤의 행이면 판 목록이 멈춘다(조용히 버리면 사이 판이 빠진다)', async () => {
    process.env.LAW_GO_KR_OC = 'test-oc';
    const raw = JSON.parse(fixture);
    raw.LawSearch.law.push({ ...raw.LawSearch.law[0], 법령일련번호: '' });
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(raw), { status: 200 })));
    const { svc } = service();
    const r = await svc.searchVersions('001872', 1);
    expect(r.items).toHaveLength(9);
    expect(r.items.filter((i) => i.mst === '')).toHaveLength(1);
  });

  it('본문 — 법령ID 가 빠진 응답은 캐시하지 않는다(등록이 502 로 거절하는데 캐시에 남으면 하루 동안 같은 응답을 받는다)', async () => {
    process.env.LAW_GO_KR_OC = 'test-oc';
    const detail = (lawId?: string) => ({
      법령: {
        기본정보: { ...(lawId ? { 법령ID: lawId } : {}), 법령명_한글: '시험법', 공포일자: '20260101', 시행일자: '20260101' },
        조문: { 조문단위: [{ 조문번호: '1', 조문여부: '조문', 조문내용: '제1조(목적) 본문' }] },
      },
    });
    let body = detail();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));
    const { svc, store } = service();
    expect((await svc.getLaw('900100')).meta.lawId).toBeNull();
    expect(store.size).toBe(0);
    body = detail('990143');
    expect((await svc.getLaw('900100')).meta.lawId).toBe('990143'); // 다시 부르면 법제처에서 새로 받는다
    expect(store.size).toBe(1);
  });

  it('법령ID 가 숫자가 아니면 법제처를 부르지 않고 거절한다 — 걸러지지 않은 엉뚱한 목록을 판 목록으로 읽지 않게', async () => {
    process.env.LAW_GO_KR_OC = 'test-oc';
    let calls = 0;
    vi.stubGlobal('fetch', () => ((calls += 1), Promise.resolve(new Response(fixture, { status: 200 }))));
    const { svc } = service();
    await expect(svc.searchVersions('', 1)).rejects.toThrow('법령ID는 숫자여야 합니다.');
    await expect(svc.searchVersions('근로기준법', 1)).rejects.toThrow('법령ID는 숫자여야 합니다.');
    expect(calls).toBe(0);
  });
});

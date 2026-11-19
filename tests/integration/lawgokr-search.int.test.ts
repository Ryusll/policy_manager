import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomInt } from 'crypto';
import { api, createTenant, login, waitForApi } from './helpers';
import { requireRedis, seedLawSearch, type FakeSearchRow } from './lawgokr-seed';

const PW = 'LawSearchPass!2345';

/**
 * T-210 (SRS LAW-28) 법령명 검색 `GET /lawgokr/search` — 검색어와 맞는 순으로, 끝까지.
 *
 * 막고 싶은 사고(2026-11-18 PM 신고): "상법"을 찾으면 법제처가 약칭에 걸린 것까지 가나다순으로 줘서 상법이 34번째였고,
 * 첫 쪽만 넘기던 서버와 첫 20건만 그리던 등록 창 때문에 끝까지 내려도 상법이 없었다.
 *
 * 법제처를 부르지 않는다 — 서비스가 읽는 쪽 캐시에 가짜 가나다순 결과를 심는다(인증값 없는 CI 에서도 돈다).
 * 검색어는 실행마다 달라 실제 검색 캐시와 겹치지 않는다.
 */
describe('T-210 법령명 검색 — 검색어와 맞는 순', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let viewerToken = '';
  const cleanups: Array<() => void> = [];
  const tag = randomInt(100_000, 999_999);
  const mst = (n: number) => `9${tag}${String(n).padStart(4, '0')}`;

  /** 찾는 법령 — 가나다순으로는 2쪽(121번째)에 있다 */
  const wanted = `가짜상법${tag}`;
  /** 약칭에만 걸린 법령 149건(…보상법) 사이에 이름이 같은 법령 하나 */
  const rows: FakeSearchRow[] = Array.from({ length: 149 }, (_, i) => ({
    mst: mst(i),
    title: `가나다 ${String(i).padStart(3, '0')} 보상 등에 관한 법률`,
    shortTitle: `가나다${i}보${wanted}`,
  }));
  rows.splice(120, 0, { mst: mst(900), title: wanted });
  rows.splice(121, 0, { mst: mst(901), title: `${wanted} 시행령` });

  const search = (params: string, token = t.token) => api(`/lawgokr/search?${params}`, { token });
  const q = encodeURIComponent(wanted);

  beforeAll(async () => {
    await waitForApi();
    requireRedis();
    t = await createTenant('lawsearch');
    const email = `viewer-${t.slug}@example.test`;
    const made = await api('/users', { method: 'POST', token: t.token, json: { email, password: PW, name: 'viewer', role: 'viewer' } });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    viewerToken = (await login(email, PW, t.slug)).body.accessToken as string;
    cleanups.push(seedLawSearch(wanted, rows));
  });

  afterAll(() => {
    for (const cleanup of cleanups) cleanup();
  });

  it('가나다순 2쪽에 있던 같은 이름의 법령이 첫 줄이고, 그 이름으로 시작하는 법령이 뒤따른다 — 20건만 청해도', async () => {
    const r = await search(`q=${q}&display=20`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ total: 151, page: 1, display: 20, ranked: true });
    expect(r.body.items).toHaveLength(20);
    expect(r.body.items[0]).toMatchObject({ mst: mst(900), title: wanted });
    expect(r.body.items[1].title).toBe(`${wanted} 시행령`);
    // 나머지는 약칭에만 걸린 것 — 법제처 순서(가나다) 그대로
    expect(r.body.items[2].title).toBe('가나다 000 보상 등에 관한 법률');
    expect(r.body.items[2].shortTitle).toContain(wanted);
  });

  it('쪽을 끝까지 넘기면 151건이 빠짐·겹침 없이 다 나온다 (법령 등록 창의 더 보기는 100건씩)', async () => {
    const first = await search(`q=${q}&display=100`);
    const second = await search(`q=${q}&display=100&page=2`);
    const third = await search(`q=${q}&display=100&page=3`);
    expect(first.body.items).toHaveLength(100);
    expect(second.body.items).toHaveLength(51);
    expect(third.body.items).toEqual([]); // 끝을 넘긴 쪽은 빈 목록이다(오류가 아니다)
    const all = [...first.body.items, ...second.body.items].map((i: { mst: string }) => i.mst);
    expect(new Set(all).size).toBe(151);
    // 이름이 같은 것, 그 이름으로 시작하는 것, 그리고 약칭에만 걸린 149건은 법제처 순서(심은 순서) 그대로
    expect(all).toEqual([mst(900), mst(901), ...Array.from({ length: 149 }, (_, i) => mst(i))]);
  });

  it('결과가 없으면 빈 목록을 맞는 순 결과로 준다 — 실패가 아니다', async () => {
    const none = `가짜없는법령${tag}`;
    cleanups.push(seedLawSearch(none, []));
    const r = await search(`q=${encodeURIComponent(none)}&display=100`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ total: 0, page: 1, display: 100, items: [], ranked: true });
  });

  it('규정 가져오기 탭처럼 20건씩 넘겨도 같은 줄 세운 목록이 이어진다', async () => {
    const pages = [];
    for (let page = 1; page <= 8; page += 1) pages.push((await search(`q=${q}&display=20&page=${page}`)).body);
    expect(pages.map((p) => p.items.length)).toEqual([20, 20, 20, 20, 20, 20, 20, 11]);
    expect(pages.every((p) => p.total === 151 && p.ranked === true)).toBe(true);
    const whole = (await search(`q=${q}&display=100`)).body.items.concat((await search(`q=${q}&display=100&page=2`)).body.items);
    expect(pages.flatMap((p) => p.items.map((i: { mst: string }) => i.mst))).toEqual(whole.map((i: { mst: string }) => i.mst));
  });

  it('정렬값을 직접 주면 법제처 순서(가나다) 그대로이고 ranked 를 싣지 않는다', async () => {
    const r = await search(`q=${q}&display=100&sort=lasc`);
    expect(r.status).toBe(200);
    expect(r.body.items[0].title).toBe('가나다 000 보상 등에 관한 법률');
    expect(r.body.items.map((i: { title: string }) => i.title)).not.toContain(wanted); // 1쪽(100건)에는 없다 — 예전 동작
    expect(r.body).not.toHaveProperty('ranked');
  });

  it('500건을 넘으면 줄 세우지 않고 가나다순 그대로 주며 ranked:false 로 알린다', async () => {
    const broad = `가짜넓은검색${tag}`;
    const many: FakeSearchRow[] = Array.from({ length: 100 }, (_, i) => ({ mst: mst(2000 + i), title: `넓은 ${String(i).padStart(3, '0')} 법률` }));
    cleanups.push(seedLawSearch(broad, many, 100, 501)); // 총건수를 알려고 읽는 1쪽(100건)
    cleanups.push(seedLawSearch(broad, many.slice(0, 20), 20, 501)); // 청한 쪽(20건) 그대로
    const r = await search(`q=${encodeURIComponent(broad)}&display=20`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ total: 501, page: 1, display: 20, ranked: false });
    expect(r.body.items.map((i: { mst: string }) => i.mst)).toEqual(many.slice(0, 20).map((m) => m.mst));
  });

  it('거부: 검색어가 비거나 너무 길면 400, 모르는 정렬값도 400, 열람자는 403, 로그인하지 않으면 401', async () => {
    expect((await search('q=')).status).toBe(400);
    expect((await search(`q=${encodeURIComponent('   ')}`)).status).toBe(400);
    expect((await search(`q=${encodeURIComponent('가'.repeat(201))}`)).status).toBe(400);
    expect((await search(`q=${q}&sort=abc`)).status).toBe(400);
    expect((await search(`q=${q}&sort=lasc&sort=ddes`)).status).toBe(400); // 여러 번 온 정렬값
    expect((await search(`q=${q}`, viewerToken)).status).toBe(403);
    expect((await api(`/lawgokr/search?q=${q}`)).status).toBe(401);
  });
});

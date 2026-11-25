import { describe, expect, it } from 'vitest';
import type { FakeState } from './demoSeedFake';
import { cites, run, world } from './demoSeedWorld';

/**
 * T-216 8차 적대적 검토 반영 — 예전 시연 규정과 다른 규정에 함께 닿는 변경은 '지우면 풀린다'고 하지 않는다(#2), 막힌 수를 계획·실행이
 * 같은 단위(만들지 않은 후보 = 조문)로 센다(#3), 대역이 서버처럼 확정으로 바뀔 때만 자동 생성하고(#5) 시행 본문 없는 행을 건너뜀으로
 * 돌려준다(#6), 토큰 갱신의 429 도 그 상태로 알린다(#7).
 */
const lsaOf = (st: FakeState) => st.laws.find((l) => l.lawName === '근로기준법')!;
const resultOf = (text: string) => text.split('실행합니다.')[1] ?? '';
const planOf = (text: string) => text.split('실행합니다.')[0];
type RowCite = { code: string; law: string; nodeKey: string; number: number; branchNumber?: number | null; clauseNumber?: number | null };
const rowFor = (st: FakeState, law: string, nodeKey: string) => {
  const cite = (cites as unknown as RowCite[]).find((c) => c.law === law && c.nodeKey === nodeKey)!;
  const pol = st.policies.find((p) => p.code === cite.code)!;
  const row = pol.rows.find((x) => x.number === cite.number && (x.branchNumber ?? null) === (cite.branchNumber ?? null) && (x.clauseNumber ?? null) === (cite.clauseNumber ?? null) && x.itemNumber == null)!;
  return { pol, row };
};
const otherPolicy = (st: FakeState, lawArticleId: string) => {
  st.policies.push({ id: 'pol-other', code: 'OTHER-01', title: '실제 규정', rows: [{ id: 'row-other', number: 1, branchNumber: null, clauseNumber: null, itemNumber: null, content: '본문' }] });
  st.links.push({ id: 'link-other', lawArticleId, articleId: 'row-other', confirmState: 'confirmed' });
};

describe('막힌 변경의 안내와 셈 (T-216 8차 #2·#3)', () => {
  it("예전 시연 규정과 다른 규정에 함께 닿으면 '다른 규정'으로 알리고 '화면에서 지우면 풀린다'고 하지 않는다", async () => {
    const st = world();
    const ev = lsaOf(st).events.find((e) => e.id === 'ev-61-1-1')!;
    st.policies.push({ id: 'pol-old', code: 'OLD-01', title: '옛 시연 규정', rows: [{ id: 'row-old', number: 1, branchNumber: null, clauseNumber: null, itemNumber: null, content: '본문' }] });
    st.importLogs.push({ policyId: 'pol-old', sourceName: 'veda-demo-seed:OLD-01' });
    st.links.push({ id: 'link-old', lawArticleId: ev.lawArticleId!, articleId: 'row-old', confirmState: 'confirmed' });
    otherPolicy(st, ev.lawArticleId!);
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(planOf(r.text)).toContain('다른 규정에도 닿아 만들지 않음 1건');
    expect(planOf(r.text)).not.toContain('예전 시연 규정에 닿아 만들지 않음');
    const result = resultOf(r.text);
    expect(result).toContain("다른 규정에도 닿아 '개정 후보 만들기'를 하지 않음: 근로기준법 제61조제1항제1호(다른 규정 1개 · 예전 시연 규정 1개)");
    expect(result).toContain('시연 전용 고객사에서 실행하세요');
    expect(result).not.toContain('화면에서 지우면 풀립니다');
  });

  it('한 변경이 시연 조문 둘에 닿고 막히면 계획·실행 모두 만들지 않은 후보 2건', async () => {
    const st = world();
    await run(st);
    const ev = lsaOf(st).events.find((e) => e.id === 'ev-61-1-1')!;
    const { pol, row } = rowFor(st, '근로기준법', '61/1/1');
    // 그 변경의 후보를 지우고, 같은 규정의 다른 조문도 같은 조항에 손으로 확정 연결 — 다른 규정도 닿는다
    st.candidates = st.candidates.filter((c) => c.eventId !== ev.id);
    const second = pol.rows.find((x) => x.content && x.id !== row.id)!;
    st.links.push({ id: 'link-hand', lawArticleId: ev.lawArticleId!, articleId: second.id, confirmState: 'confirmed' });
    otherPolicy(st, ev.lawArticleId!);
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(planOf(r.text)).toContain('다른 규정에도 닿아 만들지 않음 2건');
    expect(resultOf(r.text)).toContain('다른 규정에도 닿아 만들지 않은 후보 2건');
  });

  it('일부 조문에만 후보가 있어 만들지 않은 것도 계획·실행 모두 후보 수로', async () => {
    const st = world();
    await run(st);
    const ev = lsaOf(st).events.find((e) => e.id === 'ev-61-1-1')!;
    const { pol, row } = rowFor(st, '근로기준법', '61/1/1');
    const second = pol.rows.find((x) => x.content && x.id !== row.id)!;
    st.links.push({ id: 'link-hand', lawArticleId: ev.lawArticleId!, articleId: second.id, confirmState: 'confirmed' });
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(planOf(r.text)).toContain('일부 조문에만 후보가 있어 만들지 않음 1건');
    expect(resultOf(r.text)).toContain('일부 조문에만 후보가 있어 만들지 않은 후보 1건');
  });
});

// 만들지 않은 변경(일부 조문에만·다른 규정에도 닿음)에서도 후보가 이미 있는 시연 조문은 '이미 있음'으로 센다 — 계획과 실행이 같은
// 셈(완료 기록 C-117 ②). 되돌려 보기(11/20)에서 실행 쪽 셈을 잡는 시험이 없었다
describe('만들지 않은 변경의 이미 있는 후보 (T-216 되돌려 보기 11/20)', () => {
  const linkSecondRow = (st: FakeState) => {
    const ev = lsaOf(st).events.find((e) => e.id === 'ev-61-1-1')!;
    const { pol, row } = rowFor(st, '근로기준법', '61/1/1');
    const second = pol.rows.find((x) => x.content && x.id !== row.id)!;
    st.links.push({ id: 'link-hand', lawArticleId: ev.lawArticleId!, articleId: second.id, confirmState: 'confirmed' });
    return ev;
  };

  // 첫 실행이 닿는 변경마다 시연 조문 하나에 후보를 만든 뒤다 — '이미 있음'은 실행 전에 있던 후보 수(만들지 않는 변경의 것 포함)
  const firstRun = async () => {
    const st = world();
    await run(st);
    const had = st.candidates.length;
    expect(st.candidates.filter((c) => c.eventId === 'ev-61-1-1')).toHaveLength(1);
    return { st, had };
  };

  it('일부 조문에만 후보가 있는 변경의 후보 있는 조문도 이미 있음 — 계획·실행 모두 실행 전에 있던 후보 수', async () => {
    const { st, had } = await firstRun();
    linkSecondRow(st);
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(resultOf(r.text)).toContain('일부 조문에만 후보가 있어 만들지 않은 후보 1건');
    expect(planOf(r.text)).toContain(`개정 후보: 새로 최대 0건(연결하면 바로 0 · 만들기 0), 이미 있음 ${had}건`);
    expect(resultOf(r.text)).toContain(`새로 0건, 이미 있음 ${had}건`);
    expect(st.candidates).toHaveLength(had);
  });

  it('다른 규정에도 닿아 만들지 않는 변경의 후보 있는 조문도 이미 있음 — 계획·실행 모두 실행 전에 있던 후보 수', async () => {
    const { st, had } = await firstRun();
    const ev = linkSecondRow(st);
    otherPolicy(st, ev.lawArticleId!);
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(resultOf(r.text)).toContain("다른 규정에도 닿아 '개정 후보 만들기'를 하지 않음");
    expect(planOf(r.text)).toContain(`개정 후보: 새로 최대 0건(연결하면 바로 0 · 만들기 0), 이미 있음 ${had}건`);
    expect(resultOf(r.text)).toContain(`새로 0건, 이미 있음 ${had}건`);
    expect(st.candidates).toHaveLength(had);
  });
});

describe('대역 충실도·토큰 갱신 (T-216 8차 #5·#6·#7)', () => {
  it('연결을 추천·반려로 바꾸는 PATCH 에는 자동 생성하지 않는다(확정으로 바뀔 때만) — 그 조문에 같은 변경에 닿는 다른 확정 연결이 있어도', async () => {
    const st = world();
    await run(st);
    const lsa = lsaOf(st);
    const ev = lsa.events.find((e) => e.id === 'ev-54-1')!;
    const { row } = rowFor(st, '근로기준법', '54/1/');
    st.candidates = st.candidates.filter((c) => !(c.eventId === ev.id && c.articleId === row.id));
    const link = st.links.find((l) => l.articleId === row.id && l.lawArticleId === ev.lawArticleId)!;
    lsa.articles.push({ id: 'law-x-54', nodeKey: '54//', label: '제54조' });
    st.links.push({ id: 'link-upper', lawArticleId: 'law-x-54', articleId: row.id, confirmState: 'confirmed' });
    const { fakeFetch } = await import('./demoSeedFake');
    const send = fakeFetch(st);
    const call = (confirmState: string) =>
      send('https://veda.example.test/api/law-links/' + link.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmState }) });
    await call('suggested');
    expect(st.candidates.some((c) => c.eventId === ev.id && c.articleId === row.id)).toBe(false);
    await call('confirmed');
    expect(st.candidates.some((c) => c.eventId === ev.id && c.articleId === row.id)).toBe(true);
  });

  it("'개정 후보 만들기'가 시행 본문 없는 시연 행에 닿으면 서버처럼 건너뜀으로 센다", async () => {
    const st = world();
    const ev = lsaOf(st).events.find((e) => e.id === 'ev-61-1-1')!;
    // 첫 실행으로 시연 규정을 넣고, 그 변경의 후보를 지우고, 본문 없는 행을 같은 조항에 확정 연결
    await run(st);
    const { pol } = rowFor(st, '근로기준법', '61/1/1');
    st.candidates = st.candidates.filter((c) => c.eventId !== ev.id);
    pol.rows.push({ id: 'row-blank', number: 99, branchNumber: null, clauseNumber: null, itemNumber: null, content: '' });
    st.links.push({ id: 'link-blank', lawArticleId: ev.lawArticleId!, articleId: 'row-blank', confirmState: 'confirmed' });
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    // 만들기가 시연 행(본문 있음)에 하나 만들고, 본문 없는 행은 서버처럼 건너뜀으로 돌려준다
    expect(resultOf(r.text)).toMatch(/새로 1건, 이미 있음 \d+건, 건너뜀 1건/);
  });

  it('토큰 갱신이 요청 한도(429)에 걸리면 다른 요청처럼 기다렸다 다시 보낸다(9차 #8) — 끝내 넘지 못하면 원래 401 대신 그 상태를 알린다', async () => {
    const expired = { method: 'GET', path: '/lawgokr/status', status: 401, body: { statusCode: 401, message: 'Unauthorized' } };
    const limited = { method: 'POST', path: '/auth/refresh', status: 429, body: { statusCode: 429, message: 'Too Many Requests' }, headers: { 'retry-after': '7' } };
    const once = await run(world({ once: [expired, limited] }));
    expect(once.code, once.text).toBe(0);
    expect(once.sleeps).toContain(7000);
    const always = await run(world({ once: [expired, ...Array.from({ length: 5 }, () => ({ ...limited }))] }));
    expect(always.code).toBe(1);
    expect(always.text).toContain('POST /auth/refresh → 429');
  });
});

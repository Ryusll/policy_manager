import { describe, expect, it } from 'vitest';
import { fakeFetch, type FakeState } from './demoSeedFake';
import { cites, run, world } from './demoSeedWorld';

/**
 * T-216 9차 적대적 검토 반영 — 예전 시연 규정 줄이 '다른 규정'으로 막힌다고 하지 않는다(#1), 후보가 생기지 않은 법령의 까닭에 '예전
 * 시연 규정에 닿음'(#2), 예전 시연 규정에만 막혔는데 일부 시연 조문에 이미 후보가 있으면 '지운 뒤 --reset'(#4), 막힌 변경뿐이면 마지막
 * 줄은 까닭을 보라고(#5 — 막힘을 따로 받지 않아도 그 법령이 reachedNone 에 든다), 대역은 확정이 아니던 연결이 확정될 때만 자동으로
 * 만든다(#6).
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
/** 예전 시연 규정(표시는 있지만 지금 시연 문서에 없는 코드) — 그 변경의 조항에 확정 연결 */
const oldPolicy = (st: FakeState, lawArticleId: string) => {
  st.policies.push({ id: 'pol-old', code: 'OLD-01', title: '옛 시연 규정', rows: [{ id: 'row-old', number: 1, branchNumber: null, clauseNumber: null, itemNumber: null, content: '본문' }] });
  st.importLogs.push({ policyId: 'pol-old', sourceName: 'veda-demo-seed:OLD-01' });
  st.links.push({ id: 'link-old', lawArticleId, articleId: 'row-old', confirmState: 'confirmed' });
};

describe('예전 시연 규정에만 막힌 변경의 안내 (T-216 9차 #1·#2·#5)', () => {
  // 창 밖 변경 하나(제61조제1항제1호)만 남긴다 — 예전 시연 규정에 닿아 만들지 않으면 후보가 하나도 없다
  const onlyBlocked = () => {
    const st = world();
    for (const l of st.laws) l.events = l.events.filter((e) => e.id === 'ev-61-1-1');
    const ev = lsaOf(st).events[0];
    oldPolicy(st, ev.lawArticleId!);
    return st;
  };

  it("예전 시연 규정 줄은 '다른 규정'으로 막힌다고 하지 않고, 후보가 생기지 않은 법령의 까닭에 '예전 시연 규정에 닿음'을 적는다", async () => {
    const r = await run(onlyBlocked());
    expect(r.code, r.text).toBe(0);
    const plan = planOf(r.text);
    expect(plan).toContain("예전에 이 스크립트가 넣은 것으로 보이는 규정(지금 시연 문서에 없는 코드): OLD-01");
    // 그 줄이 가리키는 곳 — 예전 시연 규정에만 닿으면 '예전 시연 규정에 닿아 …', 다른 규정에도 닿으면 '다른 규정에도 닿아 …'(10차 #1)
    expect(plan).toContain("그 규정에만 닿으면 '예전 시연 규정에 닿아 …', 다른 규정에도 닿으면 '다른 규정에도 닿아 …' — 이때는 지워도 막힌다");
    expect(plan).not.toContain("'다른 규정'");
    expect(plan).toMatch(/후보가 생기지 않을 법령\([^)]*예전 시연 규정에 닿음[^)]*\): 근로기준법/);
    expect(resultOf(r.text)).toMatch(/후보가 생기지 않은 법령\([^)]*예전 시연 규정에 닿음[^)]*\): 근로기준법/);
  });

  it('막힌 변경뿐이라 처리 대기가 0건이면 계획·실행 모두 마지막 줄은 까닭을 보라고 한다(변경 없음 — PM 이 아니다)', async () => {
    const r = await run(onlyBlocked());
    for (const part of [planOf(r.text), resultOf(r.text)]) {
      expect(part).toContain('위 법령 줄의 까닭을 보세요');
      expect(part).not.toContain('이 서버가 감지한 변경이 없습니다');
    }
  });

  it("일부 시연 조문에 이미 그 변경의 후보가 있으면 '지운 뒤 --reset' — 지우기만 하면 '일부 조문에만'으로 다시 막힌다", async () => {
    const st = world();
    await run(st); // 창 밖 변경의 후보가 그 시연 조문에 생긴다
    const ev = lsaOf(st).events.find((e) => e.id === 'ev-61-1-1')!;
    const { pol, row } = rowFor(st, '근로기준법', '61/1/1');
    const second = pol.rows.find((x) => x.content && x.id !== row.id)!;
    st.links.push({ id: 'link-hand', lawArticleId: ev.lawArticleId!, articleId: second.id, confirmState: 'confirmed' });
    oldPolicy(st, ev.lawArticleId!);
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    for (const part of [planOf(r.text), resultOf(r.text)]) expect(part).toContain('그 규정을 화면에서 지운 뒤 --reset 으로 다시 채우면 풀립니다');
    expect(resultOf(r.text)).not.toContain('그 규정을 화면에서 지우면 풀립니다');
    // 화면에서 그 규정을 지운다 — 다시 돌리면 '일부 조문에만 후보'로 막힌다(그래서 --reset 까지 적었다)
    st.policies = st.policies.filter((p) => p.id !== 'pol-old');
    st.links = st.links.filter((l) => l.articleId !== 'row-old');
    const after = await run(st);
    expect(resultOf(after.text)).toContain("일부 시연 조문에만 후보가 있어 '개정 후보 만들기'를 하지 않음(다시 채우려면 --reset)");
  });

  it("후보가 없는 조문에만 닿으면 '지우면 풀립니다'(--reset 은 필요 없다)", async () => {
    const r = await run(onlyBlocked());
    for (const part of [planOf(r.text), resultOf(r.text)]) {
      expect(part).toContain('그 규정을 화면에서 지우면 풀립니다');
      expect(part).not.toContain('지운 뒤 --reset');
    }
  });
});

describe('요청 한도 — 로그인·갱신·요청이 한 규칙 (T-216 9차 #8)', () => {
  it('로그인이 429 한 번이면 Retry-After 만큼 기다렸다 다시 보내 로그인한다', async () => {
    const r = await run(world({ once: [{ method: 'POST', path: '/auth/login', status: 429, body: { message: 'Too Many Requests' }, headers: { 'retry-after': '3' } }] }));
    expect(r.code, r.text).toBe(0);
    expect(r.sleeps).toContain(3000);
    expect(r.text).toContain('로그인 요청 한도에 걸려 3초 기다렸다 다시 보냅니다.');
  });
});

describe('대역 충실도 (T-216 9차 #6)', () => {
  it('이미 확정인 연결을 다시 확정해도 서버처럼 창 안 변경의 후보를 만들지 않는다 — 확정이 아니던 연결이 확정될 때만', async () => {
    const st = world();
    await run(st);
    const ev = lsaOf(st).events.find((e) => e.id === 'ev-60-5')!; // 창 안 변경
    const link = st.links.find((l) => l.lawArticleId === ev.lawArticleId && l.confirmState === 'confirmed')!;
    st.candidates = st.candidates.filter((c) => !(c.eventId === ev.id && c.articleId === link.articleId));
    const patch = (confirmState: string) =>
      fakeFetch(st)(`https://veda.example.test/api/law-links/${link.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmState }) });
    await patch('confirmed');
    expect(st.candidates.some((c) => c.eventId === ev.id && c.articleId === link.articleId)).toBe(false);
    await patch('suggested');
    await patch('confirmed');
    expect(st.candidates.some((c) => c.eventId === ev.id && c.articleId === link.articleId)).toBe(true);
  });
});

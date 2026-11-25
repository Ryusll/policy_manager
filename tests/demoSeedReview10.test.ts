import { describe, expect, it } from 'vitest';
import { fakeFetch, type FakeState } from './demoSeedFake';
import { cites, run, world } from './demoSeedWorld';

/**
 * T-216 10차 적대적 검토 반영 — 계획의 '지운 뒤 --reset' 판정이 이번에 잇는 조문(옛 후보가 남은 조문 freshHas, 창 안이라 연결하면
 * 바로 생기는 auto)도 센다(#2), 다른 규정에만 막혀 후보가 0건이면 마지막 줄이 까닭을 보라고 한다(회귀 #2).
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
const oldPolicy = (st: FakeState, lawArticleId: string) => {
  st.policies.push({ id: 'pol-old', code: 'OLD-01', title: '옛 시연 규정', rows: [{ id: 'row-old', number: 1, branchNumber: null, clauseNumber: null, itemNumber: null, content: '본문' }] });
  st.importLogs.push({ policyId: 'pol-old', sourceName: 'veda-demo-seed:OLD-01' });
  st.links.push({ id: 'link-old', lawArticleId, articleId: 'row-old', confirmState: 'confirmed' });
};
const otherPolicy = (st: FakeState, lawArticleId: string) => {
  st.policies.push({ id: 'pol-other', code: 'OTHER-01', title: '실제 규정', rows: [{ id: 'row-other', number: 1, branchNumber: null, clauseNumber: null, itemNumber: null, content: '본문' }] });
  st.links.push({ id: 'link-other', lawArticleId, articleId: 'row-other', confirmState: 'confirmed' });
};
const RESET = '그 규정을 화면에서 지운 뒤 --reset 으로 다시 채우면 풀립니다';

describe('계획의 지운 뒤 --reset — 이번에 잇는 조문도 센다 (T-216 10차 #2)', () => {
  it('화면에서 연결을 지워 옛 후보만 남은 조문을 다시 잇는 경우(freshHas)', async () => {
    const st = world();
    await run(st); // 창 밖 변경(제61조제1항제1호)의 후보가 인용 조문에 생긴다
    const ev = lsaOf(st).events.find((e) => e.id === 'ev-61-1-1')!;
    const { pol, row } = rowFor(st, '근로기준법', '61/1/1');
    // 화면에서 그 인용 조문의 연결을 지웠다(후보는 남는다) — 이번 계획은 다시 잇고, 그 조문에는 이미 후보가 있다. 다른 조문의 후보는 없앤다
    st.links = st.links.filter((l) => !(l.articleId === row.id && l.lawArticleId === ev.lawArticleId));
    st.candidates = st.candidates.filter((c) => c.eventId !== ev.id || c.articleId === row.id);
    const second = pol.rows.find((x) => x.content && x.id !== row.id)!;
    st.links.push({ id: 'link-hand', lawArticleId: ev.lawArticleId!, articleId: second.id, confirmState: 'confirmed' });
    oldPolicy(st, ev.lawArticleId!);
    const r = await run(st, ['--plan']);
    expect(r.code, r.text).toBe(0);
    expect(r.text).toContain(RESET);
    expect(r.text).not.toContain(')(위'); // 괄호가 잇닿지 않는다(10차 회귀 #3)
    // 그 규정이 어느 줄인지는 첫 문장에 — 끝에 붙이면 '일부 조문에만' 설명을 가리키는 것처럼 읽혔다(11차 #3)
    expect(r.text).toContain(`${RESET}(위 '예전에 이 스크립트가 넣은 것으로 보이는 규정' 줄). 일부 시연 조문에`);
    expect(r.text).toContain(`(그 규정에도 후보가 생긴다). ${RESET}`); // 한 문장에 대시 둘을 잇지 않는다(11차 #3)
  });

  it('창 안 변경 — 이번에 잇는 조문에 연결하면 바로 후보가 생기는 경우(auto)', async () => {
    const st = world();
    await run(st);
    const ev = lsaOf(st).events.find((e) => e.id === 'ev-60-5')!; // 창 안(시행 2027-06-10)
    const linked = st.links.filter((l) => l.lawArticleId === ev.lawArticleId);
    const target = linked[0];
    // 그 조문의 연결과 이 변경의 후보를 지운다 — 이번 계획은 다시 잇고, 창 안이라 연결하면 바로 후보가 생긴다
    st.links = st.links.filter((l) => l.id !== target.id);
    st.candidates = st.candidates.filter((c) => c.eventId !== ev.id);
    // 다른 시연 조문 하나 — 시행 본문이 없을 때 화면에서 확정 연결해(서버처럼 그때는 후보가 생기지 않는다, 11차 #4) 그 뒤에 본문이
    // 생겼다. 그래서 확정 연결은 있고 이 변경의 후보는 없는 조문이 남아 예전 시연 규정에 막힌다
    const pol = st.policies.find((p) => p.rows.some((x) => x.id === target.articleId))!;
    const late = { id: 'row-late', number: 98, branchNumber: null, clauseNumber: null, itemNumber: null, content: '' };
    pol.rows.push(late);
    await fakeFetch(st)('https://veda.example.test/api/law-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lawArticleId: ev.lawArticleId, articleId: late.id }),
    });
    expect(st.candidates.some((c) => c.articleId === late.id)).toBe(false);
    late.content = '나중에 채운 본문';
    oldPolicy(st, ev.lawArticleId!);
    const r = await run(st, ['--plan']);
    expect(r.code, r.text).toBe(0);
    expect(r.text).toContain(RESET);
  });
});

describe("까닭 괄호의 '규정에서 찾지 못한 행' (T-216 10차 #3)", () => {
  it('남아 있는 시연 규정에서 인용한 행을 화면에서 지웠으면 그 법령이 후보 없는 까닭 줄에 들고 괄호에 그 까닭이 있다 — --reset 하면 그 행이 돌아와 후보가 생긴다(12차 #4)', async () => {
    const st = world();
    for (const l of st.laws) l.events = l.events.filter((e) => e.id === 'ev-61-1-1');
    await run(st);
    const { pol, row } = rowFor(st, '근로기준법', '61/1/1');
    // 화면에서 그 조문을 지웠다 — 연결·후보도 함께 지워진다(조문 FK Cascade)
    pol.rows = pol.rows.filter((x) => x.id !== row.id);
    st.links = st.links.filter((l) => l.articleId !== row.id);
    st.candidates = st.candidates.filter((c) => c.articleId !== row.id);
    const r = await run(st, ['--plan']);
    expect(r.code, r.text).toBe(0);
    expect(r.text).toContain('규정에서 그 행을 찾지 못해 잇지 않음');
    expect(r.text).toMatch(/후보가 생기지 않을 법령\([^)]*규정에서 찾지 못한 행[^)]*\): 근로기준법/);
    // 마지막 줄의 처방대로 --reset 하면 시연 규정을 다시 넣어 그 행이 돌아오고, 이어져 후보가 생긴다(12차 #4) — 그 전에는 그 변경의
    // 후보가 하나도 없다(행과 함께 지웠다 — 아래 단언이 --reset 이 새로 만든 후보만 보게, 22차)
    expect(r.text).toContain('규정에서 찾지 못한 행은 --reset 으로');
    expect(st.candidates.filter((c) => c.eventId === 'ev-61-1-1')).toHaveLength(0);
    const reset = await run(st, ['--reset']);
    expect(reset.code, reset.text).toBe(0);
    expect(resultOf(reset.text)).not.toContain('규정에서 그 행을 찾지 못함');
    expect(st.candidates.some((c) => c.eventId === 'ev-61-1-1')).toBe(true);
  });
});

describe('다른 규정에만 막혀 후보가 0건 — 마지막 줄 (T-216 10차 회귀 #2)', () => {
  it('계획·실행 모두 까닭을 보라고 한다(변경 없음 — PM 이 아니다)', async () => {
    const st = world();
    for (const l of st.laws) l.events = l.events.filter((e) => e.id === 'ev-61-1-1');
    otherPolicy(st, lsaOf(st).events[0].lawArticleId!);
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    for (const part of [planOf(r.text), resultOf(r.text)]) {
      expect(part).toContain('위 법령 줄의 까닭을 보세요');
      expect(part).not.toContain('이 서버가 감지한 변경이 없습니다');
    }
    expect(resultOf(r.text)).toContain("다른 규정에도 닿아 '개정 후보 만들기'를 하지 않음");
  });
});

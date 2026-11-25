import { describe, expect, it } from 'vitest';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { validateDemoPolicies } from '../scripts/demo/lib/demo-policies.mjs';
import type { FakeState } from './demoSeedFake';
import { cites, run, SANG, world } from './demoSeedWorld';

/**
 * T-216 7차 적대적 검토 반영 — 연결을 지웠다 다시 잇는 조문의 옛 후보는 '새로'가 아니다(#1), 화면에서 더 건 확정 연결로 이미 판정에 든
 * 조문을 계획이 두 번 세지 않는다(#2), 지운 행은 법령 등록을 기다리는 인용이어도 잇지 않음이다(#3), 연결 셈이 계획·실행 같다(#4),
 * 예전 시연 규정에 막힌 변경은 화면에서 지우면 풀린다고 알린다(#5), 대역의 연결 확정 자동 생성이 서버(onlyNew)와 같다(#7),
 * 토큰 갱신의 5xx 도 서버를 보라고 한다(#8), 가지 번호 0 은 받지 않는다(#10).
 */
const lsaOf = (st: FakeState) => st.laws.find((l) => l.lawName === '근로기준법')!;
const resultOf = (text: string) => text.split('실행합니다.')[1] ?? '';
const planOf = (text: string) => text.split('실행합니다.')[0];
type RowCite = { code: string; law: string; nodeKey: string; number: number; branchNumber?: number | null; clauseNumber?: number | null };
const rowCites = cites as unknown as RowCite[];
/** 그 인용이 가리키는 시연 규정의 행 */
const rowFor = (st: FakeState, law: string, nodeKey: string) => {
  const cite = rowCites.find((c) => c.law === law && c.nodeKey === nodeKey)!;
  const pol = st.policies.find((p) => p.code === cite.code)!;
  const row = pol.rows.find((x) => x.number === cite.number && (x.branchNumber ?? null) === (cite.branchNumber ?? null) && (x.clauseNumber ?? null) === (cite.clauseNumber ?? null) && x.itemNumber == null)!;
  return { cite, pol, row };
};
const lineOf = (text: string, head: string) => text.split('\n').find((l) => l.startsWith(head)) ?? '';

describe("연결을 지웠다 다시 잇는 조문 — 옛 후보는 '새로'가 아니다 (T-216 7차 #1)", () => {
  it('화면에서 시연 연결을 지워도 후보는 남는다 — 다시 돌리면 연결은 새로, 후보는 이미 있음(계획·실행 같은 셈)', async () => {
    const st = world();
    await run(st);
    const ev = lsaOf(st).events.find((e) => e.id === 'ev-54-1')!;
    const { row } = rowFor(st, '근로기준법', '54/1/');
    st.links = st.links.filter((l) => !(l.articleId === row.id && l.lawArticleId === ev.lawArticleId));
    const before = st.candidates.length;
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(st.candidates.length).toBe(before);
    expect(planOf(r.text)).toContain('개정 후보: 새로 최대 0건(연결하면 바로 0 · 만들기 0), 이미 있음 3건');
    expect(resultOf(r.text)).toContain('개정 후보: 닿는 변경 3건에서 새로 0건, 이미 있음 3건');
    expect(resultOf(r.text)).not.toContain('연결하면서 생김');
  });
});

describe('화면에서 더 건 확정 연결로 이미 판정에 든 조문 (T-216 7차 #2)', () => {
  it('후보가 있으면 이미 있음 한 번 — 두 번 세지 않는다', async () => {
    const st = world();
    await run(st);
    const lsa = lsaOf(st);
    const ev = lsa.events.find((e) => e.id === 'ev-61-1-1')!;
    const { row } = rowFor(st, '근로기준법', '61/1/1');
    // 시연 연결은 지우고, 같은 조문을 상위 조항(제61조)에 손으로 확정 연결 — 그 조문은 지금 판정에 후보와 함께 들어 있다
    st.links = st.links.filter((l) => !(l.articleId === row.id && l.lawArticleId === ev.lawArticleId));
    lsa.articles.push({ id: 'law-x-61', nodeKey: '61//', label: '제61조' });
    st.links.push({ id: 'link-hand', lawArticleId: 'law-x-61', articleId: row.id, confirmState: 'confirmed' });
    const plan = await run(st, ['--plan']);
    expect(plan.text).toContain('개정 후보: 새로 최대 0건(연결하면 바로 0 · 만들기 0), 이미 있음 3건');
  });

  it('창 안 변경이고 후보가 없으면 시연 연결을 확정할 때 바로 생긴다 — 일부 조문에만 있다고 잘못 알리지 않는다', async () => {
    const st = world();
    await run(st);
    const lsa = lsaOf(st);
    const ev = lsa.events.find((e) => e.id === 'ev-54-1')!;
    const { row } = rowFor(st, '근로기준법', '54/1/');
    st.links = st.links.filter((l) => !(l.articleId === row.id && l.lawArticleId === ev.lawArticleId));
    st.candidates = st.candidates.filter((c) => !(c.eventId === ev.id && c.articleId === row.id));
    lsa.articles.push({ id: 'law-x-54', nodeKey: '54//', label: '제54조' });
    st.links.push({ id: 'link-hand', lawArticleId: 'law-x-54', articleId: row.id, confirmState: 'confirmed' });
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(planOf(r.text)).toContain('개정 후보: 새로 최대 1건(연결하면 바로 1 · 만들기 0), 이미 있음 2건');
    expect(planOf(r.text)).not.toContain('일부 조문에만');
    expect(resultOf(r.text)).toContain('새로 1건(연결하면서 생김 1 · 만들기 0), 이미 있음 2건');
  });
});

describe('지운 행·연결 셈 (T-216 7차 #3·#4)', () => {
  it('법령 등록을 기다리는 인용이어도 지운 행은 잇지 않음으로 센다', async () => {
    const st = world();
    await run(st); // 상법을 이때 등록한다
    // 상법이 다시 목록에 없고(등록할 법령), 상법을 인용한 시연 행 하나를 화면에서 지운 것처럼
    const sang = st.laws.find((l) => l.lawName === SANG)!;
    st.laws = st.laws.filter((l) => l !== sang);
    st.registerable['9002'] = { lawName: SANG, articles: sang.articles.map((a) => ({ nodeKey: a.nodeKey, label: a.label })) };
    const { pol, row, cite } = rowFor(st, SANG, rowCites.find((c) => c.law === SANG)!.nodeKey);
    pol.rows = pol.rows.filter((x) => x.id !== row.id);
    const plan = await run(st, ['--plan']);
    expect(plan.text).toMatch(new RegExp(`규정에서 그 행을 찾지 못해 잇지 않음[^\\n]*: [^\\n]*→ ${SANG} `));
    // 지운 행의 인용(한 행에 여럿일 수 있다)은 등록 뒤로 세지 않는다
    const sameRow = (c: RowCite) => c.code === cite.code && c.number === cite.number && (c.branchNumber ?? null) === (cite.branchNumber ?? null) && (c.clauseNumber ?? null) === (cite.clauseNumber ?? null);
    const waits = rowCites.filter((c) => c.law === SANG && !sameRow(c)).length;
    expect(plan.text).toMatch(new RegExp(`법령 등록 뒤 ${waits}건`));
  });

  it('추천·반려 연결이 있으면 계획과 실행의 법령 연결 줄이 같다', async () => {
    const st = world();
    await run(st);
    const demoLinks = st.links.filter((l) => l.confirmState === 'confirmed');
    demoLinks[0].confirmState = 'suggested';
    demoLinks[1].confirmState = 'rejected';
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    const planned = lineOf(planOf(r.text), '법령 연결:');
    expect(planned).toMatch(/법령 연결: 새로 0건, 이미 있음 \d+건, 추천을 확정 1건$/);
    expect(lineOf(resultOf(r.text).trim(), '법령 연결:')).toBe(planned);
  });
});

describe('예전 시연 규정에 막힌 변경 (T-216 7차 #5)', () => {
  it("막힌 까닭이 예전 시연 규정이면 '시연 전용 고객사'가 아니라 화면에서 지우면 풀린다고 알린다(계획·실행)", async () => {
    const st = world();
    const ev = lsaOf(st).events.find((e) => e.id === 'ev-61-1-1')!;
    st.policies.push({ id: 'pol-old', code: 'OLD-01', title: '옛 시연 규정', rows: [{ id: 'row-old', number: 1, branchNumber: null, clauseNumber: null, itemNumber: null, content: '본문' }] });
    st.importLogs.push({ policyId: 'pol-old', sourceName: 'veda-demo-seed:OLD-01' });
    st.links.push({ id: 'link-old', lawArticleId: ev.lawArticleId!, articleId: 'row-old', confirmState: 'confirmed' });
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    // 8차 #1 — 예전 시연 규정에만 막혔으면 '다른 규정'·'시연 전용 고객사' 안내를 내지 않는다(서로 다른 처방이 한 출력에 섞였다)
    const plan = planOf(r.text);
    expect(plan).toContain('예전 시연 규정에 닿아 만들지 않음 1건');
    expect(plan).toContain("예전 시연 규정에만 확정 연결이 닿는 변경도 '개정 후보 만들기'를 하지 않습니다");
    expect(plan).not.toContain('다른 규정에도 닿아 만들지 않음');
    expect(plan).not.toContain('시연 전용 고객사에서 실행하세요');
    const result = resultOf(r.text);
    expect(result).toContain("예전 시연 규정에 닿아 '개정 후보 만들기'를 하지 않음: 근로기준법 제61조제1항제1호(예전 시연 규정 1개)");
    expect(result).toContain('그 규정을 화면에서 지우면 풀립니다');
    expect(result).toContain('예전 시연 규정에 닿아 만들지 않은 후보 1건');
    expect(result).not.toContain('다른 규정에도 닿아');
    expect(result).not.toContain('시연 전용 고객사에서 실행하세요');
    expect(st.candidates.filter((c) => c.policyId === 'pol-old')).toEqual([]);
  });
});

describe('대역 충실도·토큰 갱신·가지 번호 (T-216 7차 #7·#8·#10)', () => {
  it('대역의 연결 확정 자동 생성은 서버처럼 — 그 조문에 이 변경의 후보가 있으면 다른 날에도 새로 만들지 않는다', async () => {
    const st = world();
    const lsa = lsaOf(st);
    const art = lsa.articles.find((a) => a.nodeKey === '61/1/1')!;
    // 창 안(오늘 − 30일 이후)이지만 시행일이 지나 기준일이 오늘이 되는 변경 — 날이 바뀌면 서버의 중복 판정 열쇠가 바뀐다
    lsa.events.push({ id: 'ev-recent', nodeKey: '61/1/1', label: '제61조제1항제1호', lawEffectiveDate: '2026-11-10', promulgatedDate: '2026-11-01', lawArticleId: art.id });
    await run(st);
    const n = st.candidates.filter((c) => c.eventId === 'ev-recent').length;
    expect(n).toBe(1);
    const { row } = rowFor(st, '근로기준법', '61/1/1');
    st.links = st.links.filter((l) => !(l.articleId === row.id && l.lawArticleId === art.id));
    st.today = '2026-11-20';
    await run(st);
    expect(st.candidates.filter((c) => c.eventId === 'ev-recent').length).toBe(n);
  });

  it('토큰 갱신이 서버 장애(5xx 화면)로 실패하면 원래 401 대신 서버를 확인하라고 알린다', async () => {
    const r = await run(
      world({
        once: [
          { method: 'GET', path: '/lawgokr/status', status: 401, body: { statusCode: 401, message: 'Unauthorized' } },
          { method: 'POST', path: '/auth/refresh', status: 502, body: null, text: '<html>502 Bad Gateway</html>' },
        ],
      }),
    );
    expect(r.code).toBe(1);
    expect(r.text).toContain('POST /auth/refresh → 502 JSON 이 아닌 서버 오류 응답(502) — VEDA 서버(api)가 떠 있는지 확인하세요');
  });

  it('가지 번호는 1 이상만 받는다 — 0 은 가져오기에서 빠져 인용이 행을 찾지 못한다', () => {
    const doc = (branchNumber: unknown) => ({
      code: 'A', title: 't', effectiveDate: '2025-01-01',
      chapters: [{ number: 1, title: 'c', articles: [{ number: 1, branchNumber, title: 'a', content: '본문', cites: [{ law: '상법', article: '제1조' }] }] }],
    });
    expect(validateDemoPolicies([{ file: 'a', doc: doc(0) }]).join()).toContain('가지 번호가 이상하다: 0');
    expect(validateDemoPolicies([{ file: 'a', doc: doc(1.5) }]).join()).toContain('가지 번호가 이상하다');
    expect(validateDemoPolicies([{ file: 'a', doc: doc(2) }])).toEqual([]);
    expect(validateDemoPolicies([{ file: 'a', doc: doc(undefined) }])).toEqual([]);
  });
});

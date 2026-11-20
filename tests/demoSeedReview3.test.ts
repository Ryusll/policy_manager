import { describe, expect, it } from 'vitest';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { failureText } from '../scripts/demo/seed-demo.mjs';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { generateAction } from '../scripts/demo/lib/rules.mjs';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { buildPlan } from '../scripts/demo/lib/plan.mjs';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { formatPlan } from '../scripts/demo/lib/plan-text.mjs';
import type { FakeState } from './demoSeedFake';
import { run, SANG, world } from './demoSeedWorld';

/**
 * T-216 3차 적대적 검토 반영 — '개정 후보 만들기'를 부를지(다른 날 다시 돌려도 같은 후보를 또 만들지 않음 #1, 다른 규정에도 닿는
 * 변경 #2, 승인으로 기준 판이 바뀐 조문 #3), --reset 실패 지점에 맞는 안내와 실패 글의 id 가림(#4·#7), 후보 없는 법령의 까닭(#5),
 * 끊긴 연결·주소 문제(#8·#9), 표시로 꽉 찬 이력(#10).
 */
const lsaOf = (st: FakeState) => st.laws.find((l) => l.lawName === '근로기준법')!;
const generates = (st: FakeState, from: number) => st.calls.slice(from).filter((c) => c.path === '/amendments/generate');

describe("'개정 후보 만들기'를 부를지 (T-216 3차 #1·#2)", () => {
  it.each([
    [{ others: 0, covered: 0, uncovered: 2, unbased: 0 }, 'generate'],
    [{ others: 1, covered: 0, uncovered: 2, unbased: 0 }, 'others'],
    [{ others: 0, covered: 2, uncovered: 0, unbased: 0 }, 'covered'],
    // 다 덮였으면 다른 규정에도 닿아도 '이미 있음'(4차 #2)
    [{ others: 1, covered: 2, uncovered: 0, unbased: 0 }, 'covered'],
    // 일부만 덮였으면 부르지 않는다 — 부르면 덮인 조문에 다시 생길 수 있다(4차 #1)
    [{ others: 0, covered: 1, uncovered: 1, unbased: 0 }, 'partial'],
    // 다른 규정에도 닿으면 일부만 덮였어도 '다른 규정' — --reset 해도 그 규정의 연결이 남아 다시 막히므로 그 까닭을 알린다(5차 #5)
    [{ others: 1, covered: 1, uncovered: 1, unbased: 0 }, 'others'],
    [{ others: 0, covered: 0, uncovered: 0, unbased: 1 }, 'none'],
  ])('%o → %s', (reach, want) => {
    expect(generateAction(reach)).toBe(want);
  });

  it('다음 날 다시 돌려도 시행일이 지난 변경으로 같은 후보를 또 만들지 않는다', async () => {
    const st = world();
    expect((await run(st)).code).toBe(0);
    const n = st.candidates.length;
    // 시행일이 지난(창 밖) 변경으로 만든 후보 — 서버는 기준일·예정 시행일을 그날로 정한다
    expect(st.candidates.find((c) => c.eventId === 'ev-61-1-1')?.planned).toBe('2026-11-19');
    st.today = '2026-11-20';
    const before = st.calls.length;
    const again = await run(st);
    expect(again.code, again.text).toBe(0);
    expect(st.candidates.length).toBe(n);
    expect(generates(st, before)).toEqual([]);
    expect(again.text).toMatch(/새로 0건, 이미 있음 \d+건/);
  });

  it("닿는 시연 조문 일부에만 후보가 있으면 '개정 후보 만들기'를 부르지 않고 알린다 — 승인으로 판이 늘어난 조문에 같은 변경의 후보가 다시 생기지 않게 (4차 #1)", async () => {
    const st = world();
    await run(st);
    const ev = lsaOf(st).events.find((e) => e.id === 'ev-61-1-1')!;
    const prev = st.candidates.find((c) => c.eventId === ev.id)!;
    prev.reviewState = 'approved';
    const hr01 = st.policies.find((p) => p.code === 'HR-01')!;
    hr01.rows.find((r) => r.id === prev.articleId)!.versions = 2; // 승인으로 판이 하나 늘었다(발행 이력 지문이 바뀐다)
    // 다른 시연 조문도 같은 조항에 확정 연결 — 그 조문에는 이 변경의 후보가 없다
    const other = hr01.rows.find((r) => r.content && r.id !== prev.articleId)!;
    st.links.push({ id: 'link-extra', lawArticleId: ev.lawArticleId!, articleId: other.id, confirmState: 'confirmed' });
    const before = st.calls.length;
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(generates(st, before)).toEqual([]);
    expect(st.candidates.filter((c) => c.eventId === ev.id && c.articleId === prev.articleId)).toHaveLength(1);
    expect(st.candidates.filter((c) => c.eventId === ev.id && c.articleId === other.id)).toHaveLength(0);
    expect(r.text).toContain("일부 시연 조문에만 후보가 있어 '개정 후보 만들기'를 하지 않음(다시 채우려면 --reset): 근로기준법 제61조제1항제1호(후보 없는 시연 조문 1개)");
  });

  it("시연 조문이 다 덮인 변경은 다른 규정에도 닿아도 '이미 있음'으로 센다 — 막혔다고 하지 않는다 (4차 #2)", async () => {
    const st = world();
    await run(st);
    const ev = lsaOf(st).events.find((e) => e.id === 'ev-61-1-1')!;
    st.policies.push({ id: 'pol-other', code: 'OTHER-01', title: '실제 규정', rows: [{ id: 'row-other', number: 1, branchNumber: null, clauseNumber: null, itemNumber: null, content: '본문' }] });
    st.links.push({ id: 'link-other', lawArticleId: ev.lawArticleId!, articleId: 'row-other', confirmState: 'confirmed' });
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(r.text).not.toContain('다른 규정에도 닿아');
    expect(r.text).toMatch(/새로 0건, 이미 있음 (\d+)건/);
    const existing = Number(/이미 있음 (\d+)건, 건너뜀/.exec(r.text)?.[1]);
    expect(existing).toBe(st.candidates.filter((c) => c.policyId !== 'pol-other').length);
  });

  it("이 고객사의 다른 규정에도 확정 연결이 닿는 변경은 '개정 후보 만들기'를 하지 않고 알린다(계획·결과) — 그 규정에 후보가 생기지 않는다", async () => {
    const st = world();
    const ev = lsaOf(st).events.find((e) => e.id === 'ev-61-1-1')!;
    st.policies.push({ id: 'pol-other', code: 'OTHER-01', title: '실제 규정', rows: [{ id: 'row-other', number: 1, branchNumber: null, clauseNumber: null, itemNumber: null, content: '본문' }] });
    st.links.push({ id: 'link-other', lawArticleId: ev.lawArticleId!, articleId: 'row-other', confirmState: 'confirmed' });
    const plan = await run(st, ['--plan']);
    expect(plan.text).toContain('다른 규정에도 닿아 만들지 않음 1건');
    expect(plan.text).toContain("다른 규정에도 확정 연결이 닿는 변경은 '개정 후보 만들기'를 하지 않습니다");
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(r.text).toContain("다른 규정에도 닿아 '개정 후보 만들기'를 하지 않음: 근로기준법 제61조제1항제1호(다른 규정 1개)");
    expect(st.candidates.filter((c) => c.policyId === 'pol-other')).toEqual([]);
    expect(st.candidates.some((c) => c.eventId === ev.id)).toBe(false);
  });
});

describe('계획도 실행과 같은 규칙으로 센다 (T-216 4차 #1)', () => {
  it('한 변경이 시연 조문 둘에 닿고 하나에만 후보가 있으면 나머지는 \'일부 조문에만 후보가 있어 만들지 않음\'으로 센다', () => {
    // 합성 입력 — 같은 조의 조 머리(3//)와 항(3/1/) 인용에 3/1/ 변경이 함께 닿는다(시연 문서는 항이 있는 조에 조 머리 인용을 막지만 계획 규칙을 보려고)
    const rows = [
      { id: 'r-31', number: 3, branchNumber: null, clauseNumber: 1, itemNumber: null },
      { id: 'r-3', number: 3, branchNumber: null, clauseNumber: null, itemNumber: null },
    ];
    const cites = [
      { code: 'P1', law: '시험법', label: '제3조제1항', nodeKey: '3/1/', number: 3, branchNumber: null, clauseNumber: 1 },
      { code: 'P1', law: '시험법', label: '제3조', nodeKey: '3//', number: 3, branchNumber: null, clauseNumber: null },
    ];
    const s = {
      lawgokr: { configured: true },
      slots: { used: 1, max: 50, remaining: 49, plan: 'pro' },
      cites,
      // 서버의 지금 영향 판정(survey) — 두 조문 모두 확정 연결, r-31 에만 후보
      reachByEvent: { e1: { others: 0, covered: 1, uncovered: 1, unbased: 0 } },
      existing: [
        {
          id: 'P1-id', code: 'P1', title: 'P1', ours: true, why: null, revisionDate: '2025-03-01', effectiveDate: '2025-03-01', rows,
          links: [
            { articleId: 'r-31', lawArticleId: 'a-31', confirmState: 'confirmed' },
            { articleId: 'r-3', lawArticleId: 'a-3', confirmState: 'confirmed' },
          ],
          candidates: [{ id: 'c1', reviewState: 'draft', articleId: 'r-31', eventId: 'e1' }],
        },
      ],
      lawState: [
        {
          norm: '시험법', name: '시험법', registered: { id: 'law-1', lawName: '시험법' },
          articles: [{ id: 'a-31', nodeKey: '3/1/', label: '제3조제1항' }, { id: 'a-3', nodeKey: '3//', label: '제3조' }],
          events: [{ id: 'e1', nodeKey: '3/1/', label: '제3조제1항', lawArticleId: 'a-31', lawEffectiveDate: '2026-01-01', promulgatedDate: '2025-12-01', version: '법률 제1호(일부개정)' }],
          eventsCapped: false,
        },
      ],
    };
    const plan = buildPlan([{ code: 'P1' }], s, { today: '2026-11-19', reset: false });
    expect(plan.candidates).toMatchObject({ existing: 1, partial: 1, manual: 0, auto: 0 });
    const text = formatPlan(plan, { tenantName: '시연 회사' });
    expect(text).toContain('일부 조문에만 후보가 있어 만들지 않음 1건');
    expect(text).toContain("일부 시연 조문에만 이 변경의 후보가 있으면 '개정 후보 만들기'를 하지 않습니다");
  });
});

describe('계획의 마지막 경고 (T-216 4차 #3)', () => {
  it('닿는 변경이 다른 규정에도 닿아 막히기만 하면 PM 에게 올리라고 하지 않고 까닭을 보라고 한다', async () => {
    const st = world();
    const lsa = lsaOf(st);
    lsa.events = lsa.events.filter((e) => e.id === 'ev-61-1-1'); // 시행일이 지난(창 밖) 변경 하나만
    st.policies.push({ id: 'pol-other', code: 'OTHER-01', title: '실제 규정', rows: [{ id: 'row-other', number: 1, branchNumber: null, clauseNumber: null, itemNumber: null, content: '본문' }] });
    st.links.push({ id: 'link-other', lawArticleId: lsa.events[0].lawArticleId!, articleId: 'row-other', confirmState: 'confirmed' });
    const plan = await run(st, ['--plan']);
    // 실행 결과와 같은 글(5차 #1) — --reset 으로 채우라고 하지 않는다(다른 규정의 연결은 남는다, 5차 #5)
    expect(plan.text).toContain('! 처리 대기 후보가 생기지 않습니다 — 위 법령 줄의 까닭을 보세요.');
    expect(plan.text).toMatch(/닿는 변경은 있지만 후보가 생기지 않을 법령\([^)]*\): 근로기준법/);
    expect(plan.text).not.toContain('--reset 으로 채우면');
    expect(plan.text).not.toContain('감지한 변경이 없습니다');
  });
});

describe('--reset 실패 안내·실패 글의 id (T-216 3차 #4·#7)', () => {
  it('--reset 이 지우다 실패하면 --reset 으로 다시 실행하라고 알리고, 실패 글의 경로에 규정 id 를 싣지 않는다', async () => {
    const st = world();
    await run(st);
    const ids = st.policies.map((p) => p.id);
    st.once.push({ method: 'DELETE', path: '/policies/', status: 500, body: { message: '시험 실패' } });
    const r = await run(st, ['--reset']);
    expect(r.code).toBe(1);
    expect(r.text).toContain('DELETE /policies/:id → 500');
    for (const id of ids) expect(r.text).not.toContain(id);
    expect(r.text).toContain('--reset 을 붙여 같은 명령을 다시 실행하면');
  });
});

describe('후보가 없는 인용 법령의 까닭 (T-216 3차 #5·4차 #6)', () => {
  it('연결을 사람이 반려해 잇지 못한 인용의 법령은 닿는 변경이 있으면 \'변경 없음\'으로 올리지 않는다', async () => {
    const st = world();
    await run(st);
    const lsa = lsaOf(st);
    const lsaArticles = new Set(lsa.articles.map((a) => a.id));
    for (const l of st.links) if (lsaArticles.has(l.lawArticleId)) l.confirmState = 'rejected';
    st.candidates = [];
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    const result = r.text.split('실행합니다.')[1] ?? '';
    expect(result).toMatch(/닿는 변경은 있지만 후보가 생기지 않은 법령\([^)]*\): 근로기준법/);
    expect(result).not.toMatch(/시연 조문에 닿는 변경이 없는 인용 법령: [^\n]*근로기준법/);
  });

  it('새로 등록한 법령은 동기화 기다림으로, 닿는 변경이 실질 변경 없음뿐인 법령은 따로 — PM 에게 올리는 줄에 섞지 않는다', async () => {
    const st = world();
    for (const e of lsaOf(st).events) e.noChange = true;
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(r.text).toContain(`새로 등록해 아직 변경이 없는 법령(다음 동기화 뒤 다시 실행): ${SANG}`);
    expect(r.text).toMatch(/닿는 변경은 있지만 후보가 생기지 않은 법령\([^)]*\): 근로기준법/);
    expect(r.text).not.toMatch(/시연 조문에 닿는 변경이 없는 인용 법령: [^\n]*(근로기준법|상법)/);
    expect(r.text).toContain('위 법령 줄의 까닭을 보세요');
    expect(r.text).not.toContain('감지한 변경이 없습니다');
  });
});

describe('끊긴 연결·주소 문제·표시로 꽉 찬 이력 (T-216 3차 #8·#9·#10)', () => {
  it('본문을 받다 끊긴 연결(terminated)도 연결 실패다', () => {
    const cut = Object.assign(new TypeError('terminated'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) });
    expect(failureText(cut).kind).toBe('network');
    expect(failureText(cut).text).toContain('UND_ERR_SOCKET');
  });

  it('로그인 응답이 JSON 이 아니면(다른 서비스의 405 화면 등) 상태와 관계없이 주소 문제다 — 넘겨주기도 (4차 #4)', async () => {
    const r = await run(world({ once: [{ method: 'POST', path: '/auth/login', status: 405, body: null, text: '<html>Not Allowed</html>' }] }));
    expect(r.code).toBe(1);
    expect(r.text).toContain('VEDA_DEMO_URL');
    expect(r.text).not.toContain('이어서 채웁니다');
    expect(r.text).not.toContain('비밀번호를 확인하세요');
    const redirect = Object.assign(new TypeError('fetch failed'), { cause: new Error('unexpected redirect') });
    expect(failureText(redirect).kind).toBe('config');
  });

  it('주소가 VEDA API 가 아니면(성공인데 JSON 아님) 이어 채우라고 하지 않고 주소를 고치라고 한다', async () => {
    const r = await run(world({ once: [{ method: 'GET', path: '/lawgokr/status', status: 200, body: null, text: '<html>app</html>' }] }));
    expect(r.code).toBe(1);
    expect(r.text).toContain('VEDA_DEMO_URL');
    expect(r.text).not.toContain('이어서 채웁니다');
  });

  it('가져오기 이력 30건이 모두 이 스크립트의 표시여도(--reset 을 여러 번) 이 스크립트 것으로 보고 다시 채운다', async () => {
    const st = world();
    await run(st);
    for (let i = 0; i < 5; i++) expect((await run(st, ['--reset'])).code).toBe(0);
    expect(st.importLogs.length).toBeGreaterThanOrEqual(30);
    const r = await run(st, ['--plan', '--reset']);
    expect(r.code, r.text).toBe(0);
    expect(r.text).not.toContain('확인할 수 없음');
  });
});

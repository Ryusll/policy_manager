import { describe, expect, it } from 'vitest';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { buildPlan } from '../scripts/demo/lib/plan.mjs';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { emptyText } from '../scripts/demo/lib/rules.mjs';
import type { FakeState } from './demoSeedFake';
import { cites, run, world } from './demoSeedWorld';

/**
 * T-216 6차 적대적 검토 반영 — 계획은 서버처럼 조문마다 한 번 센다(#1), 첫 실행의 '연결하면서 생긴' 후보도 새로 센다(#2), 처리 대기가
 * 없으면 어느 갈래든 끝내 PM 에게 올리는 길을 적는다(#3·#4), 예전 시연 규정이 남으면 알린다(#5), 지운 행은 계획도 잇지 않는다(#6),
 * 로그인 응답의 상태를 주소 문제로 넓게 보지 않는다(#7), 어느 경로든 5xx 장애 화면은 서버를 보라고 한다(#8).
 */
const lsaOf = (st: FakeState) => st.laws.find((l) => l.lawName === '근로기준법')!;
const resultOf = (text: string) => text.split('실행합니다.')[1] ?? '';
const planOf = (text: string) => text.split('실행합니다.')[0];
type RowCite = { code: string; law: string; nodeKey: string; number: number; branchNumber?: number | null; clauseNumber?: number | null };

describe('계획은 서버처럼 조문마다 한 번 센다 (T-216 6차 #1)', () => {
  // 한 조문(P1 제1조)에 같은 법령의 상하위 조항 인용 둘 — 제3조와 제3조제1항이 같은 변경(3/1/)에 닿는다
  const s = (lawEffectiveDate: string) => ({
    lawgokr: { configured: true },
    slots: { used: 0, max: 50, remaining: 50, plan: 'pro' },
    cites: [
      { code: 'P1', law: '시험법', label: '제3조', nodeKey: '3//', number: 1, branchNumber: null, clauseNumber: null },
      { code: 'P1', law: '시험법', label: '제3조제1항', nodeKey: '3/1/', number: 1, branchNumber: null, clauseNumber: null },
    ],
    existing: [],
    orphans: [],
    reachByEvent: { e1: { others: 0, covered: 0, uncovered: 0, unbased: 0 } },
    lawState: [
      {
        norm: '시험법', name: '시험법', registered: { id: 'law-1', lawName: '시험법' },
        articles: [{ id: 'a-3', nodeKey: '3//', label: '제3조' }, { id: 'a-31', nodeKey: '3/1/', label: '제3조제1항' }],
        events: [{ id: 'e1', nodeKey: '3/1/', label: '제3조제1항', lawArticleId: 'a-31', lawEffectiveDate, promulgatedDate: '2024-12-01', version: '법률 제1호(일부개정)' }],
        eventsCapped: false,
      },
    ],
  });
  it.each([
    ['창 밖 — 만들기', '2025-01-01', { manual: 1, auto: 0 }],
    ['창 안 — 연결하면 바로', '2026-11-27', { manual: 0, auto: 1 }],
  ])('%s: 한 조문은 한 건', (_name, date, want) => {
    const plan = buildPlan([{ code: 'P1' }], s(date), { today: '2026-11-19', reset: false });
    expect(plan.candidates).toMatchObject(want);
    expect(plan.eventLines[0]).toMatchObject({ newCandidates: 1 });
  });

  it('이번에 확정할(추천) 연결의 조문에 이 변경의 후보가 이미 있으면 이미 있음 — 새로 세지 않는다', () => {
    const base = s('2026-11-27');
    const rows = [{ id: 'r-1', number: 1, branchNumber: null, clauseNumber: null, itemNumber: null }];
    const kept = {
      id: 'P1-id', code: 'P1', title: 'P1', ours: true, why: null, revisionDate: '2025-03-01', effectiveDate: '2025-03-01', rows,
      links: [{ articleId: 'r-1', lawArticleId: 'a-31', confirmState: 'suggested' }, { articleId: 'r-1', lawArticleId: 'a-3', confirmState: 'suggested' }],
      candidates: [{ id: 'c1', reviewState: 'draft', articleId: 'r-1', eventId: 'e1', lawId: 'law-1', lawName: '시험법' }],
    };
    const plan = buildPlan([{ code: 'P1' }], { ...base, existing: [kept] }, { today: '2026-11-19', reset: false });
    expect(plan.candidates).toMatchObject({ existing: 1, auto: 0, manual: 0 });
  });

  it('대역의 영향 판정도 조문마다 한 줄 — 한 조문에 연결이 둘이어도 이미 있음을 두 번 세지 않는다', async () => {
    const st = world();
    await run(st);
    const lsa = lsaOf(st);
    const ev = lsa.events.find((e) => e.id === 'ev-61-1-1')!;
    const prev = st.candidates.find((c) => c.eventId === ev.id)!;
    lsa.articles.push({ id: 'law-x-61', nodeKey: '61//', label: '제61조' }); // 같은 조문을 상위 조항(제61조)에도 확정 연결
    st.links.push({ id: 'link-upper', lawArticleId: 'law-x-61', articleId: prev.articleId, confirmState: 'confirmed' });
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(resultOf(r.text)).toContain('새로 0건, 이미 있음 3건');
  });
});

describe("첫 실행 — 연결하면서 바로 생긴 후보도 '새로'로 센다 (T-216 6차 #2)", () => {
  it('계획의 연결하면 바로·만들기와 결과의 연결하면서 생김·만들기가 같고, 다시 돌리면 이미 있음, --reset 은 처음과 같다', async () => {
    const st = world();
    const plan = await run(st, ['--plan']);
    expect(plan.text).toContain('개정 후보: 새로 최대 3건(연결하면 바로 2 · 만들기 1)');
    const first = await run(st);
    expect(resultOf(first.text)).toContain('개정 후보: 닿는 변경 3건에서 새로 3건(연결하면서 생김 2 · 만들기 1), 이미 있음 0건');
    const again = await run(st);
    expect(resultOf(again.text)).toContain('개정 후보: 닿는 변경 3건에서 새로 0건, 이미 있음 3건');
    const reset = await run(st, ['--reset']);
    expect(resultOf(reset.text)).toContain('개정 후보: 닿는 변경 3건에서 새로 3건(연결하면서 생김 2 · 만들기 1), 이미 있음 0건');
  });
});

describe('처리 대기가 없으면 어느 갈래든 끝내 PM 에게 올리는 길을 적는다 (T-216 6차 #3·#4)', () => {
  it('까닭이 있으면 풀 수 있는 것은 풀고, 풀 수 없는 까닭이면 위 법령 목록을 까닭과 함께 PM 에게 — 계획·실행 같은 글', async () => {
    const st = world();
    await run(st);
    const ids = new Set(lsaOf(st).articles.map((a) => a.id));
    for (const l of st.links) if (ids.has(l.lawArticleId)) l.confirmState = 'rejected';
    st.candidates = [];
    const tail = '풀 수 없는 까닭(실질 변경 없음·시행 본문 없음·법령에 없는 조항·등록 뒤 못 찾음)이면 위 법령 목록을 까닭과 함께 PM 에게 알리세요.';
    const plan = await run(st, ['--plan']);
    // 예전 시연 규정은 7차 #5, 규정에서 찾지 못한 행(--reset)은 11차 #2
    const fix = '반려된 연결과 예전 시연 규정은 화면에서, 규정에서 찾지 못한 행은 --reset 으로, 다른 규정에도 닿는 변경은 시연 전용 고객사에서 풀립니다.';
    expect(plan.text).toContain(`! 처리 대기 후보가 생기지 않습니다 — 위 법령 줄의 까닭을 보세요. ${fix} ${tail}`);
    const r = await run(st);
    expect(resultOf(r.text)).toContain(`! 처리 대기 후보가 없습니다 — 위 법령 줄의 까닭을 보세요. ${fix} ${tail}`);
  });

  it('새로 등록한 법령만 남았으면(닿는 변경 없는 법령 없음) 시행 전 판이 있을 때만 생긴다고 하고, 그래도 없으면 PM 에게', () => {
    for (const [future, head, who] of [
      [true, '처리 대기 후보가 생기지 않습니다', '새로 등록할 법령은'],
      [false, '처리 대기 후보가 없습니다', '새로 등록한 법령은'],
    ] as const) {
      expect(emptyText('sync', { future, noEvents: false })).toBe(
        `! ${head} — ${who} 공포됐지만 시행 전인 판이 있을 때만 다음 동기화 뒤에 변경이 생깁니다. 그 뒤 다시 실행하고, 그래도 없으면 위 법령 목록을 PM 에게 알리세요.`,
      );
    }
  });
});

describe('남은 예전 시연 규정·지운 행 (T-216 6차 #5·#6)', () => {
  it('예전에 이 스크립트가 넣었지만 지금 시연 문서에 없는 코드의 규정은 지우지 않고 계획에 알린다', async () => {
    const st = world();
    st.policies.push({ id: 'pol-old', code: 'OLD-01', title: '옛 시연 규정', rows: [] });
    st.importLogs.push({ policyId: 'pol-old', sourceName: 'veda-demo-seed:OLD-01' });
    const plan = await run(st, ['--plan', '--reset']);
    expect(plan.text).toContain('예전에 이 스크립트가 넣은 것으로 보이는 규정(지금 시연 문서에 없는 코드): OLD-01 — 지우지 않습니다.');
    expect((await run(st, ['--reset'])).code).toBe(0);
    expect(st.policies.some((p) => p.id === 'pol-old')).toBe(true);
  });

  it('남아 있는 시연 규정에서 인용 행을 찾지 못하면 계획도 잇지 않음으로 센다 — 새로 최대가 실행과 같다', async () => {
    const st = world();
    await run(st);
    // 창 안 변경(근로기준법 제54조제1항)이 닿는 인용의 행을 화면에서 지운 것처럼 — 그 조문의 후보도 함께 지워진다
    const cite = (cites as unknown as RowCite[]).find((c) => c.law === '근로기준법' && c.nodeKey === '54/1/')!;
    const pol = st.policies.find((p) => p.code === cite.code)!;
    const gone = pol.rows.find((x) => x.number === cite.number && (x.branchNumber ?? null) === (cite.branchNumber ?? null) && (x.clauseNumber ?? null) === (cite.clauseNumber ?? null) && x.itemNumber == null)!;
    pol.rows = pol.rows.filter((x) => x.id !== gone.id);
    st.candidates = st.candidates.filter((x) => x.articleId !== gone.id);
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(planOf(r.text)).toMatch(/규정에서 그 행을 찾지 못해 잇지 않음[^\n]*: [^\n]*근로기준법 제54조제1항/);
    expect(planOf(r.text)).toContain('개정 후보: 새로 최대 0건');
    expect(resultOf(r.text)).toMatch(/잇지 않음: [^\n]*근로기준법 제54조제1항 \(규정에서 그 행을 찾지 못함\)/);
    expect(resultOf(r.text)).toContain('새로 0건');
  });
});

describe('로그인 응답의 상태·5xx 장애 화면 (T-216 6차 #7·#8)', () => {
  it('로그인 응답이 앞단의 429 화면이면(다시 보내도 계속) 주소를 고치라고 하지 않는다 — 401 관문 화면은 주소 문제', async () => {
    const once = Array.from({ length: 5 }, () => ({ method: 'POST', path: '/auth/login', status: 429, body: null, text: '<html>Too Many</html>' }));
    const busy = await run(world({ once }));
    expect(busy.code).toBe(1);
    expect(busy.text).toContain('POST /auth/login → 429');
    expect(busy.text).not.toContain('VEDA_DEMO_URL');
    expect(busy.text).not.toContain('비밀번호를 확인하세요');
    const gate = await run(world({ once: [{ method: 'POST', path: '/auth/login', status: 401, body: null, text: '<html>Auth Required</html>' }] }));
    expect(gate.code).toBe(1);
    expect(gate.text).toContain('VEDA_DEMO_URL');
    expect(gate.text).not.toContain('비밀번호를 확인하세요');
  });

  it('로그인 뒤 경로의 5xx 장애 화면도 서버가 떠 있는지 보라고 알린다', async () => {
    const r = await run(world({ once: [{ method: 'GET', path: '/lawgokr/status', status: 502, body: null, text: '<html>502 Bad Gateway</html>' }] }));
    expect(r.code).toBe(1);
    expect(r.text).toContain('GET /lawgokr/status → 502 JSON 이 아닌 서버 오류 응답(502) — VEDA 서버(api)가 떠 있는지 확인하세요');
    expect(r.text).not.toContain('<html>');
  });
});

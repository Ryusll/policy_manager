// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { main } from '../scripts/demo/seed-demo.mjs';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { citesOf, loadDemoPolicies } from '../scripts/demo/lib/demo-policies.mjs';
import { fakeFetch, fakeState, type FakeLaw, type FakeState } from './demoSeedFake';

/**
 * T-216 시연 데이터 채우기 시험의 공용 준비 — 실제 시연 규정이 인용한 조항을 다 가진 가짜 법령들(상법만 등록 전)과
 * 근로기준법 변경(창 안 둘·창 밖 하나·닿지 않는 하나), 그리고 가짜 API 로 main() 을 돌리는 run().
 */
export type Cite = { code: string; law: string; label: string; nodeKey: string };
export const demo = loadDemoPolicies() as { code: string }[];
export const cites: Cite[] = demo.flatMap(citesOf);
export const ENV = { VEDA_DEMO_URL: 'https://veda.example.test', VEDA_DEMO_TENANT: 'demo-co', VEDA_DEMO_EMAIL: 'admin@demo.test', VEDA_DEMO_PASSWORD: 'pw-secret-123' };
export const SANG = '상법';

/** 인용한 조항을 다 가진 법령들(상법만 아직 등록 전 — 법제처에서 찾아 등록) + 근로기준법 변경: 창 안 둘, 창 밖 하나, 닿지 않는 하나 */
export function world(over: Partial<FakeState> = {}): FakeState {
  const byLaw = new Map<string, Cite[]>();
  for (const c of cites) byLaw.set(c.law, [...(byLaw.get(c.law) ?? []), c]);
  const laws: FakeLaw[] = [];
  const registerable: FakeState['registerable'] = {};
  let n = 0;
  for (const [law, cs] of byLaw) {
    const articles = [...new Map(cs.map((c) => [c.nodeKey, { nodeKey: c.nodeKey, label: c.label }])).values()];
    if (law === SANG) registerable['9001'] = { lawName: law, articles };
    else laws.push({ id: `law-${++n}`, lawName: law, articles: articles.map((a, i) => ({ ...a, id: `law-${n}-a${i}` })), events: [] });
  }
  const lsa = laws.find((l) => l.lawName === '근로기준법')!;
  const art = (key: string) => lsa.articles.find((a) => a.nodeKey === key)!.id;
  lsa.articles.push({ id: 'law-x-110', nodeKey: '110//', label: '제110조' });
  lsa.events = [
    { id: 'ev-60-5', nodeKey: '60/5/', label: '제60조제5항', lawEffectiveDate: '2027-06-10', promulgatedDate: '2026-06-09', lawArticleId: art('60/5/') },
    { id: 'ev-54-1', nodeKey: '54/1/', label: '제54조제1항', lawEffectiveDate: '2027-06-10', promulgatedDate: '2026-06-09', lawArticleId: art('54/1/') },
    { id: 'ev-61-1-1', nodeKey: '61/1/1', label: '제61조제1항제1호', lawEffectiveDate: '2026-01-01', promulgatedDate: '2025-12-01', lawArticleId: art('61/1/1') },
    { id: 'ev-110', nodeKey: '110//', label: '제110조', lawEffectiveDate: '2027-06-10', promulgatedDate: '2026-06-09', lawArticleId: 'law-x-110' },
  ];
  return fakeState({ laws, registerable, ...over });
}

export async function run(st: FakeState, argv: string[] = [], env: Record<string, string | undefined> = ENV) {
  const out: string[] = [];
  const sleeps: number[] = [];
  const code = await main(argv, env, { out: (s: string) => out.push(s), err: (s: string) => out.push(s) }, {
    fetchImpl: fakeFetch(st),
    paceMs: 0,
    sleepImpl: (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    today: '2026-11-19',
    prompt: () => Promise.resolve(null),
  });
  return { code, text: out.join('\n'), sleeps };
}
export const writes = (st: FakeState) => st.calls.filter((c) => c.method !== 'GET' && c.path !== '/auth/login');
export const pending = (st: FakeState) => st.candidates.filter((c) => c.reviewState === 'draft' || c.reviewState === 'review').length;

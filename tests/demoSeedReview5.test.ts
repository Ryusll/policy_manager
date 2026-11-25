import { describe, expect, it } from 'vitest';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { emptyReason } from '../scripts/demo/lib/rules.mjs';
import type { FakeState } from './demoSeedFake';
import { run, SANG, world } from './demoSeedWorld';

/**
 * T-216 5차 적대적 검토 반영 — 계획과 실행이 같은 규칙·같은 입력으로 후보 없는 법령과 마지막 안내를 정한다(#1·#3·#6),
 * 로그인 5xx 화면은 주소 문제가 아니다(#2), 다른 규정에도 닿는 변경은 일부만 덮였어도 '다른 규정'으로 알린다(#5),
 * 등록 뒤 목록에서 못 찾은 법령은 따로(#7), 시행 본문 없는 조문은 어느 경우에나 건너뜀으로 센다(#8).
 */
const lsaOf = (st: FakeState) => st.laws.find((l) => l.lawName === '근로기준법')!;
const resultOf = (text: string) => text.split('실행합니다.')[1] ?? '';
const planOf = (text: string) => text.split('실행합니다.')[0];
/** 상법까지 모두 등록된 서버 */
function allRegistered(st: FakeState) {
  for (const [mst, reg] of Object.entries(st.registerable)) {
    st.laws.push({ id: `law-reg-${mst}`, lawName: reg.lawName, articles: reg.articles.map((a, i) => ({ ...a, id: `law-reg-${mst}-a${i}` })), events: [] });
  }
  st.registerable = {};
}
/** 첫 실행 뒤, 창 밖 변경(제61조제1항제1호)의 후보가 있는 시연 조문과 그 변경의 법령 조항 */
async function afterFirstRun() {
  const st = world();
  expect((await run(st)).code).toBe(0);
  const ev = lsaOf(st).events.find((e) => e.id === 'ev-61-1-1')!;
  const prev = st.candidates.find((c) => c.eventId === ev.id)!;
  const hr01 = st.policies.find((p) => p.code === 'HR-01')!;
  return { st, ev, prev, hr01 };
}

describe('처리 대기 후보가 없을 때의 마지막 안내 — 계획과 실행이 같은 규칙 (T-216 5차 #1·#3)', () => {
  const g = (o: Record<string, string[]>) => ({ registeredNow: [], lostAfterRegister: [], reachedNone: [], noEvents: [], notRegistered: [], ...o });
  it.each([
    [{ processed: true, groups: g({ reachedNone: ['가'] }) }, 'processed'],
    [{ processed: false, groups: g({ reachedNone: ['가'], registeredNow: ['나'] }) }, 'reasons'],
    [{ processed: false, groups: g({ lostAfterRegister: ['가'] }) }, 'reasons'],
    // 막힌 변경의 법령은 reachedNone 에 든다(9차 #5 — 막힘을 따로 받지 않는다)
    [{ processed: false, groups: g({ reachedNone: ['가'], noEvents: ['나'] }) }, 'reasons'],
    [{ processed: false, groups: g({ registeredNow: ['가'], noEvents: ['나'] }) }, 'sync'],
    [{ processed: false, groups: g({ noEvents: ['가'], notRegistered: ['나'] }) }, 'pm'],
  ])('%o → %s', (input, want) => {
    expect(emptyReason(input)).toBe(want);
  });

  it('인용 법령이 모두 등록돼 있고 닿는 변경이 하나도 없으면 계획·실행 모두 PM 에게 올리라고 한다', async () => {
    const st = world();
    allRegistered(st);
    for (const law of st.laws) law.events = [];
    const plan = await run(st, ['--plan']);
    expect(plan.code, plan.text).toBe(0);
    expect(plan.text).toContain('! 처리 대기 후보가 생기지 않습니다 — 인용한 법령에 이 서버가 감지한 변경이 없습니다. 위 법령 목록을 PM 에게 알리세요.');
    expect(plan.text).toMatch(/시연 조문에 닿는 변경이 없는 인용 법령: [^\n]*근로기준법/);
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(resultOf(r.text)).toContain('! 처리 대기 후보가 없습니다 — 인용한 법령에 이 서버가 감지한 변경이 없습니다. 위 법령 목록을 PM 에게 알리세요.');
  });

  it('닿는 변경이 없고 새로 등록할 법령이 있으면 — 닿는 변경 없는 법령은 바로 PM 에게, 새 법령은 시행 전 판이 있을 때만 동기화 뒤 다시(6차 #3)', async () => {
    const st = world(); // 상법은 아직 등록 전, 나머지 법령은 등록됐고 닿는 변경이 없다
    for (const law of st.laws) law.events = [];
    const plan = await run(st, ['--plan']);
    expect(plan.text).toContain(
      '! 처리 대기 후보가 생기지 않습니다 — 시연 조문에 닿는 변경이 없는 인용 법령(위 목록)은 PM 에게 알리세요. 새로 등록할 법령은 공포됐지만 시행 전인 판이 있을 때만 다음 동기화 뒤에 변경이 생깁니다 — 그 뒤 다시 실행하세요.',
    );
    expect(plan.text).not.toContain('감지한 변경이 없습니다');
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(resultOf(r.text)).toContain('! 처리 대기 후보가 없습니다 — 시연 조문에 닿는 변경이 없는 인용 법령(위 목록)은 PM 에게 알리세요. 새로 등록한 법령은 공포됐지만');
    expect(r.text).not.toContain('감지한 변경이 없습니다');
  });

  it("후보가 이번에 생기거나 이미 있는 법령은 계획의 '후보가 생기지 않을 법령'에 넣지 않는다(처음·다시 실행)", async () => {
    const st = world();
    const first = await run(st, ['--plan']);
    expect(first.text).toContain('개정 후보: 새로 최대 3건');
    expect(first.text).not.toMatch(/후보가 생기지 않을 법령[^\n]*근로기준법/);
    await run(st);
    const again = await run(st, ['--plan']);
    expect(again.text).toMatch(/이미 있음 3건/);
    expect(again.text).not.toMatch(/후보가 생기지 않을 법령[^\n]*근로기준법/);
    // 처리 대기 3건이 남아 있으므로 마지막 경고(모두 처리·까닭)를 붙이지 않는다
    expect(again.text).toContain('지금 처리 대기(작성·검토 중): 3건');
    expect(again.text).not.toMatch(/처리 대기 후보가 (없습니다|생기지 않습니다)/);
  });

  it('사람이 반려해 잇지 못한 인용의 법령은 계획도 실행처럼 \'닿는 변경은 있지만 후보가 없음\'으로 알리고 PM 에게 올리지 않는다', async () => {
    const st = world();
    await run(st);
    const ids = new Set(lsaOf(st).articles.map((a) => a.id));
    for (const l of st.links) if (ids.has(l.lawArticleId)) l.confirmState = 'rejected';
    st.candidates = [];
    const plan = await run(st, ['--plan']);
    expect(plan.code, plan.text).toBe(0);
    expect(plan.text).toMatch(/사람이 반려한 연결이라 잇지 않음: [^\n]*근로기준법/);
    expect(plan.text).toMatch(/닿는 변경은 있지만 후보가 생기지 않을 법령\([^)]*\): 근로기준법/);
    expect(plan.text).not.toMatch(/시연 조문에 닿는 변경이 없는 인용 법령: [^\n]*근로기준법/);
    expect(plan.text).toContain('! 처리 대기 후보가 생기지 않습니다 — 위 법령 줄의 까닭을 보세요.');
    expect(plan.text).not.toContain('감지한 변경이 없습니다');
    const r = await run(st);
    expect(resultOf(r.text)).toContain('! 처리 대기 후보가 없습니다 — 위 법령 줄의 까닭을 보세요.');
  });
});

describe('계획은 서버의 지금 영향 판정으로 센다 — 화면에서 더 건 연결 (T-216 5차 #6)', () => {
  it('시연 조문에 손으로 연결을 하나 더 걸어 일부 조문에만 후보가 있으면 계획도 \'일부 조문에만\'으로 센다', async () => {
    const { st, ev, prev, hr01 } = await afterFirstRun();
    const other = hr01.rows.find((r) => r.content && r.id !== prev.articleId)!;
    st.links.push({ id: 'link-hand', lawArticleId: ev.lawArticleId!, articleId: other.id, confirmState: 'confirmed' });
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(planOf(r.text)).toContain('일부 조문에만 후보가 있어 만들지 않음 1건');
    expect(resultOf(r.text)).toContain("일부 시연 조문에만 후보가 있어 '개정 후보 만들기'를 하지 않음(다시 채우려면 --reset)");
  });
});

describe('다른 규정에도 닿는 변경은 일부만 덮였어도 다른 규정으로 알린다 (T-216 5차 #5)', () => {
  it("--reset 으로 채우라고 하지 않고, 계획도 '다른 규정에도 닿아'로 센다", async () => {
    const { st, ev, prev, hr01 } = await afterFirstRun();
    const other = hr01.rows.find((r) => r.content && r.id !== prev.articleId)!;
    st.links.push({ id: 'link-hand', lawArticleId: ev.lawArticleId!, articleId: other.id, confirmState: 'confirmed' });
    st.policies.push({ id: 'pol-other', code: 'OTHER-01', title: '실제 규정', rows: [{ id: 'row-other', number: 1, branchNumber: null, clauseNumber: null, itemNumber: null, content: '본문' }] });
    st.links.push({ id: 'link-other', lawArticleId: ev.lawArticleId!, articleId: 'row-other', confirmState: 'confirmed' });
    const before = st.candidates.length;
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(st.candidates.length).toBe(before);
    expect(planOf(r.text)).toContain('다른 규정에도 닿아 만들지 않음 1건');
    expect(planOf(r.text)).toContain('--reset 으로는 풀리지 않습니다');
    expect(planOf(r.text)).not.toContain('일부 조문에만 후보가 있어 만들지 않음');
    const result = resultOf(r.text);
    expect(result).toContain("다른 규정에도 닿아 '개정 후보 만들기'를 하지 않음: 근로기준법 제61조제1항제1호(다른 규정 1개)");
    expect(result).toContain('--reset 으로는 풀리지 않습니다');
    expect(result).not.toContain('일부 시연 조문에만 후보가 있어');
  });
});

describe('로그인 5xx 화면·등록 뒤 못 찾은 법령·시행 본문 없는 조문 (T-216 5차 #2·#7·#8)', () => {
  it('로그인 응답이 앞단의 장애 화면(5xx HTML)이면 주소를 고치라고 하지 않고 서버를 확인한 뒤 다시 실행하게 한다', async () => {
    const r = await run(world({ once: [{ method: 'POST', path: '/auth/login', status: 502, body: null, text: '<html>502 Bad Gateway</html>' }] }));
    expect(r.code).toBe(1);
    expect(r.text).toContain('POST /auth/login → 502');
    expect(r.text).toContain('VEDA 서버(api)가 떠 있는지 확인하세요');
    expect(r.text).not.toContain('VEDA_DEMO_URL');
    expect(r.text).toContain('같은 명령을 다시 실행하면');
    expect(r.text).not.toContain('<html>');
  });

  it("등록했지만 목록에서 이름으로 찾지 못한 법령은 '법제처에서 찾지 못함'과 섞지 않고 따로 알리며, 동기화 뒤 다시 실행하라고 하지 않는다", async () => {
    const ok = await run(world());
    expect(resultOf(ok.text)).toContain('다음 동기화 뒤에 다시 실행하면 그 법령의 시행 전 개정으로도 후보가 생긴다');
    const st = world();
    st.registerable['9001'].storedName = '상법(이름 다름)';
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    const result = resultOf(r.text);
    expect(result).toContain(`등록한 법령: ${SANG}(등록 뒤 목록에서 찾지 못함)`);
    expect(result).toContain(`등록했지만 목록에서 이름으로 찾지 못해 잇지 못한 법령(개발팀에 알리세요): ${SANG}`);
    expect(result).not.toContain('다음 동기화 뒤에 다시 실행하면');
    expect(result).not.toMatch(/등록되지 않은 인용 법령[^\n]*상법/);
    expect(result).not.toMatch(/새로 등록해 아직 변경이 없는 법령[^\n]*상법/);
  });

  it("시행 본문이 없어 후보를 만들 수 없는 시연 조문은 '이미 있음'인 변경에서도 건너뜀으로 센다", async () => {
    const { st, ev, hr01 } = await afterFirstRun();
    hr01.rows.push({ id: 'row-blank', number: 99, branchNumber: null, clauseNumber: null, itemNumber: null, content: '' });
    st.links.push({ id: 'link-blank', lawArticleId: ev.lawArticleId!, articleId: 'row-blank', confirmState: 'confirmed' });
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(resultOf(r.text)).toMatch(/새로 0건, 이미 있음 \d+건, 건너뜀 1건/);
  });
});

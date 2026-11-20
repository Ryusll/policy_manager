import { describe, expect, it } from 'vitest';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { failureText, rerunHint } from '../scripts/demo/seed-demo.mjs';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { ApiError } from '../scripts/demo/lib/api.mjs';
import { ENV, run, SANG, world } from './demoSeedWorld';

/**
 * T-216 2차 적대적 검토 반영 — 실패 글이 원인을 감추지 않기(#2·#12), JSON 이 아닌 성공 응답(#3), 모두 처리한 후보(#4),
 * 로그인 까닭(#8), 가짜 API 를 서버처럼(건너뜀·실질 변경 없음 #9, 변경 100건 한도·검색 쪽 넘김·후보 쪽 넘김 #10).
 */
const networkError = (cause: Error & { code?: string }) => Object.assign(new TypeError('fetch failed'), { cause });

describe('실패 글과 다음 할 일 (T-216 2차 #2·#12)', () => {
  it('서버 거절은 경로·상태, 연결 실패는 까닭 코드만(호스트는 싣지 않는다), 넘겨주기는 따로, 그 밖의 오류는 이름과 글 그대로', () => {
    expect(failureText(new ApiError(500, 'GET', '/laws', { message: '서버 오류' }))).toEqual({ kind: 'api', text: 'GET /laws → 500 서버 오류' });
    const dns = failureText(networkError(Object.assign(new Error('getaddrinfo ENOTFOUND secret-host.example'), { code: 'ENOTFOUND' })));
    expect(dns.kind).toBe('network');
    expect(dns.text).toContain('ENOTFOUND');
    expect(dns.text).not.toContain('secret-host');
    expect(failureText(networkError(new Error('unexpected redirect'))).text).toContain('3xx');
    const shape = failureText(new TypeError('(intermediate value).find is not a function'));
    expect(shape).toEqual({ kind: 'unexpected', text: 'TypeError: (intermediate value).find is not a function' });
    expect(failureText(new Error('bad https://veda.example.test/api/x')).text).toBe('Error: bad <주소>');
  });

  it('다음 할 일 — --plan 은 없음, 예상하지 못한 오류는 알리기, 주소 문제는 고친 뒤, --reset 은 다 지운 뒤면 --reset 없이·아니면 --reset 으로 다시 (3차 #4·#9)', () => {
    expect(rerunHint('api', { plan: true, reset: false })).toBeNull();
    expect(rerunHint('unexpected', { plan: false, reset: false })).toContain('개발팀');
    expect(rerunHint('config', { plan: false, reset: false })).toContain('VEDA_DEMO_URL');
    expect(rerunHint('network', { plan: false, reset: true }, { started: true, toDelete: 6, deleted: 6 })).toMatch(/^--reset 없이 같은 명령을 다시 실행하면/);
    expect(rerunHint('network', { plan: false, reset: true }, { started: true, toDelete: 6, deleted: 3 })).toMatch(/^--reset 을 붙여 같은 명령을 다시 실행하면/);
    expect(rerunHint('api', { plan: false, reset: true }, { started: false, toDelete: 0, deleted: 0 })).toMatch(/^--reset 을 붙여/);
    expect(rerunHint('api', { plan: false, reset: false })).toMatch(/^같은 명령을 다시 실행하면/);
  });

  it('응답 꼴이 다르면(법령 목록이 배열이 아님) 연결 실패로 바꿔 말하지 않고 그대로 알린다', async () => {
    const r = await run(world({ once: [{ method: 'GET', path: '/laws', status: 200, body: { rows: [] } }] }));
    expect(r.code).toBe(1);
    expect(r.text).toContain('실패: TypeError');
    expect(r.text).toContain('개발팀');
    expect(r.text).not.toContain('서버에 닿지 못했습니다');
    expect(r.text).not.toContain('이어서 채웁니다');
  });

  it('--reset 이 넣다가 실패하면 --reset 없이 다시 실행하라고 알린다(그대로 다시 치면 다시 지운다)', async () => {
    const st = world();
    await run(st);
    st.once.push({ method: 'POST', path: '/policies/import', status: 500, body: { message: '시험 실패' } });
    const r = await run(st, ['--reset']);
    expect(r.code).toBe(1);
    expect(r.text).toContain('--reset 없이 같은 명령을 다시 실행하면');
  });
});

describe('JSON 이 아닌 성공 응답·로그인 까닭 (T-216 2차 #3·#8)', () => {
  it('성공 상태인데 JSON 이 아니면(화면 HTML 이 붙은 경로) 성공 값으로 쓰지 않고 멈춘다 — 법제처 미설정으로 잘못 안내하지 않는다', async () => {
    const r = await run(world({ once: [{ method: 'GET', path: '/lawgokr/status', status: 200, body: null, text: '<html>app</html>' }] }), ['--plan']);
    expect(r.code).toBe(1);
    expect(r.text).toContain('JSON 이 아닌 응답 — 주소가 VEDA API(/api)를 가리키는지 확인하세요');
    expect(r.text).not.toContain('법제처 연동이 설정되어 있지 않습니다');
  });

  it('로그인 실패는 서버가 가르는 까닭대로 — 고객사 없음·비밀번호 미설정·형식 오류', async () => {
    const tenant = await run(world(), [], { ...ENV, VEDA_DEMO_TENANT: 'other-co' });
    expect(tenant.code).toBe(3);
    expect(tenant.text).toContain('고객사를 찾지 못했습니다 — VEDA_DEMO_TENANT');
    const notSet = await run(world({ once: [{ method: 'POST', path: '/auth/login', status: 401, body: { code: 'PASSWORD_NOT_SET', message: 'Password not set for this account' } }] }));
    expect(notSet.code).toBe(3);
    expect(notSet.text).toContain('비밀번호 재설정을 요청하세요');
    const invalid = await run(world({ once: [{ method: 'POST', path: '/auth/login', status: 400, body: { message: ['password must be longer than or equal to 6 characters'] } }] }));
    expect(invalid.code).toBe(3);
    expect(invalid.text).toContain('비밀번호(6자 이상)');
  });
});

describe('모두 처리한 후보 (T-216 2차 #4)', () => {
  it('시연에서 후보를 모두 반려한 뒤 다시 돌리면 변경이 없다고 하지 않고 --reset 을 알린다(계획·결과 모두), 검토 요청 줄도 없다', async () => {
    const st = world();
    await run(st);
    expect(st.candidates.length).toBeGreaterThan(0);
    for (const c of st.candidates) c.reviewState = 'rejected';
    const n = st.candidates.length;
    const plan = await run(st, ['--plan']);
    expect(plan.text).toContain(`만든 후보 ${n}건을 모두 처리(승인·반려)했습니다. 다시 채우려면 --reset`);
    expect(plan.text).not.toContain('감지한 변경이 없습니다');
    expect(plan.text).not.toContain('검토 요청: 처리 대기 후보 하나를');
    const again = await run(st);
    expect(again.code).toBe(0);
    expect(again.text).toContain(`만든 후보 ${n}건을 모두 처리(승인·반려)했습니다`);
    expect(again.text).not.toContain('감지한 변경이 없습니다');
    expect(again.text).not.toMatch(/(닿는 변경이 없는 인용 법령|후보가 생기지 않은 법령)[^\n]*근로기준법/);
  });

  it("승인해 기준 판이 바뀌어도 다시 돌리면 '개정 후보 만들기'를 부르지 않는다 — 같은 변경으로 새 후보를 만들지 않고 --reset 을 알린다 (3차 #3)", async () => {
    const st = world();
    await run(st);
    const n = st.candidates.length;
    for (const c of st.candidates) c.reviewState = 'approved';
    for (const p of st.policies) for (const r of p.rows) r.versions = 2; // 승인으로 발행이 하나 늘었다
    const plan = await run(st, ['--plan']);
    expect(plan.text).toMatch(new RegExp(`개정 후보: 새로 최대 0건\\(연결하면 바로 0 · 만들기 0\\), 이미 있음 ${n}건`));
    expect(plan.text).toContain(`만든 후보 ${n}건을 모두 처리(승인·반려)했습니다`);
    const before = st.calls.length;
    const again = await run(st);
    expect(again.code).toBe(0);
    expect(st.candidates.length).toBe(n);
    expect(st.calls.slice(before).some((c) => c.path === '/amendments/generate')).toBe(false);
    expect(again.text).toContain(`만든 후보 ${n}건을 모두 처리(승인·반려)했습니다`);
  });
});

describe('가짜 API 를 서버처럼 (T-216 2차 #9·#10)', () => {
  // 건너뜀은 여기서는 만들기를 부르지 않는 변경(이미 후보 있음)의 시행 본문 없는 행으로 센다 — 만들기 응답의 건너뜀은
  // demoSeedReview8 '시행 본문 없는 시연 행에 닿으면 서버처럼 건너뜀으로 센다'가 본다(10차 #4)
  it('건너뜀(시행 본문 없는 시연 행)·실질 변경 없음을 결과에 센다', async () => {
    const st = world();
    const lsa = st.laws.find((l) => l.lawName === '근로기준법')!;
    lsa.events.find((e) => e.id === 'ev-61-1-1')!.noChange = true;
    // 건너뜀은 서버처럼 시행 본문이 없는 시연 행으로 만든다(9차 #7 — 본문이 있는데 건너뛰는 상태는 서버에 없다): 첫 실행 뒤 그런 행을
    // ev-60-5 의 조항에 확정 연결하면, 이미 후보가 있는 그 변경에서 그 행이 건너뜀으로 세인다
    await run(st);
    const pol = st.policies.find((p) => p.code === 'HR-01')!;
    pol.rows.push({ id: 'row-blank', number: 99, branchNumber: null, clauseNumber: null, itemNumber: null, content: '' });
    st.links.push({ id: 'link-blank', lawArticleId: lsa.events.find((e) => e.id === 'ev-60-5')!.lawArticleId!, articleId: 'row-blank', confirmState: 'confirmed' });
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(r.text).toMatch(/건너뜀 1건\(실질 변경 없는 변경 1건\)/);
  });

  it('변경이 100건을 넘으면 서버가 가장 늦게 감지한 100건만 주고, 계획이 그렇다고 알린다', async () => {
    const st = world();
    const lsa = st.laws.find((l) => l.lawName === '근로기준법')!;
    for (let i = 0; i < 101; i++) lsa.events.push({ id: `ev-noise-${i}`, nodeKey: '900//', label: '제900조', lawEffectiveDate: '2027-01-01', promulgatedDate: '2026-11-01', lawArticleId: null, detectedAt: '2026-11-10T00:00:00Z' });
    const r = await run(st, ['--plan']);
    expect(r.text).toContain('근로기준법: 서버가 가장 늦게 감지한 변경 100건만 주어 그것만 봤습니다');
    expect(st.calls.some((c) => c.path.startsWith('/law-changes') && c.path.includes('limit=100'))).toBe(true);
  });

  it('법제처 검색이 줄 세우지 않은 결과에서 이름이 같은 현행 법령이 둘째 쪽에 있어도 찾는다', async () => {
    const st = world({ searchUnranked: true });
    for (let i = 0; i < 150; i++) st.registerable[String(8000 + i)] = { lawName: `${SANG} 시행령 시험 ${i}`, articles: [] };
    const r = await run(st, ['--plan']);
    expect(r.text).toContain(`새로 등록할 법령: ${SANG}`);
    expect(st.calls.some((c) => c.path.startsWith('/lawgokr/search') && c.path.includes('page=2'))).toBe(true);
  });

  it('후보 목록의 법령 이름이 인용과 달라도(약칭 등) 법령 id 로 가른다 — 후보가 있는 법령을 없다고 올리지 않는다', async () => {
    const st = world();
    const lsa = st.laws.find((l) => l.lawName === '근로기준법')!;
    st.listLawName = { [lsa.id]: '근기법' };
    const r = await run(st);
    expect(r.code, r.text).toBe(0);
    expect(r.text).toContain('근기법');
    expect(r.text).not.toMatch(/(닿는 변경이 없는 인용 법령|후보가 생기지 않은 법령)[^\n]*근로기준법/);
  });

  it('후보가 100건을 넘으면 다음 쪽까지 모두 센다', async () => {
    const st = world();
    await run(st);
    const hr01 = st.policies.find((p) => p.code === 'HR-01')!;
    const before = st.candidates.filter((c) => c.reviewState === 'draft' || c.reviewState === 'review').length;
    for (let i = 0; i < 101; i++) {
      st.candidates.push({ id: `cand-extra-${i}`, articleId: hr01.rows[0].id, eventId: `ev-extra-${i}`, policyId: hr01.id, reviewState: 'draft', revision: 1, lockVersion: 0, createdAt: '2026-01-01T00:00:00Z' });
    }
    const again = await run(st);
    expect(again.code, again.text).toBe(0);
    expect(again.text).toContain(`처리 대기 후보(작성·검토 중): ${before + 101}건`);
    expect(st.calls.some((c) => c.path.startsWith('/amendments?') && c.path.includes('page=2'))).toBe(true);
  });
});

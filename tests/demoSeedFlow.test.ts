import { describe, expect, it } from 'vitest';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { normalizeLawName } from '../scripts/demo/lib/law-match.mjs';
import { cites, demo, ENV, pending, run, SANG, world, writes } from './demoSeedWorld';

/**
 * T-216 영업 시연 데이터 채우기 — 가짜 공개 API 로 흐름을 본다: --plan 은 쓰지 않는다, 멈추는 경우, 두 번 돌려도 중복이 없다,
 * --reset 은 이 스크립트가 넣은 규정만 지우고 다시 채운다, 출력에 비밀값·계정·서버 주소가 없다.
 */
describe('--plan 은 보이기만 한다 (T-216 ②)', () => {
  it('쓰는 호출 없이 넣을 규정·등록할 법령·쓸 변경(창 안/밖)·만들 후보 수를 따로 보인다', async () => {
    const st = world();
    const { code, text } = await run(st, ['--plan']);
    expect(code).toBe(0);
    expect(writes(st)).toEqual([]);
    expect(text).toContain(`새로 넣을 시연 규정: ${demo.map((d) => d.code).join(', ')}`);
    expect(text).toContain(`새로 등록할 법령: ${SANG}`);
    expect(text).toContain('뒤에 변경이 생깁니다 — 그 뒤 다시 실행하세요');
    expect(text).toMatch(/법령 연결: 새로 \d+건, 이미 있음 0건, 법령 등록 뒤 \d+건/);
    expect(text).toMatch(/근로기준법 .*시행 2027-06-10 · 창 안 — 연결하면 바로 후보 · 변경 2건 · 닿는 조문 2개 · 새 후보 최대 2건/);
    expect(text).toMatch(/근로기준법 .*시행 2026-01-01 · 창 밖 — '개정 후보 만들기'로 · 변경 1건 · 닿는 조문 1개/);
    expect(text).toContain('개정 후보: 새로 최대 3건(연결하면 바로 2 · 만들기 1)');
    expect(text).toContain('대상 고객사: 시연 회사');
    expect(text).toContain('검토 요청: 처리 대기 후보 하나를 검토 중으로 보낸다');
  });

  it('닿는 변경이 없으면 검토 요청 줄 대신 PM 에게 알리라는 줄을 보인다', async () => {
    const st = world();
    for (const law of st.laws) law.events = [];
    const { code, text } = await run(st, ['--plan']);
    expect(code).toBe(0);
    expect(text).toContain('처리 대기 후보가 생기지 않습니다');
    expect(text).not.toContain('검토 요청:');
  });
});

describe('멈추는 경우 — 사람이 먼저 할 일·실행을 막는 것 (T-216 ②)', () => {
  it('환경변수가 없거나 https 가 아니면 기본값 없이 멈추고 아무것도 부르지 않는다', async () => {
    for (const env of [{ ...ENV, VEDA_DEMO_URL: undefined }, { ...ENV, VEDA_DEMO_TENANT: '' }, { ...ENV, VEDA_DEMO_URL: 'http://veda.example.test' }]) {
      const st = world();
      const { code } = await run(st, [], env);
      expect(code).toBe(2);
      expect(st.calls).toEqual([]);
    }
    const st = world();
    expect((await run(st, [], { ...ENV, VEDA_DEMO_PASSWORD: '' })).code).toBe(2);
    expect(st.calls).toEqual([]);
    expect((await run(world(), ['--plan'], { ...ENV, VEDA_DEMO_URL: 'http://localhost:3001' })).code).toBe(0);
  });

  it('비밀번호 변경 요구(로그인 응답·첫 호출 403)·편집자 계정이면 안내하고 멈춘다', async () => {
    const must = world({ user: { role: 'admin', tenantName: 'x', mustChangePassword: true } });
    const a = await run(must);
    expect(a.code).toBe(3);
    expect(a.text).toContain('화면에서 한 번 로그인해 임시 비밀번호를 바꾼 뒤');
    expect(must.calls.map((c) => c.path)).toEqual(['/auth/login']);
    const guard = world({ once: [{ method: 'GET', path: '/lawgokr/status', status: 403, body: { statusCode: 403, code: 'PASSWORD_CHANGE_REQUIRED', message: 'x' } }] });
    expect((await run(guard)).code).toBe(3);
    expect(guard.calls.length).toBe(2);
    const editor = world({ user: { role: 'editor', tenantName: 'x', mustChangePassword: false } });
    expect((await run(editor)).code).toBe(3);
    expect(writes(editor)).toEqual([]);
  });

  it('법제처 연동 없음·같은 코드의 다른 규정·규정 자리 부족이면 쓰지 않고 멈춘다', async () => {
    const noLaw = world({ configured: false });
    const a = await run(noLaw);
    expect(a.code).toBe(4);
    expect(a.text).toContain('법제처 연동이 설정되어 있지 않습니다');
    const clash = world({ policies: [{ id: 'theirs', code: 'HR-01', title: '실제 취업규칙', rows: [] }] });
    const b = await run(clash);
    expect(b.code).toBe(4);
    expect(b.text).toContain('같은 코드의 다른 규정: HR-01');
    const small = world({ max: 3 });
    expect((await run(small)).code).toBe(4);
    for (const st of [noLaw, clash, small]) expect(writes(st)).toEqual([]);
  });
});

describe('채우기 — 다시 돌려도 중복 없음, 다시 채우기 (T-216 ②③④)', () => {
  it('첫 실행: 규정·법령 등록·연결·후보(창 안은 연결 때, 창 밖은 만들기)·검토 요청 하나 — 두 번째 실행은 새로 만드는 것이 없다', async () => {
    const st = world();
    const first = await run(st);
    expect(first.code).toBe(0);
    expect(st.policies).toHaveLength(demo.length);
    // 규정의 개정일·시행일도 채운다(머리 카드·대시보드 '최근 개정')
    for (const p of st.policies) expect(p, p.code).toMatchObject({ revisionDate: '2025-03-01', effectiveDate: '2025-03-01' });
    expect(st.laws.some((l) => normalizeLawName(l.lawName) === normalizeLawName(SANG))).toBe(true);
    expect(st.links).toHaveLength(new Set(cites.map((c) => `${c.code}|${c.nodeKey}|${c.law}`)).size);
    expect(st.links.every((l) => l.confirmState === 'confirmed')).toBe(true);
    expect(st.candidates.map((c) => c.eventId).sort()).toEqual(['ev-54-1', 'ev-60-5', 'ev-61-1-1']);
    expect(st.candidates.filter((c) => c.reviewState === 'review')).toHaveLength(1);
    expect(first.text).toContain('처리 대기 후보(작성·검토 중): 3건 — 검토 중 1건 · 근로기준법 3');
    const snapshot = JSON.stringify([st.policies, st.links, st.candidates, st.laws.length]);
    const before = writes(st).length;
    const second = await run(st);
    expect(second.code).toBe(0);
    expect(JSON.stringify([st.policies, st.links, st.candidates, st.laws.length])).toBe(snapshot);
    expect(second.text).toContain('넣은 시연 규정: 0개');
    expect(second.text).toMatch(/법령 연결: 새로 0건, 이미 있음 \d+건/);
    expect(second.text).toMatch(/개정 후보: 닿는 변경 3건에서 새로 0건, 이미 있음 3건/);
    expect(second.text).toContain('검토 요청: 보내지 않음');
    // 두 번째 실행의 쓰기는 연결 시도(409)와 후보 만들기(이미 있음)뿐이다 — 규정·법령은 다시 만들지 않는다
    expect(writes(st).slice(before).every((c) => c.path === '/law-links' || c.path === '/amendments/generate')).toBe(true);
  });

  it('--reset: 후보 하나를 처리한 뒤 다시 채우면 처리 대기 수가 처음과 같고, 이 스크립트가 넣지 않은 규정은 남는다', async () => {
    const st = world();
    await run(st);
    const initial = pending(st);
    st.policies.push({ id: 'other', code: 'OTHER-01', title: '다른 규정', rows: [] });
    st.candidates.find((c) => c.reviewState === 'review')!.reviewState = 'approved';
    expect(pending(st)).toBe(initial - 1);
    const r = await run(st, ['--reset']);
    expect(r.code).toBe(0);
    expect(r.text).toContain(`지운 시연 규정: ${demo.length}개`);
    expect(pending(st)).toBe(initial);
    expect(st.policies.some((p) => p.id === 'other')).toBe(true);
    expect(st.candidates.filter((c) => c.reviewState === 'review')).toHaveLength(1);
    // 표시(sourceName)가 없는 같은 코드 규정은 이 스크립트 것이 아니다 — --reset 도 막는다
    const clash = world({ policies: [{ id: 'theirs', code: 'HR-02', title: 'x', rows: [] }] });
    expect((await run(clash, ['--reset'])).code).toBe(4);
    expect(clash.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('추천(suggested)으로 남은 연결은 확정한다 — 확정이 아니면 후보가 생기지 않는다', async () => {
    const st = world();
    await run(st);
    const link = st.links.find((l) => st.candidates.some((c) => c.articleId === l.articleId && c.eventId === 'ev-60-5'))!;
    link.confirmState = 'suggested';
    st.candidates = st.candidates.filter((c) => c.articleId !== link.articleId);
    const r = await run(st);
    expect(r.code).toBe(0);
    expect(st.calls.some((c) => c.method === 'PATCH' && c.path === `/law-links/${link.id}`)).toBe(true);
    expect(link.confirmState).toBe('confirmed');
    expect(st.candidates.some((c) => c.articleId === link.articleId && c.eventId === 'ev-60-5')).toBe(true);
    expect(r.text).toContain('추천을 확정 1건');
  });
});

describe('비밀값·한도·토큰 (T-216 ②)', () => {
  it('출력에 비밀번호·토큰·계정 이메일·서버 주소가 없다', async () => {
    const st = world();
    const { text } = await run(st);
    for (const secret of ['pw-secret-123', 'tok-access-SECRET', 'tok-refresh-SECRET', 'admin@demo.test', 'veda.example.test']) expect(text, secret).not.toContain(secret);
  });

  it('요청 한도(429)는 Retry-After 만큼 기다렸다 다시, 토큰 만료(401)는 한 번 갱신하고 다시', async () => {
    const st = world({
      once: [
        { method: 'GET', path: '/policies/slots', status: 429, body: { message: 'Too Many Requests' }, headers: { 'retry-after': '2' } },
        { method: 'GET', path: '/laws', status: 401, body: { message: 'Unauthorized' } },
      ],
    });
    const { code, sleeps } = await run(st, ['--plan']);
    expect(code).toBe(0);
    expect(sleeps).toContain(2000);
    expect(st.calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
    expect(st.calls.filter((c) => c.path === '/policies/slots')).toHaveLength(2);
  });
});

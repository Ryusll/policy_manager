import { describe, expect, it } from 'vitest';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { createClient } from '../scripts/demo/lib/api.mjs';
import type { FakeState } from './demoSeedFake';
import { ENV, run, SANG, world, writes } from './demoSeedWorld';

/**
 * T-216 적대적 검토 반영 — 이 스크립트가 넣은 규정 가르기(가져오기 이력 30건 한계·표시만 붙은 규정), 반쯤 끝난 실행 잇기,
 * 로그인 실패 구분, 넘겨주기·주소의 계정·JSON 아닌 오류 본문, 요청 간격, 변경 없는 인용 법령 알리기, 현행 판만 등록.
 */
const unrelatedLogs = (n: number) => Array.from({ length: n }, (_, i) => ({ policyId: `other-${i}`, sourceName: 'manual-import' }));

describe('이 스크립트가 넣은 규정 가르기 (T-216 검토 #1·#9, 2차 #1)', () => {
  it('가져오기 이력이 30건으로 꽉 차 표시가 밀려나면 이 스크립트 것인지 확인할 수 없어 아무것도 쓰지 않고 멈춘다 — 화면에서 지운 뒤 다시 실행하라고 알린다', async () => {
    const st = world();
    await run(st);
    st.importLogs.unshift(...unrelatedLogs(30));
    for (const argv of [['--reset'], []]) {
      const before = st.calls.length;
      const r = await run(st, argv);
      expect(r.code, r.text).toBe(4);
      expect(r.text).toContain('HR-01(가져오기 이력이 30건 넘게 쌓여 이 스크립트가 넣었는지 확인할 수 없음)');
      expect(r.text).toContain('화면에서 지운 뒤 다시 실행합니다');
      expect(writes({ ...st, calls: st.calls.slice(before) })).toEqual([]);
    }
  });

  it('이력이 꽉 찼고 그 규정을 만든 다른 가져오기 이력이 보여도(직접 가져온 같은 내용) 지우지 않는다', async () => {
    const st = world();
    await run(st);
    const hr01 = st.policies.find((p) => p.code === 'HR-01')!;
    // 이 스크립트의 표시를 지우고, 그 규정의 다른 출처 이력과 무관한 이력으로 창을 채운다
    st.importLogs = [{ policyId: hr01.id, sourceName: '취업규칙.hwpx' }, ...unrelatedLogs(29), ...st.importLogs.filter((l) => l.policyId !== hr01.id)];
    const r = await run(st, ['--reset']);
    expect(r.code).toBe(4);
    expect(r.text).toContain('HR-01(가져오기 이력이 30건 넘게 쌓여');
    expect(st.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('표시가 있어도 내용이 다르면(누가 고쳤거나 표시만 붙였으면) 지우지 않고 멈춘다', async () => {
    const st = world();
    await run(st);
    st.policies.find((p) => p.code === 'HR-02')!.description = '실제 회사가 고친 설명';
    const r = await run(st, ['--reset']);
    expect(r.code).toBe(4);
    expect(r.text).toContain('HR-02(내용이 시연 규정과 다름)');
    expect(st.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('부서·분류는 서버처럼 metadata 에서 읽는다 — 다시 돌리면 넣은 규정을 이 스크립트 것으로 보고 이어 간다', async () => {
    const st = world();
    await run(st);
    const again = await run(st);
    expect(again.code, again.text).toBe(0);
    expect(again.text).toContain('넣은 시연 규정: 0개');
  });

  it.each<[string, (p: FakeState['policies'][number]) => void]>([
    ['제목을', (p) => void (p.title = '실제 회사가 고친 제목')],
    ['부서를', (p) => void (p.metadata = { ...p.metadata, department: '총무팀' })],
    ['분류를', (p) => void (p.metadata = { ...p.metadata, category: '경영' })],
  ])('화면에서 %s 고치면 내용이 다르다 — 지우지 않고 멈춘다', async (_what, edit) => {
    const st = world();
    await run(st);
    edit(st.policies.find((p) => p.code === 'HR-01')!);
    const r = await run(st, ['--reset']);
    expect(r.code).toBe(4);
    expect(r.text).toContain('HR-01(내용이 시연 규정과 다름)');
    expect(st.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('이력이 꽉 차지 않았는데 표시가 없으면(직접 넣은 같은 내용) 이 스크립트 것으로 보지 않는다', async () => {
    const st = world();
    await run(st);
    st.importLogs = st.importLogs.filter((l) => !String(l.sourceName).endsWith(':HR-03'));
    const r = await run(st, ['--plan', '--reset']);
    expect(r.code).toBe(4);
    expect(r.text).toContain('HR-03(이 스크립트의 가져오기 표시 없음)');
  });
});

describe('반쯤 끝난 실행 잇기 (T-216 검토 #4)', () => {
  it('넣은 뒤 날짜를 채우다 멈춘 규정은 다음 실행이 비어 있는 칸만 채운다(계획에 보인다), 실패하면 다시 실행하라고 알린다', async () => {
    const st = world();
    await run(st);
    const hr = st.policies.find((p) => p.code === 'HR-01')!;
    hr.revisionDate = undefined;
    hr.effectiveDate = '2025-05-05'; // 화면에서 정한 시행일 — 덮지 않는다
    const plan = await run(st, ['--plan']);
    expect(plan.text).toContain('비어 있는 날짜를 채울 시연 규정: HR-01(개정일)');
    const before = st.calls.length;
    const again = await run(st);
    expect(again.code).toBe(0);
    expect(again.text).toContain('개정일·시행일 1개 채움');
    expect(hr.revisionDate).toBe('2025-03-01');
    expect(hr.effectiveDate).toBe('2025-05-05');
    const put = st.calls.slice(before).find((c) => c.method === 'PUT' && c.path === `/policies/${hr.id}`);
    expect(put?.body).toEqual({ revisionDate: '2025-03-01' });
    const broken = world({ once: [{ method: 'POST', path: '/policies/import', status: 500, body: { message: '시험 실패' } }] });
    const failed = await run(broken);
    expect(failed.code).toBe(1);
    expect(failed.text).toContain('같은 명령을 다시 실행하면 이미 넣은 규정·연결·후보는 건너뛰고 이어서 채웁니다');
  });
});

describe('로그인·주소·오류 글 (T-216 검토 #7·#8)', () => {
  it('로그인이 계정 문제(401)일 때만 계정 확인을 안내하고, 서버 장애(503)는 상태와 함께 실패로 끝낸다', async () => {
    const wrong = await run(world(), [], { ...ENV, VEDA_DEMO_PASSWORD: 'wrong-password' });
    expect(wrong.code).toBe(3);
    expect(wrong.text).toContain('이메일과 비밀번호를 확인하세요');
    const down = await run(world({ once: [{ method: 'POST', path: '/auth/login', status: 503, body: { message: 'Service Unavailable' } }] }));
    expect(down.code).toBe(1);
    expect(down.text).toContain('503');
    expect(down.text).not.toContain('비밀번호를 확인하세요');
  });

  it('넘겨주기를 따라가지 않고(redirect: error), 주소의 계정은 받지 않으며, JSON 이 아닌 오류 본문은 옮겨 적지 않는다', async () => {
    const st = world();
    await run(st, ['--plan']);
    expect(st.calls.length).toBeGreaterThan(5);
    expect(st.calls.every((c) => c.redirect === 'error')).toBe(true);
    const withCreds = world();
    const r = await run(withCreds, [], { ...ENV, VEDA_DEMO_URL: 'https://name:secret@veda.example.test' });
    expect(r.code).toBe(2);
    expect(r.text).not.toContain('secret');
    expect(withCreds.calls).toEqual([]);
    const proxy = world({ once: [{ method: 'GET', path: '/policies/slots', status: 502, body: null, text: '<html>internal-proxy-host.local</html>' }] });
    const failed = await run(proxy, ['--plan']);
    expect(failed.code).toBe(1);
    expect(failed.text).toContain('502');
    expect(failed.text).not.toContain('internal-proxy-host');
  });

  it('요청 사이 기본 간격은 0.6초 이상이다(운영 한도 분당 100 안)', async () => {
    const sleeps: number[] = [];
    const api = createClient({
      base: 'https://veda.example.test/api',
      fetchImpl: () => Promise.resolve(new Response('{}', { status: 200 })),
      sleepImpl: (ms: number) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      now: () => 1_000,
    });
    await api.get('/a');
    await api.get('/b');
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(600);
  });
});

describe('법령 알리기·등록 (T-216 검토 #5·#6)', () => {
  it('시연 조문에 닿는 변경이 없는 인용 법령을 이름으로 알린다(계획·결과 모두)', async () => {
    const st = world();
    const plan = await run(st, ['--plan']);
    expect(plan.text).toMatch(/시연 조문에 닿는 변경이 없는 인용 법령: .*남녀고용평등/);
    expect(plan.text).not.toMatch(/닿는 변경이 없는 인용 법령: [^\n]*근로기준법/);
    const done = await run(st);
    // 실행 출력 앞에는 계획이 찍힌다 — 결과 줄은 '실행합니다.' 뒤에서 본다
    const result = done.text.split('실행합니다.')[1] ?? '';
    expect(result).toMatch(/시연 조문에 닿는 변경이 없는 인용 법령: .*산업안전보건법/);
    expect(result).not.toMatch(/닿는 변경이 없는 인용 법령[^\n]*근로기준법/);
  });

  it('법제처에서 현행 판을 찾지 못하면(연혁 판뿐이면) 등록하지 않고 알린다', async () => {
    const st = world();
    st.registerable['9001'].status = '연혁';
    const r = await run(st, ['--plan']);
    expect(r.text).toContain(`새로 등록할 법령: 없음`);
    expect(r.text).toContain(`법제처에서 찾지 못한 법령: ${SANG}`);
    expect(writes(st)).toEqual([]);
  });
});

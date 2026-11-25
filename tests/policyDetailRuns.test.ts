import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * T-215 12차 검토 — 규정마다 화면을 새로 그리면서(11차, PolicyDetailView key) 진행 표시가 화면 상태에 있어, A 에서 시작한 작업이
 * 끝나기 전에 B 에 들렀다 A 로 돌아오면 새 화면이 진행을 몰라 같은 작업(PDF·상태 전환·양식 저장 등)을 또 시작할 수 있었다.
 * 진행은 화면 밖 저장소(stores/policyRunsStore)에 두고, 로그아웃·다른 사용자 로그인 때 비운다(lib/sessionReset).
 * 서버 렌더에서 zustand 는 처음 값을 그리므로 진행 목록은 저장소에서 읽고, 막음은 훅이 돌려주는 함수로 본다.
 * zustand persist 가 쓰는 localStorage 는 메모리로 흉내 낸다(sessionReset 시험과 같다).
 */
const memStore = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
});
const { isRunning, runKey, useRuns } = await import('../apps/web/src/lib/policyResult');
const { useTemplateSelection } = await import('../apps/web/src/components/policy-detail/useTemplateSelection');
const { usePolicyRunsStore } = await import('../apps/web/src/stores/policyRunsStore');
const { useAuthStore } = await import('../apps/web/src/stores/authStore');
await import('../apps/web/src/lib/queryClient'); // 불러오면 sessionReset 을 건다

/** 훅을 한 번 그려 돌려준 값을 받는다 — 부를 때마다 새 화면(규정을 옮겼다 돌아와 새로 그린 화면)이다 */
function capture<T>(hook: () => T): T {
  let out: T | undefined;
  const C = () => {
    out = hook();
    return null;
  };
  renderToStaticMarkup(createElement(C));
  return out as T;
}
const runningNow = () => usePolicyRunsStore.getState().running;
afterEach(() => usePolicyRunsStore.getState().clear());

describe('진행 표시는 규정 화면을 새로 그려도 이어진다 (T-215 12차)', () => {
  it('앞 화면이 시작한 작업은 새로 그린 화면에서 다시 시작할 수 없고, 앞 화면의 작업이 끝나면 시작할 수 있다', () => {
    const before = capture(useRuns); // A 화면
    expect(before.start('pdf', 'A')).toBe(true);
    const after = capture(useRuns); // B 에 들렀다 A 로 돌아와 새로 그린 화면
    expect(after.start('pdf', 'A')).toBe(false);
    expect(isRunning(runningNow(), 'pdf', 'A')).toBe(true);
    expect(after.start('pdf', 'B')).toBe(true); // 다른 규정은 따로
    expect(after.start('toggle', 'A')).toBe(true); // 같은 규정의 다른 작업도 따로
    before.end('pdf', 'A'); // 내려간 앞 화면의 작업이 끝났다(finally·onSettled)
    expect(isRunning(runningNow(), 'pdf', 'A')).toBe(false);
    expect(after.start('pdf', 'A')).toBe(true);
  });

  it('적용 양식 저장도 — 앞 화면의 저장이 끝나기 전에는 새로 그린 화면에서 다시 저장하지 않는다', async () => {
    let finish: () => void = () => undefined;
    const save = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const opts = { policyId: 'A', serverValue: 't1', canSave: true, save, onError: vi.fn() };
    const first = capture(() => useTemplateSelection(opts)).change('t2');
    expect(save).toHaveBeenCalledTimes(1);
    expect(runningNow()).toEqual([runKey('template', 'A')]);
    await capture(() => useTemplateSelection(opts)).change('t3'); // 새로 그린 화면
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(runningNow()).toEqual([]);
    const third = capture(() => useTemplateSelection(opts)).change('t3');
    expect(save).toHaveBeenCalledTimes(2);
    finish();
    await third;
  });

  it('로그아웃·다른 사용자 로그인 때 진행 표시를 비운다 — 끊긴 요청이 끝을 알리지 못해도 다음 사람의 버튼이 막혀 있지 않게', () => {
    const user = (id: string, tenantId: string) => ({ id, email: `${id}@example.com`, name: id, role: 'admin', tenantId, tenantSlug: tenantId, tenantName: tenantId, plan: 'pro' });
    useAuthStore.getState().setAuth(user('user-a', 'tenant-a'), 'at-a', 'rt-a');
    expect(capture(useRuns).start('pdf', 'A')).toBe(true);
    useAuthStore.getState().setAuth(user('user-a', 'tenant-a'), 'at-a2', 'rt-a2'); // 같은 사람의 토큰 갱신 — 그대로
    expect(runningNow()).toEqual([runKey('pdf', 'A')]);
    useAuthStore.getState().setAuth(user('user-b', 'tenant-b'), 'at-b', 'rt-b');
    expect(runningNow()).toEqual([]);
    expect(capture(useRuns).start('pdf', 'A')).toBe(true);
    useAuthStore.getState().logout();
    expect(runningNow()).toEqual([]);
  });
});

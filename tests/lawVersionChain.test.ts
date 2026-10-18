import { describe, it, expect } from 'vitest';
import { applyChain } from '../apps/api/src/laws/law-version-chain';

/**
 * 판을 차례로 반영하는 반복 (T-151, PAT-07 — 특허 도 7 S770). DB 없이 반영 콜백만 흉내 낸다.
 *
 * 막고 싶은 사고:
 * 1. 판 순서가 뒤바뀌거나 직전 판을 잘못 넘겨 비교·교체가 엉뚱한 판을 기준으로 한다
 * 2. 가운데 판이 실패했는데 건너뛰고 다음 판을 반영해, 실패한 판의 변경이 다음 판 이벤트에 섞인다
 * 3. 다른 경로가 먼저 판을 바꾼 것(경합)을 실패로 세어 매번 오류로 보인다
 * 4. 상한·실행 시간을 넘겨도 계속 반영해 실행이 "중단됨"(30분)에 걸린다
 */
const v = (mst: string, revisionType = '일부개정') => ({ mst, revisionType });

function recorder(failAt?: string, error: Error = new Error('조문이 없습니다')) {
  const calls: [string, string][] = [];
  const apply = (entry: { mst: string }, prev: string) => {
    calls.push([entry.mst, prev]);
    if (entry.mst === failAt) return Promise.reject(error);
    return Promise.resolve(Number(entry.mst) % 10);
  };
  return { calls, apply };
}

describe('applyChain (T-151)', () => {
  it('판 순서대로, 직전 판의 MST 를 넘기며 부른다 — 모두 반영하면 멈춘 까닭이 없다', async () => {
    const { calls, apply } = recorder();
    const r = await applyChain([v('11'), v('12'), v('13')], '10', { apply, cap: 10 });
    expect(calls).toEqual([
      ['11', '10'],
      ['12', '11'],
      ['13', '12'],
    ]);
    expect(r).toEqual({ applied: [{ entry: v('11'), events: 1 }, { entry: v('12'), events: 2 }, { entry: v('13'), events: 3 }], lastMst: '13', remaining: 0 });
  });

  it('2번째 판이 실패하면 1번째만 확정하고 멈춘다 — 실패한 판을 건너뛰지 않는다', async () => {
    const { calls, apply } = recorder('12');
    const r = await applyChain([v('11'), v('12'), v('13')], '10', { apply, cap: 10 });
    expect(calls.map(([m]) => m)).toEqual(['11', '12']); // 13 은 시도하지 않는다
    expect(r.lastMst).toBe('11');
    expect(r.applied.map((a) => a.entry.mst)).toEqual(['11']);
    expect(r.stop).toEqual({ kind: 'failed', mst: '12', message: '조문이 없습니다' });
    expect(r.remaining).toBe(2);
  });

  it('같은 상태로 다시 돌리면 남은 판부터 — 실패 판이 고쳐지면 거기서 잇는다', async () => {
    const first = await applyChain([v('11'), v('12'), v('13')], '10', { apply: recorder('12').apply, cap: 10 });
    const { calls, apply } = recorder();
    const rest = [v('11'), v('12'), v('13')].slice(first.applied.length);
    const r = await applyChain(rest, first.lastMst, { apply, cap: 10 });
    expect(calls).toEqual([
      ['12', '11'],
      ['13', '12'],
    ]);
    expect(r.lastMst).toBe('13');
  });

  it('경합(다른 경로가 먼저 바꿈)은 실패가 아니라 race 로 멈춘다', async () => {
    class Race extends Error {}
    const { apply } = recorder('12', new Race('다른 경로'));
    const r = await applyChain([v('11'), v('12')], '10', { apply, cap: 10, isRace: (e) => e instanceof Race });
    expect(r.stop).toEqual({ kind: 'race', mst: '12', message: '다른 경로' });
    expect(r.applied).toHaveLength(1);
  });

  it('폐지 판에서는 본문을 부르지 않고 멈춘다', async () => {
    const { calls, apply } = recorder();
    const r = await applyChain([v('11'), v('12', '폐지'), v('13')], '10', { apply, cap: 10, isRepeal: (e) => e.revisionType === '폐지' });
    expect(calls.map(([m]) => m)).toEqual(['11']);
    expect(r.stop).toEqual({ kind: 'repeal', mst: '12' });
    expect(r).toMatchObject({ lastMst: '11', remaining: 2 });
  });

  it('상한을 넘는 판은 남겨 두고 남은 수를 돌려준다', async () => {
    const { calls, apply } = recorder();
    const r = await applyChain([v('11'), v('12'), v('13')], '10', { apply, cap: 2 });
    expect(calls).toHaveLength(2);
    expect(r).toMatchObject({ lastMst: '12', stop: { kind: 'cap' }, remaining: 1 });
  });

  it('실행 시간 마감이 지나면 다음 판을 시작하지 않는다(시작한 판은 끝까지)', async () => {
    let t = 0;
    const { calls, apply } = recorder();
    const r = await applyChain([v('11'), v('12'), v('13')], '10', {
      apply: (e, p) => {
        t += 60;
        return apply(e, p);
      },
      cap: 10,
      deadline: 100,
      now: () => t,
    });
    expect(calls.map(([m]) => m)).toEqual(['11', '12']); // 0·60 에 시작, 120 에는 시작하지 않는다
    expect(r).toMatchObject({ lastMst: '12', stop: { kind: 'deadline' }, remaining: 1 });
  });

  it('반영할 판이 없으면 시작 판 그대로', async () => {
    const r = await applyChain([], '10', { apply: recorder().apply, cap: 5 });
    expect(r).toEqual({ applied: [], lastMst: '10', remaining: 0 });
  });
});

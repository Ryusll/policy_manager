/**
 * 판을 차례로 반영하는 반복(T-151, PAT-07) — DB 를 모르는 순수 함수. 판 하나의 반영은 `apply` 콜백이 한다.
 *
 * - 공포 순으로 하나씩, 직전 판의 MST 를 넘기며 부른다
 * - 어느 판에서 실패하면 **그 앞 판까지만 확정한 채 멈춘다**. 실패한 판을 건너뛰지 않는다 — 건너뛰면 그 판의 변경이
 *   다음 판 이벤트에 섞여 PAT-07 이 고치려는 결함("중간 판이 마지막 판의 날짜로 묶인다")이 돌아온다
 * - 다른 경로가 먼저 판을 바꿨으면(경합) 실패로 세지 않고 멈춘다 — 다음 동기화가 새 자리에서 다시 계획한다
 * - 폐지 판에서는 본문을 받지 않고 멈춘다(사람이 추적 해제를 정한다)
 * - 한 번에 반영할 판 수(상한)와 실행 시간(마감)을 넘기면 다음 판을 시작하지 않는다 — 남은 판은 다음 동기화가 잇는다
 */

export type ChainStop =
  | { kind: 'failed'; mst: string; message: string }
  | { kind: 'race'; mst: string; message: string }
  | { kind: 'repeal'; mst: string }
  | { kind: 'cap' }
  | { kind: 'deadline' };

export interface ChainOutcome<V> {
  /** 반영을 마친 판과 그 판의 이벤트 수(공포 순) */
  applied: { entry: V; events: number }[];
  /** 법령 행이 지금 가리키는 판 — 마지막으로 반영한 판, 없으면 시작 판 */
  lastMst: string;
  /** 멈춘 까닭. 모두 반영했으면 없다 */
  stop?: ChainStop;
  /** 반영하지 못하고 남은 판 수(멈춘 판 포함) */
  remaining: number;
}

export interface ChainOptions<V> {
  apply: (entry: V, prevMst: string) => Promise<number>;
  /** 한 번에 반영할 판 수 상한 */
  cap: number;
  /** 이 시각(ms)이 지나면 다음 판을 시작하지 않는다 */
  deadline?: number;
  now?: () => number;
  isRepeal?: (entry: V) => boolean;
  /** 경합(다른 경로가 먼저 바꿈)인지 — 실패로 세지 않는다 */
  isRace?: (error: unknown) => boolean;
}

const messageOf = (e: unknown) => {
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m ? m : String(e);
};

export async function applyChain<V extends { mst: string }>(pending: V[], startMst: string, o: ChainOptions<V>): Promise<ChainOutcome<V>> {
  const now = o.now ?? Date.now;
  const applied: ChainOutcome<V>['applied'] = [];
  let prev = startMst;
  for (let i = 0; i < pending.length; i++) {
    const entry = pending[i];
    const remaining = pending.length - i;
    if (applied.length >= o.cap) return { applied, lastMst: prev, stop: { kind: 'cap' }, remaining };
    if (o.deadline !== undefined && now() >= o.deadline) return { applied, lastMst: prev, stop: { kind: 'deadline' }, remaining };
    if (o.isRepeal?.(entry)) return { applied, lastMst: prev, stop: { kind: 'repeal', mst: entry.mst }, remaining };
    try {
      const events = await o.apply(entry, prev);
      applied.push({ entry, events });
      prev = entry.mst;
    } catch (e) {
      const kind = o.isRace?.(e) ? 'race' : 'failed';
      return { applied, lastMst: prev, stop: { kind, mst: entry.mst, message: messageOf(e) }, remaining };
    }
  }
  return { applied, lastMst: prev, remaining: 0 };
}

/**
 * 법령 주기 동기화(T-104)의 판정 규칙 — DB·법제처 없이 검사할 수 있도록 떼어 냈다.
 *
 * **왜 저장된 MST 로 다시 조회하지 않는가.** 법제처 MST(법령일련번호)는 **판마다 새로
 * 발급**되고, 한 MST 의 본문은 바뀌지 않는다. 등록할 때의 MST 로 아무리 다시 받아도
 * 같은 본문이 와서 개정을 영원히 놓친다. 그래서 바뀌지 않는 **법령ID** 로 지금 판의 MST 를
 * 찾고, 그게 저장된 MST 와 다를 때만 본문을 받아 조항별로 비교한다(T-103 경로 재사용).
 */

export type LawSyncOutcome = 'unchanged' | 'updated' | 'failed';

export interface LawSyncResult {
  lawId: string;
  lawName: string;
  outcome: LawSyncOutcome;
  /** 확인 전 저장돼 있던 MST */
  fromMst: string;
  /** 새 판으로 바꿨으면 그 MST */
  toMst?: string;
  /** 이번에 만들어진 LawChangeEvent 수 */
  events?: number;
  /** 실패 사유 */
  error?: string;
  /** 실패는 아니지만 사람이 알아야 할 것 */
  note?: string;
}

export interface VersionCandidate {
  mst: string;
  lawId: string;
}

const isDigits = (v: string) => /^\d+$/.test(v);

/**
 * 검색 결과에서 이 법령(법령ID)의 가장 최근 판을 고른다.
 * MST 는 판이 날 때마다 순서대로 매겨지므로 숫자가 가장 큰 것이 최신이다.
 * 같은 법령ID 가 둘 이상 보이는 경우는 시행 예정 판이 함께 올라온 경우라, 이 규칙이면
 * **공포됐지만 아직 시행 전인 개정**도 잡는다 — 회사가 시행일 전에 대비할 수 있어야 한다.
 */
export function pickLatestVersion<T extends VersionCandidate>(items: T[], lawId: string): T | null {
  let best: T | null = null;
  for (const item of items) {
    if (item.lawId !== lawId || !isDigits(item.mst)) continue;
    if (!best || BigInt(item.mst) > BigInt(best.mst)) best = item;
  }
  return best;
}

export type VersionDecision =
  /** 현행 목록에 없다 — 폐지됐거나 제명이 바뀌었을 수 있다 */
  | { kind: 'missing' }
  /** 저장된 판이 최신 */
  | { kind: 'same' }
  /** 검색 결과가 저장된 판보다 오래됐다. 되돌리지 않는다 */
  | { kind: 'older'; candidate: string }
  /** 새 판이 있다 */
  | { kind: 'newer'; mst: string };

export function decideVersion(storedMst: string, latest: VersionCandidate | null): VersionDecision {
  if (!latest) return { kind: 'missing' };
  if (latest.mst === storedMst) return { kind: 'same' };
  // 저장된 MST 가 숫자가 아니면 비교 근거가 없다 — 법제처가 주는 쪽을 믿는다
  if (isDigits(storedMst) && BigInt(latest.mst) < BigInt(storedMst)) {
    return { kind: 'older', candidate: latest.mst };
  }
  return { kind: 'newer', mst: latest.mst };
}

export type LawSyncStatusValue = 'succeeded' | 'partial' | 'failed';

export interface LawSyncSummary {
  status: LawSyncStatusValue;
  checkedCount: number;
  changedCount: number;
  eventCount: number;
  failedCount: number;
}

/** 확인할 법령이 0건이면 성공이다 — 실패로 두면 법령을 하나도 안 넣은 서버의 cron 이 매일 경보를 낸다 */
export function summarizeRun(results: LawSyncResult[]): LawSyncSummary {
  const failedCount = results.filter((r) => r.outcome === 'failed').length;
  const changedCount = results.filter((r) => r.outcome === 'updated').length;
  const eventCount = results.reduce((n, r) => n + (r.events ?? 0), 0);
  const checkedCount = results.length;
  const status: LawSyncStatusValue =
    failedCount === 0 ? 'succeeded' : failedCount === checkedCount ? 'failed' : 'partial';
  return { status, checkedCount, changedCount, eventCount, failedCount };
}

/**
 * 법령 주기 동기화(T-104)의 판정 규칙 — DB·법제처 없이 검사할 수 있도록 떼어 냈다.
 *
 * **왜 저장된 MST 로 다시 조회하지 않는가.** 법제처 MST(법령일련번호)는 **판마다 새로
 * 발급**되고, 한 MST 의 본문은 바뀌지 않는다. 등록할 때의 MST 로 아무리 다시 받아도
 * 같은 본문이 와서 개정을 영원히 놓친다. 그래서 바뀌지 않는 **법령ID** 로 지금 판의 MST 를
 * 찾고, 그게 저장된 MST 와 다를 때만 본문을 받아 조항별로 비교한다(T-103 경로 재사용).
 *
 * **T-151(PAT-07)부터** 판을 고르는 일은 판 목록(law-version-plan.ts)이 한다 — 시행일법령 목록을 법령ID 로 받아 저장된 판
 * 뒤에 공포된 판 전부를 공포 순으로 하나씩. 현행 목록(`target=law`)은 **현행만** 줘서(2026-10-14 실호출) 시행 예정 판을
 * 못 잡았고, 그 목록에서 MST 가 가장 큰 판 하나로 건너뛰던 판정(`pickLatestVersion`·`decideVersion`)은 걷어 냈다.
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
  /** 이번에 반영한 판들(공포 순, T-151) — toMst 는 그 마지막, events 는 합계 */
  versions?: SyncedVersion[];
  /** 반영하지 못하고 남은 판 수 — 다음 동기화가 잇는다 */
  remaining?: number;
}

/** 동기화 결과에 싣는 판 하나 */
export interface SyncedVersion {
  mst: string;
  /** '제21533호(2026-04-07 공포)' */
  label: string;
  promulgationDate: string | null;
  revisionType: string | null;
  /** 이 판의 단계 시행일(오름차순) */
  stageEffectiveDates: string[];
  events: number;
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
  // 판을 하나라도 반영한 법령 — 뒤 판에서 실패한 법령도 앞 판까지는 바뀌었다(T-151)
  const changedCount = results.filter((r) => r.toMst && r.toMst !== r.fromMst).length;
  const eventCount = results.reduce((n, r) => n + (r.events ?? 0), 0);
  const checkedCount = results.length;
  const status: LawSyncStatusValue =
    failedCount === 0 ? 'succeeded' : failedCount === checkedCount ? 'failed' : 'partial';
  return { status, checkedCount, changedCount, eventCount, failedCount };
}

import { describe, it, expect } from 'vitest';
import { summarizeRun, type LawSyncResult } from '../apps/api/src/laws/law-sync-logic';

/**
 * 법령 주기 동기화(T-104) 판정.
 * 놓치면 안 되는 것: 저장된 MST 와 다른 **새 판**을 알아보는 것. MST 는 판마다 새로 매겨지고
 * 한 MST 의 본문은 바뀌지 않아서, 이걸 놓치면 개정을 영원히 감지하지 못한다.
 *
 * T-151(PAT-07)부터 반영할 판은 판 목록이 고른다(tests/lawVersionPlan.test.ts) — 저장 판 뒤에 공포된 판 전부를 공포 순으로.
 * 그래서 "가장 큰 MST 하나로 건너뛰기"(decideVersion)와 현행 목록에서 판 고르기(pickLatestVersion)는 걷어 냈고, 그 시험도
 * 함께 지웠다 — 판 목록은 법령ID 로 받는다(LID, tests/lawVersionSync.test.ts).
 */

describe('summarizeRun', () => {
  const r = (outcome: LawSyncResult['outcome'], events = 0, toMst?: string): LawSyncResult => ({
    lawId: 'x', lawName: 'x', outcome, fromMst: '1', events, ...(toMst ? { toMst } : {}),
  });

  it('전부 성공이면 succeeded, 새 판·이벤트 수를 센다', () => {
    expect(summarizeRun([r('unchanged'), r('updated', 3, '2'), r('updated', 2, '3')])).toEqual({
      status: 'succeeded', checkedCount: 3, changedCount: 2, eventCount: 5, failedCount: 0,
    });
  });

  it('뒤 판에서 실패한 법령도 앞 판까지 반영했으면 바뀐 법령으로 센다 — 이벤트도 합친다 (T-151)', () => {
    expect(summarizeRun([r('failed', 4, '2'), r('failed'), r('updated', 0, '5')])).toEqual({
      status: 'partial', checkedCount: 3, changedCount: 2, eventCount: 4, failedCount: 2,
    });
    // 판이 남아(상한) 반영한 판이 없으면 바뀐 법령이 아니다
    expect(summarizeRun([r('unchanged')]).changedCount).toBe(0);
  });

  it('일부 실패면 partial, 전부 실패면 failed', () => {
    expect(summarizeRun([r('unchanged'), r('failed')]).status).toBe('partial');
    expect(summarizeRun([r('failed'), r('failed')]).status).toBe('failed');
  });

  it('확인할 법령이 0건이면 성공 — 법령이 없는 서버의 cron 이 매일 경보를 내면 안 된다', () => {
    expect(summarizeRun([])).toMatchObject({ status: 'succeeded', checkedCount: 0 });
  });
});

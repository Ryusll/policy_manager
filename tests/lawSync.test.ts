import { describe, it, expect } from 'vitest';
import {
  decideVersion,
  pickLatestVersion,
  summarizeRun,
  type LawSyncResult,
} from '../apps/api/src/laws/law-sync-logic';

/**
 * 법령 주기 동기화(T-104) 판정.
 * 놓치면 안 되는 것: 저장된 MST 와 다른 **새 판**을 알아보는 것. MST 는 판마다 새로 매겨지고
 * 한 MST 의 본문은 바뀌지 않아서, 이걸 놓치면 개정을 영원히 감지하지 못한다.
 */

const item = (mst: string, lawId = '001872') => ({ mst, lawId, title: '근로기준법' });

describe('pickLatestVersion', () => {
  it('같은 법령ID 중 MST 가 가장 큰 판을 고른다 — 시행 예정 판도 포함', () => {
    const items = [item('267900'), item('290781'), item('280000')];
    expect(pickLatestVersion(items, '001872')?.mst).toBe('290781');
  });

  it('이름이 비슷한 다른 법령(시행령 등)은 무시한다', () => {
    const items = [item('999999', '009999'), item('267900')];
    expect(pickLatestVersion(items, '001872')?.mst).toBe('267900');
  });

  it('문자열 비교가 아니라 숫자 비교다 — "99999" 가 "100000" 보다 크다고 보면 안 된다', () => {
    expect(pickLatestVersion([item('99999'), item('100000')], '001872')?.mst).toBe('100000');
  });

  it('없으면 null', () => {
    expect(pickLatestVersion([item('1', 'other')], '001872')).toBeNull();
    expect(pickLatestVersion([], '001872')).toBeNull();
  });
});

describe('decideVersion', () => {
  it('현행 목록에 없으면 missing — "개정 없음"으로 처리하면 안 된다', () => {
    expect(decideVersion('267900', null)).toEqual({ kind: 'missing' });
  });

  it('같은 MST 면 same', () => {
    expect(decideVersion('267900', item('267900'))).toEqual({ kind: 'same' });
  });

  it('더 큰 MST 면 newer', () => {
    expect(decideVersion('267900', item('290781'))).toEqual({ kind: 'newer', mst: '290781' });
  });

  it('검색 결과가 저장본보다 오래됐으면 되돌리지 않는다', () => {
    expect(decideVersion('290781', item('267900'))).toEqual({ kind: 'older', candidate: '267900' });
  });

  it('저장된 MST 가 숫자가 아니면 법제처 쪽을 믿는다', () => {
    expect(decideVersion('manual', item('267900'))).toEqual({ kind: 'newer', mst: '267900' });
  });
});

describe('summarizeRun', () => {
  const r = (outcome: LawSyncResult['outcome'], events = 0): LawSyncResult => ({
    lawId: 'x', lawName: 'x', outcome, fromMst: '1', events,
  });

  it('전부 성공이면 succeeded, 새 판·이벤트 수를 센다', () => {
    expect(summarizeRun([r('unchanged'), r('updated', 3), r('updated', 2)])).toEqual({
      status: 'succeeded', checkedCount: 3, changedCount: 2, eventCount: 5, failedCount: 0,
    });
  });

  it('일부 실패면 partial, 전부 실패면 failed', () => {
    expect(summarizeRun([r('unchanged'), r('failed')]).status).toBe('partial');
    expect(summarizeRun([r('failed'), r('failed')]).status).toBe('failed');
  });

  it('확인할 법령이 0건이면 성공 — 법령이 없는 서버의 cron 이 매일 경보를 내면 안 된다', () => {
    expect(summarizeRun([])).toMatchObject({ status: 'succeeded', checkedCount: 0 });
  });
});

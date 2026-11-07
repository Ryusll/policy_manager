import { describe, it, expect, vi } from 'vitest';
import { STALE_AFTER_HOURS, lawSyncStatus, syncStatus } from '../apps/api/src/laws/law-sync-status';

/**
 * 법령 동기화 멈춤 경고(T-153 ④, SRS LAW-17) — 마지막 성공 실행이 36시간을 넘으면 경고한다. 화면이 읽을 때 계산한다.
 *
 * 막고 싶은 사고:
 * 1. 예약 실행이 멈췄는데 아무 화면에도 보이지 않는다
 * 2. 36시간 정각이나 그 전에 경고해 매일 한 번 도는 정상 예약을 멈춤처럼 보인다
 * 3. 새 설치(성공 실행이 아직 없음)에 고객 화면이 '멈춤'을 띄운다
 */
const AT = new Date('2026-11-08T12:00:00Z');
const ago = (minutes: number) => new Date(AT.getTime() - minutes * 60_000);

describe('법령 동기화 멈춤 경고 (T-153 ④)', () => {
  it('36시간 정각까지는 정상, 넘으면 경고 — 기준은 36시간', () => {
    expect(STALE_AFTER_HOURS).toBe(36);
    expect(syncStatus(ago(35 * 60 + 59), AT).stale).toBe(false);
    expect(syncStatus(ago(36 * 60), AT).stale).toBe(false);
    expect(syncStatus(ago(36 * 60 + 1), AT)).toEqual({ lastSuccessAt: ago(36 * 60 + 1).toISOString(), stale: true, everSucceeded: true, staleAfterHours: 36 });
  });

  it('성공 실행이 한 번도 없으면 멈춤이 아니라 "아직 없음" — 고객 화면에 경고를 내지 않게', () => {
    expect(syncStatus(null, AT)).toEqual({ lastSuccessAt: null, stale: false, everSucceeded: false, staleAfterHours: 36 });
  });

  it('마지막 성공 실행 = 실패 없이 또는 일부만 실패하고 끝난 실행(succeeded·partial), 끝난 시각 기준', async () => {
    const findFirst = vi.fn(() => Promise.resolve({ finishedAt: ago(60) }));
    const s = await lawSyncStatus({ lawSyncRun: { findFirst } } as never, AT);
    expect(findFirst).toHaveBeenCalledWith({
      where: { status: { in: ['succeeded', 'partial'] }, finishedAt: { not: null } },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    });
    expect(s).toMatchObject({ stale: false, everSucceeded: true });
    const none = await lawSyncStatus({ lawSyncRun: { findFirst: () => Promise.resolve(null) } } as never, AT);
    expect(none.everSucceeded).toBe(false);
  });
});

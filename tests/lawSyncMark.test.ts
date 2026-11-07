import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { markData, markLaw } from '../apps/api/src/laws/law-sync-mark';
import { walkResult } from '../apps/api/src/laws/law-version-sync';
import type { LawVersionEntry } from '../apps/api/src/laws/law-version-plan';

/**
 * 법령 확인 기록(T-153 ⑤) — 성공·실패를 오류 문구가 아니라 종류로 가르고, 쓰는 칸은 한 곳(law-sync-mark)에서 정한다.
 *
 * 막고 싶은 사고:
 * 1. 오류 문구 없이 끝난 실패가 확인 성공(lastCheckedAt)으로 찍힌다, 실패가 오류 칸을 비워 화면에 실패가 보이지 않는다
 * 2. 확인 기록을 남기지 못한 것을 삼킨다(그새 지워진 법령 말고는)
 * 3. 실행 시간을 다 쓰고도 판을 하나도 반영하지 못한 법령이 '개정 없음'으로 남아 매번 맨 앞에 서고(뒤의 법령이 영영 돌지 못한다),
 *    그 법령만 돈 실행이 성공으로 세어져 멈춤 경고도 뜨지 않는다
 * 4. 늦게 시작해 아무것도 확인하지 못한 법령이 앞선 진짜 오류를 지워 확인 실패 표시가 사라진다
 */
const NOW = new Date('2026-11-08T03:00:00Z');

describe('확인 기록의 칸 (T-153 ⑤)', () => {
  it('종류마다 쓰는 칸 — 확인 시각은 checked 만 찍는다', () => {
    expect(markData('checked', null, NOW)).toEqual({ lastCheckedAt: NOW, lastAttemptedAt: NOW, lastCheckError: null });
    expect(markData('error', '법제처 응답 오류', NOW)).toEqual({ lastAttemptedAt: NOW, lastCheckError: '법제처 응답 오류' });
    expect(markData('clearError', null, NOW)).toEqual({ lastCheckError: null });
    expect(markData('none', null, NOW)).toBeNull();
  });

  it('실패인데 문구가 비어도 실패다 — 확인 시각을 찍지 않고 오류 칸을 채운다. 성공은 문구가 와도 성공(종류로 가른다)', () => {
    for (const error of [null, '']) {
      const d = markData('error', error, NOW);
      expect(d).not.toHaveProperty('lastCheckedAt');
      expect(d).toEqual({ lastAttemptedAt: NOW, lastCheckError: '확인에 실패했습니다 — 다음 동기화에서 다시 시도합니다.' });
    }
    expect(markData('checked', '남은 문구', NOW)).toEqual({ lastCheckedAt: NOW, lastAttemptedAt: NOW, lastCheckError: null });
  });

  it('남기지 못하면 로그와 안내 문구로 알린다 — 그새 지워진 법령(P2025)만 조용히 넘어가고, none 은 쓰지 않는다', async () => {
    const law = { id: 'law-1', lawName: '시험법' };
    const log = { error: vi.fn() };
    const update = vi.fn();
    const prisma = { law: { update } } as never;
    update.mockRejectedValueOnce(new Error('DB 연결 끊김'));
    expect(await markLaw(prisma, log, law, 'checked', null)).toBe('확인 기록을 남기지 못했습니다: DB 연결 끊김');
    expect(log.error).toHaveBeenCalledWith('확인 기록을 남기지 못했습니다 [시험법]: DB 연결 끊김');
    update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('gone', { code: 'P2025', clientVersion: 'test' }));
    expect(await markLaw(prisma, log, law, 'error', '실패')).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
    update.mockClear();
    expect(await markLaw(prisma, log, law, 'none', null)).toBeNull();
    expect(update).not.toHaveBeenCalled();
    update.mockResolvedValueOnce({});
    expect(await markLaw(prisma, log, law, 'error', '법제처 응답 오류')).toBeNull();
    expect(update).toHaveBeenCalledWith({ where: { id: 'law-1' }, data: { lastAttemptedAt: expect.any(Date), lastCheckError: '법제처 응답 오류' } });
  });
});

describe('walkResult — 시간 상한까지 진전이 없을 때 (T-153 ⑤)', () => {
  const base = { lawId: 'law-1', lawName: '시험법', fromMst: '900100' };
  const e = (mst: string): LawVersionEntry => ({ mst, lawId: '990143', title: '시험법', promulgationDate: '2026-02-01', promulgationNo: '200', revisionType: '일부개정', stageEffectiveDates: ['2026-03-01'] });
  const stuck = { applied: [], lastMst: '900100', stop: { kind: 'deadline' as const }, remaining: 3 };

  it('실행 시간을 절반 넘게 남기고 시작했는데도(ampleTime) 한 판도 반영하지 못함 → 실패(시도 시각·오류 — 차례 뒤로), 고객에게 보이는 오류는 내부 사정 없이', () => {
    const r = walkResult(base, stuck, { ampleTime: true });
    expect(r.mark).toBe('error');
    expect(r.result).toMatchObject({ outcome: 'failed', events: 0, remaining: 3 });
    expect(r.result).not.toHaveProperty('toMst');
    expect(r.result.error).toBe('확인 시간 안에 새 판을 하나도 반영하지 못했습니다(남은 판 3개) — 다음 확인 때 다시 시도합니다.');
    expect(r.result.note).toBe('실행 시간을 다 쓰고도 판을 하나도 반영하지 못해 실패로 남기고 차례를 뒤로 돌렸습니다 — 법제처 응답 시간과 DB 상태를 확인하세요.');
  });

  it('늦게 시작해 한 판도 반영하지 못했으면 실패가 아니고 아무것도 쓰지 않는다 — 앞선 오류를 지우지 않고 차례 앞에 남는다', () => {
    expect(walkResult(base, stuck).mark).toBe('none');
    const late = walkResult(base, stuck, { ampleTime: false });
    expect(late.mark).toBe('none');
    expect(late.result).toMatchObject({ outcome: 'unchanged', remaining: 3 });
    expect(late.result.note).toContain('다음 동기화가 이어서 반영합니다(실행 시간 상한)');
  });

  it('판을 반영하고 상한에 걸렸으면 오류만 지운다(법령은 앞으로 갔다), 판 수 상한은 시간과 상관없이 실패가 아니다', () => {
    const progressed = { applied: [{ entry: e('900200'), events: 1 }], lastMst: '900200', stop: { kind: 'deadline' as const }, remaining: 2 };
    expect(walkResult(base, progressed, { ampleTime: true }).mark).toBe('clearError');
    expect(walkResult(base, { ...progressed, stop: { kind: 'cap' as const } }, { ampleTime: true }).mark).toBe('clearError');
    expect(walkResult(base, { ...stuck, stop: { kind: 'cap' as const } }, { ampleTime: true }).mark).toBe('none');
  });
});

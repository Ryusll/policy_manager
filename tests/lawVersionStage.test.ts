import { describe, it, expect } from 'vitest';
import { currentStageDate } from '../apps/web/src/lib/lawVersionLabel';

/**
 * 법령 화면 머리말의 현행 판 시행일 (T-150 검토). 단계 시행 판은 본문 시행일이 뒤 단계(예: 2027-04-28)라, 그대로 찍으면
 * 지금 시행 중인 판에 미래 날짜가 '시행'으로 붙는다 — 오늘까지 시작된 마지막 단계를 보인다.
 */
describe('현행 판의 시행일 표기 (T-150)', () => {
  const staged = { effectiveDate: '2027-04-28', stageEffectiveDates: ['2026-10-27', '2027-01-28', '2027-04-28', '2027-10-28'] };

  it('단계 시행 판은 오늘까지 시작된 마지막 단계일', () => {
    expect(currentStageDate(staged, '2026-11-06')).toBe('2026-10-27');
    expect(currentStageDate(staged, '2027-02-01')).toBe('2027-01-28');
    expect(currentStageDate(staged, '2027-01-28')).toBe('2027-01-28'); // 그날부터 시행
  });

  it('단계 기록이 없거나 아직 시작된 단계가 없으면 본문 시행일', () => {
    expect(currentStageDate({ effectiveDate: '2026-03-01', stageEffectiveDates: [] }, '2026-11-06')).toBe('2026-03-01');
    expect(currentStageDate({ effectiveDate: null, stageEffectiveDates: [] }, '2026-11-06')).toBeNull();
  });

  it('단계가 순서 없이 와도 날짜 순으로 본다', () => {
    expect(currentStageDate({ effectiveDate: '2027-04-28', stageEffectiveDates: ['2027-04-28', '2026-10-27', '2027-01-28'] }, '2027-02-01')).toBe('2027-01-28');
  });
});

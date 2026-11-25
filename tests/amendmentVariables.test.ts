import { describe, it, expect } from 'vitest';
import {
  compareVariableEffects,
  planVariables,
  variableFingerprint,
  type BindingInput,
  type ValueInput,
} from '../apps/api/src/amendments/amendment-variables';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const BASE = '업무는 운영팀이 정하고, 긴급하면 본부장이 정한다.';
const binding = (id: string, variableId: string, text: string, from = 0): BindingInput => {
  const start = BASE.indexOf(text, from);
  return { id, variableId, key: variableId.toUpperCase(), label: variableId, origin: 'manual', start, end: start + text.length, text };
};
const value = (id: string, variableId: string, v: string, from: string | null, to: string | null, confirmed = true): ValueInput => ({
  id,
  variableId,
  value: v,
  validFrom: from ? d(from) : null,
  validTo: to ? d(to) : null,
  periodConfirmed: confirmed,
});

describe('planVariables — 예정 시행일의 값을 연결된 자리에 (T-109 ②, 도 9)', () => {
  const bindings = [binding('b1', 'dept', '운영팀'), binding('b2', 'head', '본부장')];
  const values = [
    value('v1', 'dept', '운영팀', null, '2026-07-01'),
    value('v2', 'dept', '관리팀', '2026-07-01', null),
    value('v3', 'head', '본부장', null, null),
  ];

  it('그 날 값이 다르면 넣고, 같으면 그대로 — 고른 값·유효기간·범위를 남긴다', () => {
    const { entries, proposals } = planVariables(BASE, bindings, values, d('2026-08-01'));
    expect(entries.map((e) => e.status)).toEqual(['applied', 'unchanged']);
    expect(entries[0]).toMatchObject({ valueId: 'v2', value: '관리팀', validFrom: '2026-07-01', validTo: null, scope: 'tenant', base: { text: '운영팀' } });
    expect(proposals).toEqual([{ ref: 0, start: BASE.indexOf('운영팀'), end: BASE.indexOf('운영팀') + 3, replacement: '관리팀' }]);
  });

  it('예정 시행일에 따라 고르는 값이 달라진다 — 종료일 당일은 다음 값', () => {
    expect(planVariables(BASE, bindings, values, d('2026-06-30')).entries[0].status).toBe('unchanged');
    expect(planVariables(BASE, bindings, values, d('2026-07-01')).entries[0].status).toBe('applied');
  });

  it('값이 없거나 겹치거나 미확정이면 보류, 연결된 문구가 기준 본문과 다르면 보류', () => {
    const none = planVariables(BASE, [binding('b1', 'dept', '운영팀')], [value('x', 'dept', 'x', '2030-01-01', null)], d('2026-08-01'));
    expect(none.entries[0]).toMatchObject({ status: 'held', reason: 'none', valueId: null });
    expect(none.proposals).toEqual([]);
    const amb = planVariables(BASE, [binding('b1', 'dept', '운영팀')], [value('a', 'dept', '가', null, null), value('b', 'dept', '나', null, null)], d('2026-08-01'));
    expect(amb.entries[0].reason).toBe('ambiguous');
    const unc = planVariables(BASE, [binding('b1', 'dept', '운영팀')], [value('a', 'dept', '가', null, null, false)], d('2026-08-01'));
    expect(unc.entries[0].reason).toBe('unconfirmed');
    const moved = planVariables(BASE, [{ ...binding('b1', 'dept', '운영팀'), text: '총무팀' }], values, d('2026-08-01'));
    expect(moved.entries[0]).toMatchObject({ status: 'held', reason: 'span_mismatch' });
  });

  it('다른 변수의 값은 쓰지 않는다', () => {
    const r = planVariables(BASE, [binding('b1', 'dept', '운영팀')], [value('h', 'head', '관리팀', null, null)], d('2026-08-01'));
    expect(r.entries[0].reason).toBe('none');
  });

  it('지문 — 고른 값이 달라지면 달라지고, 연결이 없으면 빈 값', () => {
    const a = variableFingerprint(planVariables(BASE, bindings, values, d('2026-06-30')).entries);
    const b = variableFingerprint(planVariables(BASE, bindings, values, d('2026-08-01')).entries);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^vf2:[0-9a-f]{64}$/);
    expect(variableFingerprint([])).toBe('');
    // 둘 다 "넣음"이어도 넣은 값(값 행)이 다르면 다르다
    const other = [value('v1', 'dept', '운영팀', null, '2026-07-01'), value('v9', 'dept', '총무팀', '2026-07-01', null), values[2]];
    expect(variableFingerprint(planVariables(BASE, bindings, other, d('2026-08-01')).entries)).not.toBe(b);
  });

  it('지문 — 같은 값 행의 문구만 고쳐도 달라진다(T-139, 값 행은 제자리에서 고쳐진다), 순서는 상관없다', () => {
    const b = variableFingerprint(planVariables(BASE, bindings, values, d('2026-08-01')).entries);
    const edited = [values[0], { ...values[1], value: '총무팀' }, values[2]];
    expect(variableFingerprint(planVariables(BASE, bindings, edited, d('2026-08-01')).entries)).not.toBe(b);
    // 같은 입력이면 같다 — 연결·값 순서가 달라도
    expect(variableFingerprint(planVariables(BASE, [...bindings].reverse(), [...values].reverse(), d('2026-08-01')).entries)).toBe(b);
  });
});

describe('compareVariableEffects — 승인 때 다시 고른 값과 비교 (T-109 ②)', () => {
  const bindings = [binding('b1', 'dept', '운영팀')];
  const values = [value('v1', 'dept', '운영팀', null, '2026-07-01'), value('v2', 'dept', '관리팀', '2026-07-01', null)];
  const at = (day: string) => planVariables(BASE, bindings, values, d(day)).entries;

  it('같은 날 다시 고르면 같다', () => {
    expect(compareVariableEffects(at('2026-08-01'), at('2026-08-01'))).toEqual([]);
  });

  it('후보는 관리팀을 넣었는데 승인일엔 운영팀 그대로여야 하면 다르다(반대도)', () => {
    expect(compareVariableEffects(at('2026-08-01'), at('2026-06-01'))).toEqual([{ label: 'dept', candidate: '관리팀', expected: '운영팀' }]);
    expect(compareVariableEffects(at('2026-06-01'), at('2026-08-01'))).toEqual([{ label: 'dept', candidate: '운영팀', expected: '관리팀' }]);
  });

  it('변수 기록이 없는 옛 후보(rule/1)는 넣을 값이 생기면 다르고, 없으면 같다', () => {
    expect(compareVariableEffects(undefined, at('2026-08-01'))).toHaveLength(1);
    expect(compareVariableEffects(undefined, at('2026-06-01'))).toEqual([]);
  });

  it('값을 넣었던 연결이 풀렸으면 근거가 없어진 것이다', () => {
    expect(compareVariableEffects(at('2026-08-01'), [])).toEqual([{ label: 'dept', candidate: '관리팀', expected: null, released: true }]);
  });

  it('법령 고침과 겹쳐 원문을 둔 자리는 다시 골라도 겹치니 보지 않는다', () => {
    // 다시 고르면 값을 넣게 되는 날이어도(관리팀) 법령 고침과 겹치니 후보와 같다고 본다
    const stored = at('2026-08-01').map((e) => ({ ...e, status: 'conflict' as const, candidate: null }));
    expect(compareVariableEffects(stored, at('2026-08-01'))).toEqual([]);
  });

  it('같은 값 행이어도 문구를 고쳤으면 다르다(T-139) — 넣었던 문구와 지금 문구를 함께 보인다', () => {
    const edited = planVariables(BASE, bindings, [values[0], { ...values[1], value: '총무팀' }], d('2026-08-01')).entries;
    expect(edited[0].valueId).toBe('v2');
    expect(compareVariableEffects(at('2026-08-01'), edited)).toEqual([{ label: 'dept', candidate: '관리팀', expected: '총무팀' }]);
    // 고친 문구가 원문과 같아지면 "그대로"가 된다 — 넣었던 후보와 다르다
    const back = planVariables(BASE, bindings, [values[0], { ...values[1], value: '운영팀' }], d('2026-08-01')).entries;
    expect(compareVariableEffects(at('2026-08-01'), back)).toEqual([{ label: 'dept', candidate: '관리팀', expected: '운영팀' }]);
  });

  it('값을 고를 수 없게 되면(보류) 후보가 넣은 값과 다르다', () => {
    const held = planVariables(BASE, bindings, [], d('2026-08-01')).entries;
    expect(compareVariableEffects(at('2026-08-01'), held)).toEqual([{ label: 'dept', candidate: '관리팀', expected: null }]);
  });
});

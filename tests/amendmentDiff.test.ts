import { describe, it, expect } from 'vitest';
import { diffCandidate } from '../apps/api/src/amendments/amendment-diff';

describe('diffCandidate — 제1 조문과 후보의 실제 차이 (특허 도 10 단계 1050)', () => {
  it('같으면 변경이 없다', () => {
    const d = diffCandidate('직원에게 15일의 휴가를 준다.', '직원에게 15일의 휴가를 준다.');
    expect(d.changes).toEqual([]);
    expect(d.parts).toEqual([{ op: 'equal', text: '직원에게 15일의 휴가를 준다.' }]);
    expect(d.unexplained).toBe(0);
  });

  it('바뀐 문자 구간과 양쪽 위치를 남긴다', () => {
    const base = '직원에게 15일의 휴가를 준다.';
    const cand = '직원에게 20일의 휴가를 준다.';
    const d = diffCandidate(base, cand);
    expect(d.changes).toHaveLength(1);
    const [c] = d.changes;
    expect(c.kind).toBe('replace');
    expect(c.base).toEqual({ start: 5, end: 7, text: '15' });
    expect(c.candidate).toEqual({ start: 5, end: 7, text: '20' });
    expect(d.parts).toEqual([
      { op: 'equal', text: '직원에게 ' },
      { op: 'delete', text: '15' },
      { op: 'insert', text: '20' },
      { op: 'equal', text: '일의 휴가를 준다.' },
    ]);
  });

  it('조사가 붙은 낱말은 바뀐 글자만 — 숫자는 한가운데서 자르지 않는다', () => {
    const w = diffCandidate('근로자에게 알린다.', '노동자에게 알린다.').changes[0];
    expect([w.base.text, w.candidate.text]).toEqual(['근로자', '노동자']);
    const n = diffCandidate('정원은 150명이다.', '정원은 160명이다.').changes[0];
    expect([n.base.text, n.candidate.text]).toEqual(['150', '160']);
  });

  it('추가·삭제 구간', () => {
    const ins = diffCandidate('주어야 한다.', '주어야 한다. 다만, 예외로 한다.').changes;
    expect(ins).toHaveLength(1);
    expect(ins[0].kind).toBe('insert');
    expect(ins[0].candidate.text).toBe(' 다만, 예외로 한다.');
    expect(ins[0].base.start).toBe(ins[0].base.end);

    const del = diffCandidate('주어야 한다. 다만, 예외로 한다.', '주어야 한다.').changes;
    expect(del[0].kind).toBe('delete');
    expect(del[0].base.text).toBe(' 다만, 예외로 한다.');
  });

  it('규칙이 고친 자리와 겹치는 변경만 근거가 있다 — 나머지는 근거 없는 변경으로 센다', () => {
    const base = '직원에게 15일의 휴가를 준다. 담당은 운영팀이다.';
    const cand = '직원에게 20일의 휴가를 준다. 담당은 관리팀이다.';
    // 규칙은 "15일"→"20일"만 고쳤다(5~8). "운영팀"→"관리팀"은 근거가 없다
    const d = diffCandidate(base, cand, [{ id: 0, base: { start: 5, end: 8 }, candidate: { start: 5, end: 8 } }]);
    expect(d.changes.map((c) => c.rationaleRefs)).toEqual([[0], []]);
    expect(d.unexplained).toBe(1);
  });

  it('삽입은 규칙이 기록한 삽입 지점에 닿으면 근거가 있다', () => {
    const base = '주어야 한다.';
    const cand = '주어야 한다. 다만, 예외로 한다.';
    const d = diffCandidate(base, cand, [{ id: 3, base: { start: 7, end: 7 }, candidate: { start: 7, end: 19 } }]);
    expect(d.changes[0].rationaleRefs).toEqual([3]);
    expect(d.unexplained).toBe(0);
  });
});

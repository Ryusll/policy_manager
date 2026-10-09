import { describe, it, expect } from 'vitest';
import {
  contextOf,
  coversDate,
  findMarkers,
  occurrenceOf,
  overlappingValueIds,
  reanchor,
  replaceSpans,
  selectValue,
  type ValueRow,
} from '../apps/api/src/variables/variable-binding';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const v = (id: string, value: string, from: string | null, to: string | null, confirmed = true): ValueRow => ({
  id,
  value,
  validFrom: from ? d(from) : null,
  validTo: to ? d(to) : null,
  periodConfirmed: confirmed,
});

describe('변수 값 고르기 — 유효기간 [시작, 종료) (T-109, 도 9)', () => {
  const values = [v('a', '운영팀', '2025-01-01', '2026-07-01'), v('b', '관리팀', '2026-07-01', null)];

  it('시작일은 포함, 종료일은 빠진다 — 종료일이 다음 값 시작일이면 그날은 다음 값', () => {
    expect(selectValue(values, d('2026-06-30'))).toMatchObject({ ok: true, value: { id: 'a' } });
    expect(selectValue(values, d('2026-07-01'))).toMatchObject({ ok: true, value: { id: 'b' } });
    expect(selectValue(values, d('2025-01-01'))).toMatchObject({ ok: true, value: { id: 'a' } });
  });

  it('맞는 값이 없으면 none — 시작 전 날짜', () => {
    expect(selectValue(values, d('2024-12-31'))).toEqual({ ok: false, reason: 'none' });
  });

  it('시작 없음은 처음부터, 종료 없음은 끝 없음', () => {
    expect(coversDate(v('x', 'x', null, null), d('1900-01-01'))).toBe(true);
    expect(selectValue([v('x', '총무팀', null, '2020-01-01')], d('2019-12-31'))).toMatchObject({ ok: true });
  });

  it('기간이 겹치면 고르지 않는다(늦게 시작한 값이 이기지 않는다)', () => {
    const overlap = [v('a', '운영팀', '2025-01-01', null), v('b', '관리팀', '2026-01-01', null)];
    expect(selectValue(overlap, d('2026-03-01'))).toEqual({ ok: false, reason: 'ambiguous' });
    expect(selectValue(overlap, d('2025-03-01'))).toMatchObject({ ok: true, value: { id: 'a' } });
  });

  it('기간 미확정 값(옛 기본값)은 고르지 않고 까닭을 알린다', () => {
    expect(selectValue([v('m', '운영팀', null, null, false)], d('2026-01-01'))).toEqual({ ok: false, reason: 'unconfirmed' });
    // 확인한 값이 하나 있으면 그것을 고른다
    expect(selectValue([v('m', '운영팀', null, null, false), v('c', '관리팀', null, null)], d('2026-01-01'))).toMatchObject({
      ok: true,
      value: { id: 'c' },
    });
  });

  it('겹치는 값 찾기 — 맞닿기만 한 기간은 겹침이 아니다, 미확정 값은 빼고 본다', () => {
    expect(overlappingValueIds(values)).toEqual(new Set());
    expect(
      overlappingValueIds([v('a', 'x', null, '2026-01-01'), v('b', 'y', '2025-06-01', null), v('c', 'z', null, null, false)]),
    ).toEqual(new Set(['a', 'b']));
  });
});

describe('표식·구간 바꾸기', () => {
  it('등록된 키의 표식만, 앞에서부터', () => {
    const t = '{{DEPT}}이 {{NOPE}}와 {{DEPT}}의 장을 정한다';
    const second = t.lastIndexOf('{{DEPT}}');
    expect(findMarkers(t, new Set(['DEPT']))).toEqual([
      { key: 'DEPT', start: 0, end: 8 },
      { key: 'DEPT', start: second, end: second + 8 },
    ]);
  });

  it('뒤에서 앞으로 바꾸고, 바꾼 뒤 위치를 돌려준다', () => {
    const t = '{{A}}와 {{BB}}와 {{A}}';
    const marks = findMarkers(t, new Set(['A', 'BB']));
    const r = replaceSpans(t, marks.map((m) => ({ start: m.start, end: m.end, text: m.key === 'A' ? '운영팀' : '본부장' })));
    expect(r.content).toBe('운영팀와 본부장와 운영팀');
    expect(r.spans.map((s) => r.content.slice(s.start, s.end))).toEqual(['운영팀', '본부장', '운영팀']);
  });

  it('입력 순서와 상관없이 위치가 맞다', () => {
    const r = replaceSpans('0123456789', [
      { start: 7, end: 9, text: 'XYZ' },
      { start: 1, end: 2, text: '' },
    ]);
    expect(r.content).toBe('023456XYZ9');
    expect(r.spans).toEqual([{ start: 6, end: 9 }, { start: 1, end: 1 }]);
  });

  it('겹치는 구간은 거부', () => {
    expect(() => replaceSpans('abcdef', [{ start: 1, end: 4, text: 'x' }, { start: 3, end: 5, text: 'y' }])).toThrow();
  });

  it('출현 순번·문맥 — UTF-16 위치(이모지는 두 칸)', () => {
    const t = '😀 운영팀은 운영팀의 장';
    const second = t.indexOf('운영팀', 4);
    expect(occurrenceOf(t, '운영팀', second)).toBe(1);
    expect(occurrenceOf(t, '운영팀', t.indexOf('운영팀'))).toBe(0);
    expect(t.slice(second, second + 3)).toBe('운영팀');
    expect(contextOf(t, second, second + 3)).toEqual({ contextBefore: t.slice(0, second), contextAfter: '의 장' });
  });
});

describe('위치 옮기기 (reanchor) — 차이와 문맥으로 유일한 자리만', () => {
  const span = (content: string, text: string, from = 0) => {
    const start = content.indexOf(text, from);
    return { start, end: start + text.length, text, ...contextOf(content, start, start + text.length) };
  };

  it('앞쪽 글이 늘어나면 그만큼 밀린 자리로', () => {
    const old = '제1항 운영팀이 맡는다.';
    const neu = '제1항 이 규정의 업무는 운영팀이 맡는다.';
    expect(reanchor(old, neu, span(old, '운영팀'))).toEqual({ ok: true, start: neu.indexOf('운영팀'), end: neu.indexOf('운영팀') + 3 });
  });

  it('같은 문구가 두 번 나와도 두 번째 자리는 두 번째로', () => {
    const old = '운영팀이 정하고 운영팀이 맡는다.';
    const neu = '먼저 운영팀이 정하고, 그다음 운영팀이 맡는다.';
    const s = span(old, '운영팀', 1);
    const r = reanchor(old, neu, s);
    expect(r).toEqual({ ok: true, start: neu.lastIndexOf('운영팀'), end: neu.lastIndexOf('운영팀') + 3 });
  });

  it('구간 문구가 바뀌면 확정하지 않는다', () => {
    const old = '제1항 운영팀이 맡는다.';
    expect(reanchor(old, '제1항 관리팀이 맡는다.', span(old, '운영팀'))).toEqual({ ok: false, reason: 'span_changed' });
    expect(reanchor(old, '제1항 운영지원팀이 맡는다.', span(old, '운영팀'))).toEqual({ ok: false, reason: 'span_changed' });
    expect(reanchor(old, '제1항 이 조는 삭제한다.', span(old, '운영팀'))).toEqual({ ok: false, reason: 'span_changed' });
  });

  it('본문이 같으면 그 자리 그대로', () => {
    const old = '운영팀';
    expect(reanchor(old, old, span(old, '운영팀'))).toEqual({ ok: true, start: 0, end: 3 });
  });

  it('구간 바로 앞뒤에 글자가 붙어도 구간은 그대로', () => {
    const old = '운영팀이 맡는다.';
    const neu = '본사 운영팀이 맡는다.';
    expect(reanchor(old, neu, span(old, '운영팀'))).toEqual({ ok: true, start: 3, end: 6 });
  });

  it('이모지(서로게이트 쌍)가 앞에 있어도 UTF-16 위치로 맞게 옮긴다', () => {
    const old = '😀 운영팀이 맡는다.';
    const neu = '😀😀 운영팀이 맡는다.';
    expect(reanchor(old, neu, span(old, '운영팀'))).toEqual({ ok: true, start: neu.indexOf('운영팀'), end: neu.indexOf('운영팀') + 3 });
  });
});

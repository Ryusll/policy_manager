import { describe, it, expect } from 'vitest';
import { eventEffectiveInfo, isArticleLevelNodeKey, presentEventEffective } from '../apps/api/src/laws/law-effective-info';
import { EFFECTIVE_NOTES_VERSION, type EffectiveNote } from '../apps/api/src/common/effective-notes';

/** 변경 이벤트에 남기는 조별 시행일 표기 스냅샷 (T-144) */
const note = (date: string, scopeText = '제5조제1항'): EffectiveNote => ({ date, scope: 'partial', scopeText, source: '조문참고자료', raw: `[시행일: ${date}]` });

describe('eventEffectiveInfo', () => {
  it('양쪽 다 보여 줄 표기가 없으면 null — 칸을 채우지 않는다', () => {
    expect(eventEffectiveInfo({ nodeKey: '5//', mst: '1', before: null, after: null, beforeRules: 1 })).toBeNull();
    expect(eventEffectiveInfo({ nodeKey: '5//', mst: '1', before: [], after: [], beforeRules: 1 })).toBeNull();
    expect(eventEffectiveInfo({ nodeKey: '5//', mst: '1', before: null, after: [], beforeRules: 1 })).toBeNull();
  });

  it('앞뒤와 판(MST)·읽기 규칙의 판을 남긴다 — 그때 수집하지 않은 앞(null)은 null 로', () => {
    const after = [note('2027-01-01')];
    expect(eventEffectiveInfo({ nodeKey: '5//', mst: '286989', before: null, after, beforeRules: null })).toEqual({
      mst: '286989',
      inherited: false,
      before: null,
      after,
      rules: EFFECTIVE_NOTES_VERSION,
      beforeRules: null,
    });
  });

  it('표기가 사라진 판도 앞 표기를 남긴다(뒤는 []) — 삭제된 조항은 뒤가 null', () => {
    const before = [note('2027-01-01')];
    expect(eventEffectiveInfo({ nodeKey: '5//', mst: '2', before, after: [], beforeRules: 1 })?.before).toEqual(before);
    expect(eventEffectiveInfo({ nodeKey: '5//', mst: '2', before, after: null, beforeRules: 1 })).toMatchObject({ before, after: null });
  });

  it('항·호 행의 이벤트는 상위 조의 표기(inherited) — 그 항·호의 확정 시행일이 아니다', () => {
    const after = [note('2027-01-01')];
    expect(eventEffectiveInfo({ nodeKey: '5/1/', mst: '1', before: null, after, beforeRules: 1 })?.inherited).toBe(true);
    expect(eventEffectiveInfo({ nodeKey: '5의2/1/2', mst: '1', before: null, after, beforeRules: 1 })?.inherited).toBe(true);
    expect(eventEffectiveInfo({ nodeKey: '5의2//', mst: '1', before: null, after, beforeRules: 1 })?.inherited).toBe(false);
    expect(isArticleLevelNodeKey('3//')).toBe(true);
    expect(isArticleLevelNodeKey('3/2/')).toBe(false);
  });
});

describe('presentEventEffective — API 모양', () => {
  it('변경 후 표기를 보이고, 사라진 조항이면 변경 전 표기를 보인다', () => {
    const a = note('2027-01-01');
    const b = note('2028-01-01');
    expect(presentEventEffective({ mst: '1', inherited: false, before: [a], after: [a] })).toEqual({ notes: [a], inherited: false });
    // 사라진 조항이면 그 사실도(지금 있는 표기가 아니다 — 검토 M5)
    expect(presentEventEffective({ mst: '1', inherited: true, before: [b], after: null })).toEqual({ notes: [b], inherited: true, articleGone: true });
    // 그때 수집하지 않았으면(before null) 바뀌었는지 알 수 없다 — 변경 전 표기를 붙이지 않는다
    expect(presentEventEffective({ mst: '1', inherited: false, before: null, after: [a] })).toEqual({ notes: [a], inherited: false });
  });

  it('이번 개정으로 표기가 바뀌면(2028 → 2027) 변경 전 표기도 함께 — 바뀌었다는 사실이 보인다 (T-144)', () => {
    const a = note('2027-01-01');
    const b = note('2028-01-01');
    expect(presentEventEffective({ rules: 1, beforeRules: 1, mst: '1', inherited: false, before: [b], after: [a] })).toEqual({ notes: [a], inherited: false, previous: [b] });
    // 범위만 달라져도 바뀐 것이다
    const narrowed = { ...a, scopeText: '제5조제2항' };
    expect(presentEventEffective({ rules: 1, beforeRules: 1, mst: '1', inherited: false, before: [a], after: [narrowed] })?.previous).toEqual([a]);
  });

  it('예고됐던 별도 시행일이 이번 개정에서 없어지면(after []) null 이 아니라 변경 전 표기를 보인다 (T-144)', () => {
    const b = note('2028-01-01');
    expect(presentEventEffective({ rules: 1, beforeRules: 1, mst: '1', inherited: true, before: [b], after: [] })).toEqual({ notes: [], inherited: true, previous: [b] });
  });

  it('앞뒤를 다른 읽기 규칙으로 읽었으면 견주지 않는다 — 규칙이 바뀐 것을 "이번 개정으로 없어졌다"고 말하지 않는다 (T-144)', () => {
    const b = note('2028-01-01');
    const a = note('2027-01-01');
    expect(presentEventEffective({ rules: 2, beforeRules: 1, mst: '1', inherited: false, before: [b], after: [] })).toBeNull();
    expect(presentEventEffective({ rules: 2, beforeRules: 1, mst: '1', inherited: false, before: [b], after: [a] })).toEqual({ notes: [a], inherited: false });
    // 판을 모르면(옛 모양) 마찬가지
    expect(presentEventEffective({ mst: '1', inherited: false, before: [b], after: [a] })).toEqual({ notes: [a], inherited: false });
  });

  it('날짜·범위 문구가 같으면 표기 띄어쓰기·출처·범위 판정이 달라도 바뀐 것이 아니다 (T-144)', () => {
    const a = note('2027-01-01');
    const respaced = { ...a, raw: '[시행일: 2027. 1. 1.]', source: '조문내용' as const, scope: 'unknown' as const };
    expect(presentEventEffective({ rules: 1, beforeRules: 1, mst: '1', inherited: false, before: [a], after: [respaced] })).toEqual({ notes: [respaced], inherited: false });
  });

  it('표기가 없거나 모양이 어긋나면 null', () => {
    expect(presentEventEffective(null)).toBeNull();
    expect(presentEventEffective('x')).toBeNull();
    expect(presentEventEffective({ mst: '1', inherited: false, before: null, after: [] })).toBeNull();
    expect(presentEventEffective({ after: 'bad' })).toBeNull();
  });
});

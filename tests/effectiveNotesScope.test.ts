import { describe, it, expect } from 'vitest';
import {
  EFFECTIVE_NOTES_VERSION,
  articleEffectiveNotes,
  parseEffectiveMarkers,
  sameEffectiveNotes,
  withoutEffectiveNotes,
} from '../apps/api/src/common/effective-notes';
import { toIsoDate } from '../apps/api/src/lawgokr/lawgokr.mapper';
import { lawDetailCacheKey } from '../apps/api/src/lawgokr/lawgokr-cache-keys';

/**
 * 조별 시행일 표기의 범위 판정 (T-144, PAT-06 — 완료 전 검토에서 나온 오탐·누락).
 *
 * 막고 싶은 사고: 조 전체가 늦게 시행되는데 "일부는 … 시행"이라고 단정한다(설계가 피하려던 방향), 또는 표기를 놓쳐 "없음"으로 저장한다.
 */
const one = (text: string, source: '조문참고자료' | '조문내용' = '조문참고자료') => parseEffectiveMarkers(text, source)[0];

describe('범위 판정 — "일부"는 확실할 때만 (T-144)', () => {
  it('목은 가목~하목뿐 — 제목·품목·과목·종목·다목적은 목이 아니다', () => {
    for (const text of ['제5조의 제목', '제5조 품목 분류', '제5조 과목', '제5조 종목', '제5조 다목적 시설', '제5조 검사목록']) {
      expect(one(`[시행일: 2027.1.1] ${text}`).scope, text).toBe('unknown');
    }
  });

  it('가목~하목을 가리키면 일부 — 조사가 붙어도', () => {
    for (const text of ['제5조 나목', '제5조 가목의 개정규정', '제5조 하목 및 거목']) {
      expect(one(`[시행일: 2027.1.1] ${text}`).scope, text).toBe('partial');
    }
  });

  it('서로 다른 조를 둘 이상 가리키면 이 조의 전부인지 일부인지 몰라 unknown', () => {
    expect(one('[시행일: 2027.1.1] 제5조, 제7조제1항 및 제9조의 개정규정').scope).toBe('unknown');
  });

  it('괄호 안의 한정 문구나 다른 법률의 조는 대상 조로 세지 않는다', () => {
    expect(one('[시행일: 2027.1.1] 제5조제1항(제9조제2항에 따른 신고로 한정한다)').scope).toBe('partial');
    expect(one('[시행일: 2027.1.1] 제5조제1항 중 「소득세법」 제20조에 관한 부분').scope).toBe('partial');
    // 괄호 안에만 항이 있으면 대상이 조 전체일 수 있다
    expect(one('[시행일: 2027.1.1] 제5조(제3항에 따른 신고를 포함한다)').scope).toBe('unknown');
  });

  it('범위를 밝힌 문구가 아니면 범위로 쓰지 않는다 — 조문내용의 본문이 이어질 때 "제1항에 따른"으로 일부가 되지 않는다', () => {
    const n = one('제5조(휴가) [시행일: 2027.1.1] 사용자는 제1항에 따른 휴가를 주어야 한다.', '조문내용');
    expect(n).toMatchObject({ date: '2027-01-01', scope: 'unknown', scopeText: '' });
  });

  it('[별표]·[별지] 는 범위 문구의 일부다 — 그 앞에서 자르지 않는다', () => {
    // 별표의 개정규정은 이 조의 일부인지 단정할 수 없다 — 문구는 남기되 범위는 unknown
    expect(one('[시행일: 2027.1.1] [별표 2]의 개정규정')).toMatchObject({ scopeText: '[별표 2]의 개정규정', scope: 'unknown' });
    // 다른 대괄호 표기 앞에서는 여전히 자른다
    expect(one('[시행일: 2027.1.1] 제5조제1항 [전문개정 2020.1.1]').scopeText).toBe('제5조제1항');
  });

  it('법령 번호(법률 제N호)는 호가 아니고, 겹친 괄호 속 조도 대상이 아니다(검토 지적 N5)', () => {
    expect(one('[시행일: 2027.1.1] 제5조(법률 제18425호로 개정된 것)').scope).toBe('unknown');
    expect(one('[시행일: 2027.1.1] 제5조 법률 제18425호').scope).toBe('unknown');
    expect(one('[시행일: 2027.1.1] 제5조제1항(제9조(제2항은 제외한다)에 따른 신고로 한정한다)').scope).toBe('partial');
    // 따옴표 안의 바뀌는 문구는 대상이 아니다
    expect(one('[시행일: 2027.1.1] 제5조제1항 중 "제9조에 따른"의 개정부분').scope).toBe('partial');
  });

  it('표기 뒤에 조문 본문(…다.)이 이어지면 범위 문구가 아니다 — 조 번호로 시작해도(검토 지적 N5)', () => {
    expect(one('제5조(휴가) [시행일: 2027.1.1] 제3조에 따른 휴가는 제1항의 기간으로 한다.', '조문내용')).toMatchObject({ scopeText: '', scope: 'unknown' });
    // 따옴표 안의 문장은 본문이 아니다 — 범위 문구로 남는다
    expect(one('[시행일: 2027.1.1] 제5조제1항 중 "하여야 한다."의 개정부분')).toMatchObject({ scope: 'partial' });
  });

  it('붙여 쓴 "…부령 제N호" 는 앞 글자까지 지우지 않고, ASCII 따옴표 안 문장은 본문이 아니며, 300자 너머의 문장 끝도 본다(검토 M3)', () => {
    expect(one('[시행일: 2027.1.1] 제1항및고용노동부령제3호').scope).toBe('partial');
    expect(one("[시행일: 2027.1.1] 제5조제1항 중 '하여야 한다.'의 개정부분").scope).toBe('partial');
    const long = `제3조에 따른 ${'가'.repeat(320)} 기간으로 한다.`;
    expect(one(`제5조(휴가) [시행일: 2027.1.1] ${long}`, '조문내용')).toMatchObject({ scopeText: '', scope: 'unknown' });
  });

  it('전각 콜론도 읽는다', () => {
    expect(one('[시행일：2027.1.1] 제5조제1항').date).toBe('2027-01-01');
  });

  it('범위가 달라지면 다른 기록이다(다시 읽기 판정)', () => {
    const n = one('[시행일: 2027.1.1] 제5조제1항');
    expect(sameEffectiveNotes([n], [{ ...n, scope: 'unknown' }])).toBe(false);
    expect(sameEffectiveNotes([n], [{ ...n, raw: '[시행일：2027.1.1]' }])).toBe(false);
    expect(sameEffectiveNotes([n], [{ ...n }])).toBe(true);
  });
});

describe('항·호·목 본문의 표기 (T-144)', () => {
  it('항·호·목 본문의 표기도 읽는다 — 객체 하나·배열·줄 배열 모양 모두', () => {
    const notes = articleEffectiveNotes(
      {
        조문내용: '제5조(휴가)',
        항: [
          { 항번호: '①', 항내용: '① 본문 [시행일: 2027.1.1] 제5조제1항' },
          { 항번호: '②', 항내용: '② 본문', 호: { 호번호: '1.', 호내용: ['1. 첫 줄', '[시행일: 2028.7.1] 제5조제2항제1호'], 목: [{ 목내용: '가. [시행일: 2029.1.1]' }] } },
        ],
      },
      '2026-01-01',
      toIsoDate,
    );
    expect(notes.map((n) => [n.date, n.source, n.scope])).toEqual([
      ['2027-01-01', '항·호·목', 'partial'],
      ['2028-07-01', '항·호·목', 'partial'],
      ['2029-01-01', '항·호·목', 'partial'], // 표기 뒤 문구가 없으면 그 자리(제2항제1호)가 범위다
    ]);
    expect(notes[2].scopeText).toBe('제2항제1호');
  });

  it('항·호·목 본문 끝의 표기는 그 항·호의 일부다 — 자리를 범위로 남긴다(검토 지적 N4)', () => {
    const notes = articleEffectiveNotes(
      { 항: [{ 항번호: '①', 항내용: '① 본문' }, { 항번호: '②', 항내용: '② … 한다. [시행일: 2027.1.1]', 호: [{ 호번호: '1의2.', 호내용: '1의2. 본문 [시행일: 2028.1.1]', 목: { 목번호: '나.', 목내용: '나. [시행일: 2029.1.1]' } }] }] },
      '2026-01-01',
      toIsoDate,
    );
    expect(notes.map((n) => [n.date, n.scopeText, n.scope])).toEqual([
      ['2027-01-01', '제2항', 'partial'],
      ['2028-01-01', '제2항제1호의2', 'partial'],
      ['2029-01-01', '제2항제1호의2나목', 'partial'],
    ]);
    // 호 가지번호는 따로 오기도 한다(법령 조항 행 라벨과 같은 꼴 제1호의2), 동그라미 숫자 ㉑ 이상도 읽는다(검토 M2)
    const branch = articleEffectiveNotes(
      { 항: [{ 항번호: '㉑', 항내용: '㉑ 본문 [시행일: 2027.1.1]' }, { 항번호: '③', 항내용: '③', 호: { 호번호: '1.', 호가지번호: '2', 호내용: '1의2. [시행일: 2028.1.1]' } }] },
      '2026-01-01',
      toIsoDate,
    );
    expect(branch.map((n) => n.scopeText)).toEqual(['제21항', '제3항제1호의2']);
    // 번호 있는 항이 없어도 가지번호 호의 자리만으로 일부다(검토 N7 — 제1의2호 꼴은 범위 판정이 읽지 못했다)
    const onlyHo = articleEffectiveNotes({ 항: { 호: { 호번호: '1.', 호가지번호: '2', 호내용: '1의2. 본문 [시행일: 2027.1.1]', 목: { 목번호: '가.', 목내용: '가. [시행일: 2028.1.1]' } } } }, '2026-01-01', toIsoDate);
    expect(onlyHo.map((n) => [n.scopeText, n.scope])).toEqual([
      ['제1호의2', 'partial'],
      ['제1호의2가목', 'partial'],
    ]);
    // 번호가 없는 항(항이 하나뿐인 조)이면 자리를 알 수 없어 범위 확인 필요
    expect(articleEffectiveNotes({ 항: { 항내용: '본문 [시행일: 2027.1.1]' } }, '2026-01-01', toIsoDate)[0]).toMatchObject({ scopeText: '', scope: 'unknown' });
  });

  it('항·호 번호(항번호·호번호)는 본문이 아니다 — 읽지 않는다', () => {
    expect(articleEffectiveNotes({ 항: { 항번호: '[시행일: 2027.1.1]' } }, '2026-01-01', toIsoDate)).toEqual([]);
  });
});

describe('사내 규정 트리에는 표기를 싣지 않는다 (T-144)', () => {
  it('법제처 가져오기 세션의 트리에서 모든 깊이의 effectiveNotes 를 뗀다 — 다른 칸은 그대로', () => {
    const note = one('[시행일: 2027.1.1] 제5조제1항');
    const roots = [
      { kind: 'chapter', label: '제1장', children: [{ kind: 'article', label: '제5조', effectiveNotes: [note], content: '본문' }] },
      { kind: 'article', label: '제6조', effectiveNotes: [], content: '본문2' },
    ];
    const stripped = withoutEffectiveNotes(roots as never[]) as unknown as typeof roots;
    expect(JSON.stringify(stripped)).not.toContain('effectiveNotes');
    expect(stripped[0].children?.[0]).toEqual({ kind: 'article', label: '제5조', content: '본문' });
    expect(stripped[1]).toEqual({ kind: 'article', label: '제6조', content: '본문2' });
    // 입력은 건드리지 않는다
    expect(roots[1].effectiveNotes).toEqual([]);
  });

  it('children 이 배열이 아니면 손대지 않는다 — 트리 고치기가 500 이 되지 않게(검토 지적 N3)', () => {
    const odd = [{ id: 'a', effectiveNotes: [], children: {} }];
    expect(withoutEffectiveNotes(odd as never[])).toEqual([{ id: 'a', children: {} }]);
  });
});

describe('매핑 캐시 키 (T-144)', () => {
  it('읽기 규칙의 판이 키에 들어간다 — 판을 올리면 옛 규칙으로 매핑한 캐시를 읽지 않는다(검토 지적 N1)', () => {
    expect(lawDetailCacheKey('280405')).toBe(`lawgokr:law:v3:n${EFFECTIVE_NOTES_VERSION}:280405`); // v3 — 법령ID 없는 본문을 캐시하지 않게 된 판(T-151)
  });
});

import { describe, it, expect } from 'vitest';
import {
  articleEffectiveNotes,
  normalizeEffectiveNotes,
  parseEffectiveMarkers,
  readEffectiveNotes,
  sameEffectiveNotes,
} from '../apps/api/src/common/effective-notes';
import { toIsoDate } from '../apps/api/src/lawgokr/lawgokr.mapper';

/**
 * 조마다 다른 시행일 표기 (T-144, PAT-06). 입력은 실제 법제처 응답에서 본 모양 그대로다 — 소득세법 제164조의3(조문참고자료,
 * 조의 일부가 다음 해에 시행)·중대재해 처벌 등에 관한 법률 제16조(조문내용, 법령 시행일보다 앞).
 */
const 소득세법_164_3 =
  '[본조신설 2018.12.31][제목개정 2021.3.16][시행일: 2027.1.1] 제164조의3제1항 중 "제1호의 소득"의 개정부분';
const 소득세법_81_11 =
  '[본조신설 2019.12.31][제목개정 2021.3.16][시행일: 2027.1.1] 제81조의11제1항제1호나목(제164조의3제1항제1호의 소득에 대한 간이지급명세서를 제출하지 아니한 경우로 한정한다), 제81조의11제3항제1호';
const 중대재해_16 = '제16조(정부의 사업주 등에 대한 지원 및 보고)[시행일 : 2021.1.26] 제16조';

describe('parseEffectiveMarkers — 표기 읽기', () => {
  it('참고자료의 `[시행일: …]` 를 읽고, 앞의 `[본조신설]` 같은 대괄호 표기는 건너뛴다', () => {
    const [n] = parseEffectiveMarkers(소득세법_164_3, '조문참고자료');
    expect(n).toMatchObject({ date: '2027-01-01', source: '조문참고자료', raw: '[시행일: 2027.1.1]' });
    expect(n.scopeText).toBe('제164조의3제1항 중 "제1호의 소득"의 개정부분');
  });

  it('항·호·목이나 "개정부분"을 가리키면 일부(partial)', () => {
    expect(parseEffectiveMarkers(소득세법_164_3, '조문참고자료')[0].scope).toBe('partial');
    expect(parseEffectiveMarkers(소득세법_81_11, '조문참고자료')[0].scope).toBe('partial');
  });

  it('항·호·목 없이 "개정부분"만 말해도 일부(partial) — 그 글자 하나가 근거다', () => {
    expect(parseEffectiveMarkers('[시행일: 2027.1.1] 제5조의 개정부분', '조문참고자료')[0].scope).toBe('partial');
    expect(parseEffectiveMarkers('[시행일: 2027.1.1] 제5조 개정 부분', '조문참고자료')[0].scope).toBe('partial');
  });

  it('조 번호로만 끝나면 범위를 알 수 없다(unknown) — 조 전체라고 단정하지 않는다', () => {
    const [n] = parseEffectiveMarkers(중대재해_16, '조문내용');
    expect(n).toMatchObject({ date: '2021-01-26', scope: 'unknown', scopeText: '제16조', source: '조문내용' });
    expect(parseEffectiveMarkers('[시행일: 2027.1.1]', '조문참고자료')[0]).toMatchObject({ scope: 'unknown', scopeText: '' });
  });

  it('공백·한 자리 월일·끝 마침표 변형을 같게 읽는다', () => {
    for (const marker of ['[시행일: 2027.1.1]', '[시행일 : 2027.1.1]', '[시행일: 2027. 1. 1.]', '[ 시행일 : 2027.01.01. ]']) {
      expect(parseEffectiveMarkers(`${marker} 제5조`, '조문참고자료').map((n) => n.date)).toEqual(['2027-01-01']);
    }
  });

  it('없는 날짜(2월 30일·13월)는 버린다, 윤일은 읽는다', () => {
    expect(parseEffectiveMarkers('[시행일: 2027.2.30] 제5조', '조문참고자료')).toEqual([]);
    expect(parseEffectiveMarkers('[시행일: 2027.13.1] 제5조', '조문참고자료')).toEqual([]);
    expect(parseEffectiveMarkers('[시행일: 2027.0.5] 제5조', '조문참고자료')).toEqual([]);
    expect(parseEffectiveMarkers('[시행일: 2028.2.29] 제5조', '조문참고자료').map((n) => n.date)).toEqual(['2028-02-29']);
    expect(parseEffectiveMarkers('[시행일: 2027.2.29] 제5조', '조문참고자료')).toEqual([]);
  });

  it('표기가 이어져 있으면 각자 자기 뒤 문구만 범위로 가진다', () => {
    const notes = parseEffectiveMarkers('[시행일: 2027.1.1] 제5조제1항 [시행일: 2028.7.1] 제5조제2항', '조문참고자료');
    expect(notes.map((n) => [n.date, n.scopeText])).toEqual([
      ['2027-01-01', '제5조제1항'],
      ['2028-07-01', '제5조제2항'],
    ]);
  });

  it('표기가 없거나 문자열이 아니면 빈 배열', () => {
    expect(parseEffectiveMarkers('제5조(목적) 이 법은 …', '조문내용')).toEqual([]);
    expect(parseEffectiveMarkers(null, '조문내용')).toEqual([]);
    expect(parseEffectiveMarkers(undefined, '조문참고자료')).toEqual([]);
  });

  it('범위 문구는 300자에서 자른다(원문 전체를 DB 에 싣지 않는다)', () => {
    const [n] = parseEffectiveMarkers(`[시행일: 2027.1.1] ${'제5조제1항 '.repeat(100)}`, '조문참고자료');
    expect(n.scopeText.length).toBeLessThanOrEqual(300);
  });
});

describe('articleEffectiveNotes — 조문단위 하나', () => {
  const VERSION = '2026-01-01';
  const of = (unit: Record<string, unknown>) => articleEffectiveNotes(unit, VERSION, toIsoDate);

  it('실제 응답처럼 조문시행일자가 판 시행일과 같으면 그것은 표기가 아니다', () => {
    expect(of({ 조문시행일자: '20260101', 조문참고자료: '[본조신설 2018.12.31]', 조문내용: '제5조(목적)' })).toEqual([]);
  });

  it('조문시행일자가 판 시행일과 다르면 한 건으로 남긴다(범위 알 수 없음) — 법제처가 조문별로 주기 시작해도 놓치지 않게', () => {
    expect(of({ 조문시행일자: '20270101' })).toEqual([
      { date: '2027-01-01', scope: 'unknown', scopeText: '', source: '조문시행일자', raw: '조문시행일자=2027-01-01' },
    ]);
  });

  it('판 시행일을 모르면(null) 구조화된 날짜는 비교할 수 없어 표기로 보지 않는다', () => {
    expect(articleEffectiveNotes({ 조문시행일자: '20270101' }, null, toIsoDate)).toEqual([]);
    expect(of({ 조문시행일자: '없음' })).toEqual([]);
  });

  it('참고자료·조문내용 표기를 함께 읽고 날짜 순으로 정렬하며, 같은 표기는 한 번만', () => {
    const notes = of({ 조문참고자료: `${소득세법_164_3} ${소득세법_164_3}`, 조문내용: 중대재해_16 });
    expect(notes.map((n) => [n.date, n.source])).toEqual([
      ['2021-01-26', '조문내용'],
      ['2027-01-01', '조문참고자료'],
    ]);
  });

  it('조 번호가 다른 가지 조문도 각자 자기 표기만 — 입력이 서로 섞이지 않는다', () => {
    const a = of({ 조문번호: '81', 조문가지번호: '11', 조문참고자료: 소득세법_81_11 });
    const b = of({ 조문번호: '164', 조문가지번호: '3', 조문참고자료: 소득세법_164_3 });
    expect(a[0].scopeText).toContain('제81조의11제1항제1호나목');
    expect(b[0].scopeText).toContain('제164조의3제1항');
  });

  it('20건까지만 둔다', () => {
    const many = Array.from({ length: 30 }, (_, i) => `[시행일: 2027.${(i % 12) + 1}.${(i % 27) + 1}] 제${i + 1}조제1항`).join(' ');
    expect(of({ 조문참고자료: many }).length).toBeLessThanOrEqual(20);
  });
});

describe('normalize·same·read', () => {
  const a = parseEffectiveMarkers(소득세법_164_3, '조문참고자료');
  const b = parseEffectiveMarkers(중대재해_16, '조문내용');

  it('순서가 달라도 같고, 날짜·범위가 다르면 다르다', () => {
    expect(sameEffectiveNotes([...a, ...b], [...b, ...a])).toBe(true);
    expect(sameEffectiveNotes(a, b)).toBe(false);
    expect(sameEffectiveNotes(a, [{ ...a[0], scopeText: '제164조의3제2항' }])).toBe(false);
    // 미수집(null)과 "읽었지만 없음"([])은 같은 "표기 없음"으로 비교한다 — 구분은 저장 칸이 한다
    expect(sameEffectiveNotes(null, [])).toBe(true);
  });

  it('normalize 는 겹친 것을 합친다', () => {
    expect(normalizeEffectiveNotes([...a, ...a, ...b])).toHaveLength(2);
  });

  it('DB 값은 모양이 맞는 것만 읽고, 배열이 아니면 null(미수집)', () => {
    expect(readEffectiveNotes(null)).toBeNull();
    expect(readEffectiveNotes({ date: '2027-01-01' })).toBeNull();
    expect(readEffectiveNotes([])).toEqual([]);
    expect(readEffectiveNotes([{ x: 1 }, a[0]])).toEqual([a[0]]);
  });
});

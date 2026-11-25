import { describe, it, expect } from 'vitest';
import { EFFECTIVE_NOTES_VERSION, articleEffectiveNotes, parseEffectiveMarkers } from '../apps/api/src/common/effective-notes';
import { toIsoDate } from '../apps/api/src/lawgokr/lawgokr.mapper';

/**
 * 조별 시행일 표기 읽기 규칙의 지문 (T-144, PAT-06 — 완료 전 검토 M1).
 *
 * 등록된 법령은 법령 행의 읽기 판(`Law.effectiveNotesVersion`)이 지금 `EFFECTIVE_NOTES_VERSION` 과 다를 때만 다시 읽힌다.
 * 규칙을 고쳐 읽는 결과가 바뀌었는데 판을 올리지 않으면, 이미 읽은 법령에는 옛 규칙의 표기가 영영 남는다.
 *
 * **이 시험이 깨지면**: 결과가 바뀐 것이 의도라면 `EFFECTIVE_NOTES_VERSION` 을 1 올리고, 아래 RULES_VERSION 과 기대값을 함께 고친다.
 * 판을 올리면 다음 주기 동기화가 모든 법령을 한 번씩 다시 읽는다(이벤트는 만들지 않는다).
 */
const RULES_VERSION = 1;

type Source = '조문참고자료' | '조문내용' | '항·호·목';
const CORPUS: [string, Source, string, [string, string, string][]][] = [
  [
    '[본조신설 2018.12.31][제목개정 2021.3.16][시행일: 2027.1.1] 제164조의3제1항 중 "제1호의 소득"의 개정부분',
    '조문참고자료',
    '',
    [['2027-01-01', 'partial', '제164조의3제1항 중 "제1호의 소득"의 개정부분']],
  ],
  [
    '[본조신설 2019.12.31][제목개정 2021.3.16][시행일: 2027.1.1] 제81조의11제1항제1호나목(제164조의3제1항제1호의 소득에 대한 간이지급명세서를 제출하지 아니한 경우로 한정한다), 제81조의11제3항제1호',
    '조문참고자료',
    '',
    [['2027-01-01', 'partial', '제81조의11제1항제1호나목(제164조의3제1항제1호의 소득에 대한 간이지급명세서를 제출하지 아니한 경우로 한정한다), 제81조의11제3항제1호']],
  ],
  ['제16조(정부의 사업주 등에 대한 지원 및 보고)[시행일 : 2021.1.26] 제16조', '조문내용', '', [['2021-01-26', 'unknown', '제16조']]],
  ['[시행일: 2027.1.1] 제5조, 제7조제1항 및 제9조의 개정규정', '조문참고자료', '', [['2027-01-01', 'unknown', '제5조, 제7조제1항 및 제9조의 개정규정']]],
  ['[시행일: 2027.1.1] [별표 2]의 개정규정', '조문참고자료', '', [['2027-01-01', 'unknown', '[별표 2]의 개정규정']]],
  ['제5조(휴가) [시행일: 2027.1.1] 제3조에 따른 휴가는 제1항의 기간으로 한다.', '조문내용', '', [['2027-01-01', 'unknown', '']]],
  ['② … 한다. [시행일: 2027.1.1]', '항·호·목', '제2항', [['2027-01-01', 'partial', '제2항']]],
  ['[시행일：2027. 1. 1.] 제5조 나목', '조문참고자료', '', [['2027-01-01', 'partial', '제5조 나목']]],
];

describe('표기 읽기 규칙의 지문 (T-144)', () => {
  it('읽는 결과가 바뀌면 읽기 판을 올려야 한다 — 이 시험의 판과 코드의 판이 같다', () => {
    expect(EFFECTIVE_NOTES_VERSION, '규칙의 판을 올렸으면 아래 기대값이 새 규칙의 결과인지 확인하고 RULES_VERSION 도 올린다').toBe(RULES_VERSION);
  });

  it('항·호·목 본문 표기의 자리(가지번호 호·목 포함)', () => {
    const unit = { 항: [{ 항번호: '②', 항내용: '② 본문', 호: { 호번호: '1.', 호가지번호: '2', 호내용: '1의2. [시행일: 2027.1.1]' } }, { 호번호: '3.', 호내용: '3. [시행일: 2028.1.1]' }] };
    const got = articleEffectiveNotes(unit, '2026-01-01', toIsoDate).map((n) => [n.date, n.scope, n.scopeText]);
    expect(got, '읽는 결과가 바뀌었다 — 의도라면 EFFECTIVE_NOTES_VERSION 을 1 올리고 이 시험의 판과 기대값을 고친다').toEqual([
      ['2027-01-01', 'partial', '제2항제1호의2'],
      ['2028-01-01', 'partial', '제3호'],
    ]);
  });

  it.each(CORPUS)('%s', (text, source, at, expected) => {
    const got = parseEffectiveMarkers(text, source, at).map((n) => [n.date, n.scope, n.scopeText]);
    expect(got, '읽는 결과가 바뀌었다 — 의도라면 EFFECTIVE_NOTES_VERSION 을 1 올리고 이 시험의 판과 기대값을 고친다').toEqual(expected);
  });
});

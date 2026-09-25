import { describe, it, expect } from 'vitest';
import { buildTreeFromJoUnits } from '../apps/api/src/lawgokr/lawgokr.mapper';
import { buildLawArticleRows } from '../apps/api/src/laws/law-rows';
import { lawVersionKey } from '../apps/api/src/laws/law-version-key';

/**
 * 트리는 실제 매퍼(`buildTreeFromJoUnits`)를 통과시켜 만든다.
 * 손으로 만든 트리로 검증하면 매퍼 쪽 규칙이 바뀌었을 때 여기서 못 잡는다.
 */
const runOf = (units: any[]) => buildLawArticleRows(buildTreeFromJoUnits(units as any).roots);
const rowsOf = (units: any[]) => runOf(units).rows;

describe('buildLawArticleRows — 조 식별', () => {
  it('원문 조 번호를 그대로 쓴다 (사내 규정처럼 1부터 새로 매기지 않는다)', () => {
    const rows = rowsOf([
      { 조문번호: '60', 조문여부: '조문', 조문제목: '연차 유급휴가', 조문내용: '제60조(연차 유급휴가) 사용자는 ...' },
      { 조문번호: '61', 조문여부: '조문', 조문제목: '휴가사용촉진', 조문내용: '제61조(휴가사용촉진) ...' },
    ]);
    expect(rows.map((r) => r.articleNo)).toEqual([60, 61]);
    expect(rows.map((r) => r.label)).toEqual(['제60조', '제61조']);
  });

  it('제3조와 제3조의2를 다른 조문으로 구분한다 (articleNo 만으로는 같아 보인다)', () => {
    const rows = rowsOf([
      { 조문번호: '3', 조문여부: '조문', 조문제목: '적용범위', 조문내용: '제3조(적용범위) 가.' },
      { 조문번호: '3', 조문가지번호: '2', 조문여부: '조문', 조문제목: '특례', 조문내용: '제3조의2(특례) 나.' },
    ]);
    expect(rows.map((r) => r.articleNo)).toEqual([3, 3]); // 숫자 컬럼만 보면 같다
    expect(rows.map((r) => r.nodeKey)).toEqual(['3//', '3의2//']); // 식별자는 다르다
    expect(rows.map((r) => r.label)).toEqual(['제3조', '제3조의2']);
    expect(new Set(rows.map((r) => r.nodeKey)).size).toBe(2);
  });
});

describe('buildLawArticleRows — 조>항>호>목 4단', () => {
  const units = [
    {
      조문번호: '2',
      조문여부: '조문',
      조문제목: '정의',
      조문내용: '제2조(정의)',
      항: [
        {
          항번호: '①',
          항내용: '① 이 법에서 사용하는 용어의 뜻은 다음과 같다.',
          호: [
            {
              호번호: '1.',
              호내용: '1. "근로자"란 직업의 종류와 관계없이 임금을 목적으로 근로를 제공하는 자를 말한다.',
              목: [{ 목번호: '가.', 목내용: '가. 다만 공무원은 제외한다.' }],
            },
            { 호번호: '2.', 호내용: '2. "사용자"란 사업주를 말한다.' },
          ],
        },
        { 항번호: '②', 항내용: '② 제1항의 기준은 대통령령으로 정한다.' },
      ],
    },
  ];

  it('조·항·호가 각각 행이 된다', () => {
    const rows = rowsOf(units);
    expect(rows.map((r) => r.nodeKey)).toEqual(['2//', '2/1/', '2/1/1', '2/1/2', '2/2/']);
    expect(rows.map((r) => r.label)).toEqual([
      '제2조',
      '제2조제1항',
      '제2조제1항제1호',
      '제2조제1항제2호',
      '제2조제2항',
    ]);
  });

  it('숫자 컬럼이 계층과 맞는다', () => {
    const rows = rowsOf(units);
    expect(rows.map((r) => [r.articleNo, r.clauseNo, r.itemNo])).toEqual([
      [2, null, null],
      [2, 1, null],
      [2, 1, 1],
      [2, 1, 2],
      [2, 2, null],
    ]);
  });

  it('목(가./나.)은 행을 만들지 않고 부모 호 본문에 합친다', () => {
    const rows = rowsOf(units);
    const ho1 = rows.find((r) => r.nodeKey === '2/1/1')!;
    expect(ho1.content).toContain('"근로자"란');
    expect(ho1.content).toContain('다만 공무원은 제외한다');
    // 목이 별도 행으로 새지 않았는지
    expect(rows.some((r) => r.content.trim() === '다만 공무원은 제외한다.')).toBe(false);
  });

  it('조 본문 행에는 제목이 있고 항·호 행에는 없다', () => {
    const rows = rowsOf(units);
    expect(rows[0].title).toBe('정의');
    expect(rows.slice(1).every((r) => r.title === null)).toBe(true);
  });
});

describe('buildLawArticleRows — 그 밖의 규칙', () => {
  it('편·장·절 제목 행은 법령조항이 아니다', () => {
    const rows = rowsOf([
      { 조문여부: '전문', 조문번호: '1', 조문내용: '       제1장 총칙 <개정 2009.2.6>' },
      { 조문번호: '1', 조문여부: '조문', 조문제목: '목적', 조문내용: '제1조(목적) 이 법은 ...' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].nodeKey).toBe('1//');
  });

  it('조 번호를 읽을 수 없는 행은 가짜 조문을 만들지 않고 건너뛴다', () => {
    const out = runOf([
      { 조문여부: '조문', 조문내용: '[별표 1] 서식은 별도로 정한다.' },
      { 조문번호: '1', 조문여부: '조문', 조문제목: '목적', 조문내용: '제1조(목적) ...' },
    ]);
    expect(out.rows).toHaveLength(1);
    expect(out.skipped).toBe(1);
  });

  it('항 번호가 없는 조는 호가 조 직속으로 붙는다', () => {
    const rows = rowsOf([
      {
        조문번호: '5',
        조문여부: '조문',
        조문제목: '금지행위',
        조문내용: '제5조(금지행위) 누구든지 다음 행위를 하여서는 아니 된다.',
        항: [{ 항내용: '누구든지 다음 행위를 하여서는 아니 된다.', 호: [{ 호번호: '1.', 호내용: '1. 폭행' }] }],
      },
    ]);
    expect(rows.map((r) => r.nodeKey)).toEqual(['5//', '5//1']);
    expect(rows[1].clauseNo).toBeNull();
    expect(rows[1].itemNo).toBe(1);
  });

  it('가지번호는 단위 뒤에 붙는다 — 제3조의2 · 제1호의2 (제3의2조가 아니다)', () => {
    const rows = rowsOf([
      {
        조문번호: '3',
        조문가지번호: '2',
        조문여부: '조문',
        조문제목: '특례',
        조문내용: '제3조의2(특례) 본문',
        항: [{ 항번호: '①', 항내용: '① 가', 호: [{ 호번호: '1.', 호가지번호: '2', 호내용: '1의2. 나' }] }],
      },
    ]);
    expect(rows.map((r) => r.label)).toEqual(['제3조의2', '제3조의2제1항', '제3조의2제1항제1호의2']);
    expect(rows.map((r) => r.nodeKey)).toEqual(['3의2//', '3의2/1/', '3의2/1/1의2']);
  });

  it('sortOrder 가 원문 순서를 유지하고 nodeKey 는 법령 안에서 유일하다', () => {
    const rows = rowsOf([
      { 조문번호: '1', 조문여부: '조문', 조문내용: '제1조 가', 항: [{ 항번호: '①', 항내용: '① 가' }] },
      { 조문번호: '2', 조문여부: '조문', 조문내용: '제2조 나', 항: [{ 항번호: '①', 항내용: '① 나' }] },
    ]);
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(new Set(rows.map((r) => r.nodeKey)).size).toBe(rows.length);
  });

  it('각 행의 지문은 그 행 본문으로 계산된다', () => {
    const rows = rowsOf([{ 조문번호: '1', 조문여부: '조문', 조문제목: '목적', 조문내용: '제1조(목적) 본문이다.' }]);
    expect(rows[0].versionKey).toBe(lawVersionKey(rows[0].content));
    expect(rows[0].versionKey).toMatch(/^v1:[0-9a-f]{64}$/);
  });
});

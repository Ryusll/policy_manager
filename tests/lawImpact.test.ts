import { describe, it, expect } from 'vitest';
import { impactReferenceDate } from '../apps/api/src/law-changes/law-impact';
import { buildTreeFromJoUnits } from '../apps/api/src/lawgokr/lawgokr.mapper';
import { buildLawArticleRows, labelFromNodeKey } from '../apps/api/src/laws/law-rows';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('impactReferenceDate — 영향 분석 기준일 (T-105)', () => {
  const today = d('2026-10-07');

  it('시행 전인 개정은 그 시행일 — 그날 시행될 우리 조문이 고칠 대상이다', () => {
    expect(impactReferenceDate(d('2026-12-01'), today)).toEqual(d('2026-12-01'));
  });

  it('이미 시행된 개정은 오늘 — 그 사이 회사가 고쳤다면 고친 본문이 기준이다', () => {
    expect(impactReferenceDate(d('2026-01-01'), today)).toEqual(today);
  });

  it('시행일이 오늘이면 오늘, 모르면 오늘', () => {
    expect(impactReferenceDate(d('2026-10-07'), today)).toEqual(today);
    expect(impactReferenceDate(null, today)).toEqual(today);
  });
});

describe('labelFromNodeKey — 조문이 사라진 변경도 읽을 수 있게', () => {
  it('조·항·호와 가지번호를 등록 때와 같은 표기로 되돌린다', () => {
    expect(labelFromNodeKey('5//')).toBe('제5조');
    expect(labelFromNodeKey('3의2//')).toBe('제3조의2');
    expect(labelFromNodeKey('60/1/')).toBe('제60조제1항');
    expect(labelFromNodeKey('2/1/1')).toBe('제2조제1항제1호');
    expect(labelFromNodeKey('2/1/1의2')).toBe('제2조제1항제1호의2');
    expect(labelFromNodeKey('7//3')).toBe('제7조제3호'); // 항 없이 조 바로 아래 호
  });

  it('등록이 만든 표기와 정확히 같다 — 실제 매퍼를 통과한 행으로 왕복 확인', () => {
    const { rows } = buildLawArticleRows(
      buildTreeFromJoUnits([
        { 조문번호: '3', 조문가지번호: '2', 조문여부: '조문', 조문제목: '특례', 조문내용: '제3조의2(특례) 가.' },
        {
          조문번호: '2', 조문여부: '조문', 조문제목: '정의', 조문내용: '제2조(정의)',
          항: [{ 항번호: '①', 항내용: '① 용어의 뜻은 다음과 같다.', 호: [
            { 호번호: '1.', 호내용: '1. "근로자"란 ...' },
            { 호번호: '2.', 호내용: '2. "사용자"란 ...' },
          ] }],
        },
      ]).roots,
    );
    expect(rows.length).toBeGreaterThan(3);
    for (const row of rows) expect(labelFromNodeKey(row.nodeKey), row.nodeKey).toBe(row.label);
  });

  it('형식이 어긋나면 nodeKey 를 그대로 — 빈칸보다 낫다', () => {
    expect(labelFromNodeKey('이상한값')).toBe('이상한값');
  });
});

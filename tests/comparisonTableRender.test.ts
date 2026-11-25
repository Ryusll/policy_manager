import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { buildComparisonRows, type CompareArticleInput } from '../apps/api/src/policies/policy-compare';
import { groupComparisonRows } from '../apps/web/src/lib/compareTableGroups';
import ComparisonTable from '../apps/web/src/components/ComparisonTable';

/**
 * 신구조문대비표 표 그리기 (T-229) — 묶음 머리(rowgroup), 구분 칸 주소, 번호만 바뀐 행의 배지와 구조문 칸 위치, 제목 조각만
 * 긋는 강조가 실제 마크업에 나오는지 본다(묶기 규칙 자체는 compareTableGroups.test.ts).
 */
const art = (id: string, number: number, over: Partial<CompareArticleInput> = {}): CompareArticleInput => ({
  id,
  number,
  clauseNumber: null,
  itemNumber: null,
  title: '',
  content: `${id} 본문`,
  effectiveDate: null,
  ...over,
});

const render = (before: CompareArticleInput[], after: CompareArticleInput[]) =>
  renderToStaticMarkup(
    createElement(ComparisonTable, {
      groups: groupComparisonRows(buildComparisonRows(before, after).rows, true),
      from: '2026-11-19',
      to: '2026-11-20',
    }),
  );

describe('신구조문대비표 표 그리기 (T-229)', () => {
  it('조마다 tbody 하나와 묶음 머리(th scope=rowgroup), 구분 칸에 어느 조인지까지', () => {
    const before = [art('h12', 12, { title: '감사위원회의 조사', content: '' }), art('c1', 12, { clauseNumber: 1 })];
    const html = render(before, [...before, art('c2i1', 12, { clauseNumber: 2, itemNumber: 1 })]);
    expect(html).toMatch(/<tbody[^>]*><tr[^>]*><th colSpan="3" scope="rowgroup"[^>]*>제12조\(감사위원회의 조사\)<\/th><\/tr>/);
    expect(html).toContain('>제12조 ② 1.</div>');
    expect(html).toContain('>신설</span>');
    expect(html.match(/<tbody[ >]/g)).toHaveLength(1);
    // 인쇄 때 한 쪽에 드는 묶음은 쪼개지 않는다
    expect(html).toContain('<tbody class="print:break-inside-avoid">');
  });

  it('번호만 바뀐 행은 번호만 바뀜 배지와 구조문 칸 맨 위의 그때 위치', () => {
    const html = render(
      [art('h3', 3, { title: '휴가', content: '' }), art('h3c1', 3, { clauseNumber: 1, content: '연차' })],
      [art('h3', 5, { title: '휴가', content: '' }), art('h3c1', 5, { clauseNumber: 1, content: '연차' })],
    );
    expect(html.match(/>번호만 바뀜<\/span>/g)).toHaveLength(2);
    expect(html).toContain('>제3조 ①</div>');
    // 조 머리 행은 칸 제목 줄에 그때의 번호
    expect(html).toContain('<span>제3조</span><span>(</span><span>휴가</span><span>)</span>');
  });

  it('제목이 바뀌면 제목 조각만 긋고 칠한다 — 번호는 그대로', () => {
    const html = render([art('h1', 1, { title: '목적', content: 'A' })], [art('h1', 1, { title: '목적 및 범위', content: 'A' })]);
    expect(html).toContain('<span>제1조</span><span>(</span><span class="text-rose-800 line-through">목적</span><span>)</span>');
    expect(html).toContain('<span class="text-emerald-800">목적 및 범위</span>');
    expect(html).not.toMatch(/line-through">제1조/);
  });
});

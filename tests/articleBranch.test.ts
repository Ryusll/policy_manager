import { describe, it, expect } from 'vitest';
import {
  articleShortLabel,
  formatArticleJo,
  groupArticlesByJo,
} from '../apps/web/src/lib/legalArticleLabel';
import { articleHash, findByAnchor, formatArticleAnchor, parseArticleAnchor } from '../apps/web/src/lib/articleAnchor';
import { renumberChapters, expandChaptersWithHierarchy } from '../apps/web/src/lib/policyImportHierarchy';
import { buildFullViewGroups, collectJoNumbers, filterFullViewGroupsByJo } from '../apps/web/src/lib/fullViewGroups';
import { buildJoRows, toReorderPayload } from '../apps/web/src/lib/joReorder';
import { nextClauseNumberForJo } from '../apps/web/src/lib/articleStructure';

/**
 * 가지 조문("제3조의2"). 개정으로 조 사이에 끼워 넣은 조문이라 번호를 당기면
 * 원문·법령 인용과 어긋난다. 조 하나 = (조 번호, 가지 번호).
 */
const art = (id: string, number: number, branchNumber: number | null, clauseNumber: number | null = null) => ({
  id,
  number,
  branchNumber,
  clauseNumber,
  itemNumber: null,
  title: clauseNumber == null ? `조${number}${branchNumber ? `의${branchNumber}` : ''}` : '',
  versions: [{ status: 'published', content: `본문 ${id}` }],
});
const articles = [
  art('j3', 3, null),
  art('j3h1', 3, null, 1),
  art('j3b2', 3, 2),
  art('j3b2h1', 3, 2, 1),
  art('j4', 4, null),
];

describe('가지 조문 표기·묶기', () => {
  it('"제3조의2"로 표기한다', () => {
    expect(formatArticleJo(3, 2)).toBe('제3조의2');
    expect(formatArticleJo(3)).toBe('제3조');
    expect(articleShortLabel({ number: 3, branchNumber: 2 })).toBe('제3조의2');
  });

  it('제3조와 제3조의2를 다른 조로 묶고, 항이 섞이지 않는다', () => {
    const groups = groupArticlesByJo(articles);
    expect(groups.map((g) => [g.jo, g.branch, g.hangs.map((h) => h.hang?.id)])).toEqual([
      [3, null, ['j3h1']],
      [3, 2, ['j3b2h1']],
      [4, null, []],
    ]);
  });

  it('항 추가 번호는 그 가지 조문 안에서 센다', () => {
    expect(nextClauseNumberForJo(articles, 3, 2)).toBe(2);
    expect(nextClauseNumberForJo(articles, 4)).toBe(1);
  });
});

describe('가지 조문 링크', () => {
  it('"#제3조의2제1항"으로 가리키고 되읽는다', () => {
    expect(formatArticleAnchor({ number: 3, branchNumber: 2, clauseNumber: 1 })).toBe('제3조의2제1항');
    const anchor = parseArticleAnchor({ hash: articleHash({ number: 3, branchNumber: 2, clauseNumber: 1 }) });
    expect(anchor).toEqual({ jo: 3, branch: 2, hang: 1, mok: null });
    expect(findByAnchor(articles, anchor!)?.id).toBe('j3b2h1');
  });

  it('예전 링크 "#제3조"는 그대로 제3조를 연다 (가지 조문으로 새지 않는다)', () => {
    const anchor = parseArticleAnchor({ hash: '#제3조' });
    expect(anchor).toEqual({ jo: 3, hang: null, mok: null });
    expect(findByAnchor(articles, anchor!)?.id).toBe('j3');
  });
});

describe('가지 조문 — 전문 보기 선택 인쇄', () => {
  it('제3조의2만 골라 인쇄할 수 있다 (제3조가 딸려 오지 않는다)', () => {
    const chapters = buildFullViewGroups([{ id: 'c', number: 1, title: '총칙', articles }]);
    expect(collectJoNumbers(chapters)).toEqual([3, '3-2', 4]);
    const only = filterFullViewGroupsByJo(chapters, new Set(['3-2']));
    expect(only[0].allGroups.map((g: any) => [g.articleNumber, g.articleBranch])).toEqual([[3, 2]]);
  });
});

describe('가지 조문 — 텍스트 가져오기 번호 다시 매기기', () => {
  it('가지 조문은 새 번호를 받지 않고 바로 앞 조 번호를 따른다', () => {
    const renumbered = renumberChapters([
      {
        number: 1,
        title: '총칙',
        articles: [
          { number: 1, title: '목적', content: '본문' },
          { number: 3, title: '권한', content: '본문' },
          { number: 3, branch: 2, title: '경영철학', content: '① 실천한다.' },
          { number: 4, title: '구성', content: '본문' },
        ],
      },
    ]);
    const rows = expandChaptersWithHierarchy(renumbered as any)[0].articles;
    expect(rows.map((r) => [r.number, r.branch ?? null, r.clauseNumber ?? null])).toEqual([
      [1, null, null],
      [2, null, null],
      [2, 2, null], // 제2조의2 (원문 제3조의2 → 번호 정리 뒤에도 앞 조에 붙는다)
      [2, 2, 1],
      [3, null, null],
    ]);
  });
});

describe('가지 조문 — 조 순서 재정렬 목록', () => {
  it('제3조의2가 따로 한 줄이고, 서버로 가지 번호를 함께 보낸다', () => {
    const rows = buildJoRows([{ id: 'c', number: 1, title: '총칙', articles }]);
    expect(rows.map((r) => [r.jo, r.branch ?? null, r.title])).toEqual([
      [3, null, '조3'],
      [3, 2, '조3의2'],
      [4, null, '조4'],
    ]);
    expect(toReorderPayload(rows)).toEqual([
      { chapterId: 'c', jo: 3 },
      { chapterId: 'c', jo: 3, branch: 2 },
      { chapterId: 'c', jo: 4 },
    ]);
  });
});

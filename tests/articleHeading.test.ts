import { describe, it, expect } from 'vitest';
import {
  articleDisplayLabel,
  articleHeadingSegments,
  articlePositionLabel,
  articleRowHeading,
  bareArticleTitle,
  chapterArticleLabel,
  formatArticleHeading,
} from '../apps/web/src/lib/articleHeading';
import { hangRepeatsJoTitle, inferJoTitle, segmentArticleHeading } from '../apps/web/src/lib/articleStructure';
import { filterTocChapters, filterTocGroups, tocArticleLabel, tocSearchText } from '../apps/web/src/lib/tocLabel';
import { formatArticleRowHeading } from '../apps/api/src/common/article-label';
import { articleHeading as amendmentArticleHeading } from '../apps/api/src/amendments/amendment-reason';

/**
 * T-211 조 머리 표기(SRS POLICY-10) — 번호와 제목을 붙여 `제N조(제목)` 한 줄로 적는다.
 * 화면(web)과 알림·시행 예정 목록·개정안 문서(api)가 같은 표를 통과해야 한다 — 두 함수가 따로 있어 한쪽만 고치면 어긋난다.
 */
const CASES: [name: string, number: number, branch: number | null, title: string | null | undefined, want: string][] = [
  ['제목이 있으면 번호에 붙여 괄호로', 1, null, '목적', '제1조(목적)'],
  ['제목이 비면 번호만', 2, null, '', '제2조'],
  ['제목이 null 이면 번호만', 2, null, null, '제2조'],
  ['제목이 없으면(undefined) 번호만', 2, null, undefined, '제2조'],
  ['공백뿐인 제목은 없는 것으로', 2, null, '   ', '제2조'],
  ['가지 번호', 3, 2, '정의', '제3조의2(정의)'],
  ['제목 앞뒤 공백은 뗀다', 1, null, ' 목적 ', '제1조(목적)'],
  ['괄호까지 적은 제목은 겹치지 않는다', 1, null, '(목적)', '제1조(목적)'],
  ['전각 괄호로 적은 제목도', 1, null, '（목적）', '제1조(목적)'],
  ['반각·전각을 섞어 적어도', 1, null, '(목적）', '제1조(목적)'],
  ['괄호 안쪽 공백은 뗀다', 1, null, '( 목적 )', '제1조(목적)'],
  ['겉 한 겹만 벗긴다', 1, null, '((목적))', '제1조((목적))'],
  ['첫 괄호가 중간에서 닫히면 제목의 일부다', 1, null, '(주)인사', '제1조((주)인사)'],
  ['괄호 덩어리가 둘이면 그대로', 1, null, '(정의) 및 (적용)', '제1조((정의) 및 (적용))'],
  ['짝이 맞지 않으면 그대로', 1, null, '(목적', '제1조((목적)'],
  ['제목 안쪽 괄호는 그대로', 4, null, '휴가(연차)', '제4조(휴가(연차))'],
  ['빈 괄호뿐이면 제목이 없는 것', 5, null, '()', '제5조'],
];

describe('조 머리 표기 — 제N조(제목) (T-211)', () => {
  it.each(CASES)('화면: %s', (_name, number, branch, title, want) => {
    expect(formatArticleHeading(number, branch, title)).toBe(want);
  });

  it.each(CASES)('서버(알림·시행 예정 목록·개정안 문서): %s', (_name, number, branch, title, want) => {
    expect(formatArticleRowHeading({ number, branchNumber: branch, title })).toBe(want);
  });

  it('조각을 이으면 통째 표기와 같다 — 강조하는 화면도 같은 정의를 쓴다', () => {
    expect(articleHeadingSegments(3, 2, '(정의)')).toEqual([
      { text: '제3조의2', part: 'number' },
      { text: '(', part: 'paren' },
      { text: '정의', part: 'title' },
      { text: ')', part: 'paren' },
    ]);
    expect(articleHeadingSegments(2, null, ' ')).toEqual([{ text: '제2조', part: 'number' }]);
    for (const [, number, branch, title, want] of CASES) {
      expect(articleHeadingSegments(number, branch, title).map((s) => s.text).join('')).toBe(want);
    }
  });

  it('겉 괄호를 벗긴 제목', () => {
    expect(bareArticleTitle('(목적)')).toBe('목적');
    expect(bareArticleTitle('목적')).toBe('목적');
    expect(bareArticleTitle('(주)인사')).toBe('(주)인사');
    expect(bareArticleTitle(null)).toBe('');
  });
});

describe('서버의 조문 행 머리 — 항·목은 위치까지 (T-211 ③)', () => {
  it.each([
    ['조', { number: 1, title: '목적' }, '제1조(목적)'],
    ['항의 부제는 조 제목 자리에 들어가지 않는다', { number: 2, clauseNumber: 2, title: '입증' }, '제2조제2항(입증)'],
    ['부제 없는 항', { number: 2, clauseNumber: 1, title: '' }, '제2조제1항'],
    ['목', { number: 2, branchNumber: 3, clauseNumber: 1, itemNumber: 4, title: null }, '제2조의3제1항제4목'],
    ['괄호까지 적은 부제', { number: 2, clauseNumber: 1, title: '(입증)' }, '제2조제1항(입증)'],
  ])('%s', (_name, article, want) => {
    expect(formatArticleRowHeading(article)).toBe(want);
  });

  it('개정안 문서·개정 이유의 조문 머리도 같은 함수다', () => {
    const article = { number: 7, branchNumber: null, clauseNumber: null, itemNumber: null, title: '(보칙)' };
    expect(amendmentArticleHeading(article)).toBe('제7조(보칙)');
    expect(amendmentArticleHeading({ ...article, clauseNumber: 1, title: '입증' })).toBe('제7조제1항(입증)');
    expect(amendmentArticleHeading({ ...article, title: null })).toBe('제7조');
  });
});

describe('화면의 조문 행 라벨 (T-211 ③)', () => {
  const jo = { number: 1, title: '목적' };
  const hang = { number: 2, clauseNumber: 2, title: '입증' };
  const bareHang = { number: 2, clauseNumber: 1, title: '' };
  const mok = { number: 2, clauseNumber: 1, itemNumber: 3, title: '' };

  it.each([
    ['조 머리 행', jo, '제1조(목적)'],
    ['제목 없는 조', { number: 2, title: '' }, '제2조'],
    ['가지 조', { number: 3, branchNumber: 2, title: '정의' }, '제3조의2(정의)'],
    ['부제 없는 항은 번호만 — 빈 괄호를 붙이지 않는다', bareHang, '①'],
    ['부제 있는 항', hang, '② 입증'],
    ['목', mok, '3.'],
  ])('조 안에서: %s', (_name, article, want) => {
    expect(articleDisplayLabel(article)).toBe(want);
  });

  it.each([
    ['조', jo, '제1조(목적)'],
    ['항의 부제는 조 제목 자리에 들어가지 않는다', hang, '제2조 ② 입증'],
    ['부제 없는 항', bareHang, '제2조 ①'],
    ['목은 항까지', mok, '제2조 ① 3.'],
    ['항 없이 조에 달린 목', { number: 4, branchNumber: 2, itemNumber: 1, title: '' }, '제4조의2 1.'],
  ])('조 밖에서: %s', (_name, article, want) => {
    expect(articleRowHeading(article)).toBe(want);
  });

  it('조문 이동·이력 목록의 한 줄', () => {
    expect(chapterArticleLabel(1, jo)).toBe('제1장 · 제1조(목적)');
    expect(chapterArticleLabel(2, bareHang)).toBe('제2장 · 제2조 ①');
    expect(chapterArticleLabel(1, { number: 3, title: '' })).toBe('제1장 · 제3조');
  });

  it('자리 표기 화면(개정 검토·즐겨찾기·법령 영향·제안 계층) — 조 자리면 조 머리, 항·목 자리면 위치(부제)', () => {
    expect(articlePositionLabel({ number: 28 }, '휴가', '제28조')).toBe('제28조(휴가)');
    expect(articlePositionLabel({ number: 3, branchNumber: 2 }, '(정의)', '쓰지 않는 글')).toBe('제3조의2(정의)');
    expect(articlePositionLabel({ number: 3 }, '', '쓰지 않는 글')).toBe('제3조');
    expect(articlePositionLabel({ number: 3, clauseNumber: 1 }, '입증', '제3조 제1항')).toBe('제3조 제1항(입증)');
    expect(articlePositionLabel({ number: 3, clauseNumber: 1, itemNumber: 2 }, null, '제3조제1항제2목')).toBe('제3조제1항제2목');
  });

  it('자리 표기의 부제도 겉 괄호를 벗긴다 — 서버(알림·개정안 문서)와 같은 꼴', () => {
    const hang = { number: 3, clauseNumber: 1, title: '(입증)' };
    expect(articlePositionLabel(hang, hang.title, '제3조제1항')).toBe('제3조제1항(입증)');
    expect(articlePositionLabel(hang, hang.title, '제3조제1항')).toBe(formatArticleRowHeading(hang));
    expect(articlePositionLabel({ number: 3, clauseNumber: 1 }, '(주)인사', '제3조제1항')).toBe('제3조제1항((주)인사)');
  });

  it('조문별 보기 머리 — 항을 골라도 조 머리는 제N조(제목)', () => {
    const rows = [
      { number: 2, title: '수당', clauseNumber: null, itemNumber: null },
      { number: 2, title: '', clauseNumber: 1, itemNumber: null },
      { number: 3, title: '', clauseNumber: null, itemNumber: null },
    ];
    expect(segmentArticleHeading(rows[0], rows)).toEqual({ joLine: '제2조(수당)', subLine: null });
    expect(segmentArticleHeading(rows[1], rows)).toEqual({ joLine: '제2조(수당)', subLine: '항 1' });
    expect(segmentArticleHeading(rows[2], rows)).toEqual({ joLine: '제3조', subLine: null });
  });
});

describe('목차 한 줄 (T-211 ③)', () => {
  const body = (content: string) => ({ versions: [{ content }] });

  it('조는 조 머리 표기', () => {
    expect(tocArticleLabel({ number: 1, title: '목적' })).toBe('제1조(목적)');
    expect(tocArticleLabel({ number: 3, branchNumber: 2, title: '' })).toBe('제3조의2');
    expect(tocArticleLabel({ number: 4, title: '(보칙)' })).toBe('제4조(보칙)');
  });

  it('조 머리 행은 그 행의 제목으로 적는다 — 조 머리 행이 있으면 조 제목은 그 행의 제목이다', () => {
    expect(tocArticleLabel({ number: 5, title: '직무' }, '직무')).toBe('제5조(직무)');
    expect(tocArticleLabel({ number: 5, title: '' }, '')).toBe('제5조');
    // 조 머리 행의 제목이 비면 번호만 — 추정 조 제목으로 채우지 않는다(조 머리 행이 있으면 항 제목은 항 부제다)
    expect(tocArticleLabel({ number: 5, title: '' }, '권한')).toBe('제5조');
  });

  it('항·목은 번호와 부제 — 부제가 없으면 본문 앞부분', () => {
    expect(tocArticleLabel({ number: 2, clauseNumber: 2, title: '입증', ...body('본문') }, '요건')).toBe('② 입증');
    expect(tocArticleLabel({ number: 2, clauseNumber: 1, title: '', ...body('주주제안은\n  6주 전에 한다.') }, '요건')).toBe('① 주주제안은 6주 전에 한다.');
    expect(tocArticleLabel({ number: 2, clauseNumber: 1, itemNumber: 1, title: '' }, '요건')).toBe('1.');
  });

  it('목차 필터는 보이는 조 머리 그대로도, 예전 꼴로도 찾는다', () => {
    const jo = { number: 1, title: '(목적)', clauseNumber: null, itemNumber: null, ...body('이 규정은 …') };
    for (const q of ['제1조(목적)', '제1조 (목적)', '목적', '제1조', '이 규정은']) expect(tocSearchText(jo)).toContain(q.toLowerCase());
    const hang = { number: 2, clauseNumber: 2, itemNumber: null, title: '입증', ...body('지분을 입증한다') };
    for (const q of ['② 입증', '입증', '지분을']) expect(tocSearchText(hang)).toContain(q);
    // 항 줄에는 조 머리가 없다 — "제2조"로 찾으면 조 머리 행이 찾는다(이 작업 전과 같다)
    expect(tocSearchText(hang)).not.toContain('제2조');
  });

  it('조 제목을 되풀이하는 제1항은 제목 대신 본문 앞부분', () => {
    expect(tocArticleLabel({ number: 6, clauseNumber: 1, title: '의결', ...body('첫째 항이다.') }, '의결')).toBe('① 첫째 항이다.');
    expect(tocArticleLabel({ number: 6, clauseNumber: 1, title: '의결', scheduledVersions: [{ content: '시행 예정 본문' }] }, '의결')).toBe('① 시행 예정 본문');
  });
});

describe('조 제목을 제1항에 적어 둔 옛 데이터 (T-211 ①)', () => {
  const hang = (clauseNumber: number, title: string, itemNumber: number | null = null) => ({ number: 5, clauseNumber, itemNumber, title });
  const root = (title: string) => ({ number: 5, clauseNumber: null, itemNumber: null, title });

  it('제1항의 제목이 조 제목과 같으면 되풀이다 — 겉 괄호는 벗기고 견준다', () => {
    expect(hangRepeatsJoTitle(hang(1, '권한'), '권한')).toBe(true);
    expect(hangRepeatsJoTitle(hang(1, ' 권한 '), '권한')).toBe(true);
    expect(hangRepeatsJoTitle(hang(1, '권한'), '(권한)')).toBe(true);
    expect(hangRepeatsJoTitle(hang(1, '(권한)'), '권한')).toBe(true);
  });

  it('부제가 다르거나, 제1항이 아니거나, 목이거나, 조 제목이 없으면 그 행의 부제다', () => {
    expect(hangRepeatsJoTitle(hang(1, '입증'), '권한')).toBe(false);
    expect(hangRepeatsJoTitle(hang(2, '권한'), '권한')).toBe(false);
    expect(hangRepeatsJoTitle(hang(1, '권한', 1), '권한')).toBe(false);
    expect(hangRepeatsJoTitle(hang(1, ''), '')).toBe(false);
    expect(hangRepeatsJoTitle(hang(1, '()'), '()')).toBe(false);
    expect(hangRepeatsJoTitle(root('권한'), '권한')).toBe(false);
  });

  it('조 제목 추정 — 조 머리 행의 제목, 조 머리 행이 없으면 하나뿐인 제1항의 제목', () => {
    expect(inferJoTitle([root('직무'), hang(1, '권한')], 5)).toBe('직무');
    expect(inferJoTitle([hang(1, '권한')], 5)).toBe('권한');
  });

  it('조 머리 행이 있으면 제목이 비어도 항의 제목은 그 항의 부제다 — 조 머리(공식 문서)로 올리지 않는다', () => {
    // 편집기는 조 머리 행이 있는 조에 항을 넣을 때 제목 칸을 '항 부제'로 받는다
    expect(inferJoTitle([root(''), hang(1, '적용 범위')], 5)).toBe('');
  });

  it('제1항이 아닌 항, 항이 둘 이상이거나 목이 있는 조는 항 부제를 조 제목으로 올리지 않는다', () => {
    // 올리면 머리 `제5조(특례)` 아래에 `② 특례`가 또 나온다 — 되풀이로 감추는 것은 제1항뿐이다
    expect(inferJoTitle([hang(2, '특례')], 5)).toBe('');
    expect(inferJoTitle([hang(1, '권한'), hang(2, '')], 5)).toBe('');
    expect(inferJoTitle([hang(1, '권한'), hang(1, '', 1)], 5)).toBe('');
    expect(inferJoTitle([hang(1, '권한')], 6)).toBe('');
  });
});

describe('목차 필터 (T-211)', () => {
  const row = (number: number, clauseNumber: number | null, title: string, content = '') => ({
    id: `${number}-${clauseNumber ?? 0}`,
    number,
    clauseNumber,
    itemNumber: null,
    title,
    versions: content ? [{ content }] : [],
  });
  const ids = (groups: ReturnType<typeof filterTocGroups>) =>
    groups.map((g) => [g.main?.id ?? null, g.hangs.map((h) => h.hang?.id ?? null)]);

  it('보이는 조 머리 그대로 — 조 머리 행이 있으면 그 행만(이 작업 전과 같은 거름)', () => {
    const rows = [row(1, null, '목적', '이 규정은'), row(2, null, '요건'), row(2, 1, '', '첫째'), row(2, 2, '입증', '둘째')];
    expect(ids(filterTocGroups(rows, '제1조(목적)'))).toEqual([['1-0', []]]);
    expect(ids(filterTocGroups(rows, '제2조(요건)'))).toEqual([['2-0', []]]);
    // 맞는 항이 있으면 조 묶음을 남기고 조 머리 행은 그대로 둔다(목차는 조 머리 아래에 맞는 항만 그린다 — 이 작업 전과 같다)
    expect(ids(filterTocGroups(rows, '입증'))).toEqual([['2-0', ['2-2']]]);
    expect(filterTocGroups(rows, '없는말')).toEqual([]);
  });

  it('옛 데이터 — 조 머리 행 없이 제1항만 제목을 가진 조도 목차에 보이는 「제1조(목적)」로 찾는다', () => {
    const rows = [row(1, 1, '목적', '이 규정은'), row(2, null, '요건')];
    expect(ids(filterTocGroups(rows, '제1조(목적)'))).toEqual([[null, ['1-1']]]);
  });

  it('조 머리 행이 있고 제목만 빈 조 — 제1항의 제목은 항 부제로 찾는다(조 머리로 보이지 않으므로 「제1조(목적)」로는 안 찾는다)', () => {
    const rows = [row(1, null, ''), row(1, 1, '목적', '이 규정은')];
    expect(filterTocGroups(rows, '제1조(목적)')).toEqual([]);
    expect(ids(filterTocGroups(rows, '목적'))).toEqual([['1-0', ['1-1']]]);
  });

  it('조 제목은 거르기 전의 행으로 추정한다 — 한 번 걸러진 행을 다시 걸러도 조 제목이 바뀌지 않는다', () => {
    // 조 머리 행 없이 항이 둘 — 조 제목이 없다. 「권한」으로 거르면 제1항만 남는데, 그것만 보고 추정하면 '권한'이 조 제목이 된다
    const all = [row(5, 1, '권한', '첫째 항'), row(5, 2, '', '둘째 항')];
    const filtered = [all[0]];
    expect(filterTocGroups(all, '')[0].joTitle).toBe('');
    expect(filterTocGroups(filtered, '권한', all)[0].joTitle).toBe('');
    expect(filterTocGroups(filtered, '권한')[0].joTitle).toBe('권한'); // titleRows 를 주지 않으면 걸러진 행으로 추정한다
  });

  it('묶음마다 목차가 머리에 적을 조 제목을 싣는다', () => {
    const rows = [row(1, null, '목적'), row(2, 1, '권한', '본문')];
    expect(filterTocGroups(rows, '').map((g) => g.joTitle)).toEqual(['목적', '권한']);
  });

  it('검색어가 비면 거르지 않는다', () => {
    const rows = [row(1, null, '목적')];
    expect(filterTocGroups(rows, '  ')).toHaveLength(1);
  });
});

describe('목차에 그릴 장 — 조 제목은 늘 장 전체 행으로 (T-211)', () => {
  // 조 머리 행은 제1절, 제1항은 절 없음 — 목차는 절별로 나눠 그리므로 '절 없는 행' 묶음에는 조 머리 행이 없다
  const rows = [
    { id: 'r14', number: 14, clauseNumber: null, itemNumber: null, title: '수당', sectionId: 'S' },
    { id: 'h14', number: 14, clauseNumber: 1, itemNumber: null, title: '지급 기준', sectionId: null, versions: [{ content: '지급 본문' }] },
    { id: 'r15', number: 15, clauseNumber: null, itemNumber: null, title: '보칙', sectionId: null },
  ];
  const joTitleWithoutSection = (query: string) => {
    const [chapter] = filterTocChapters([{ title: '총칙', articles: rows }], query);
    const withoutSection = chapter.articles.filter((a) => !a.sectionId);
    return filterTocGroups(withoutSection, query, chapter.allArticles).find((g) => g.jo === 14)?.joTitle;
  };

  it('검색어 없이도, 걸러도 절로 나뉜 조의 조 제목은 조 머리 행의 제목', () => {
    expect(joTitleWithoutSection('')).toBe('수당');
    expect(joTitleWithoutSection('지급 본문')).toBe('수당');
  });

  it('장 제목이 맞으면 장을 통째로, 맞는 행이 없으면 장을 뺀다 — 이 작업 전과 같다', () => {
    const chapters = [{ title: '총칙', articles: rows }, { title: '보수', articles: [rows[2]] }];
    expect(filterTocChapters(chapters, '총칙').map((c) => [c.title, c.articles.length])).toEqual([['총칙', 3]]);
    expect(filterTocChapters(chapters, '없는말')).toEqual([]);
    expect(filterTocChapters(chapters, '보칙').map((c) => [c.title, c.articles.map((a) => a.id), c.allArticles.length])).toEqual([
      ['총칙', ['r15'], 3],
      ['보수', ['r15'], 1],
    ]);
  });
});

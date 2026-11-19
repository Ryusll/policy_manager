import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DefaultPolicyRenderer } from '../apps/web/src/components/policy-template/TemplateRenderer';
import { buildEnterprisePolicyBodyHtml } from '../apps/web/src/components/policy-template/templateUtils';
import { buildFullViewGroups } from '../apps/web/src/lib/fullViewGroups';
import { countFullViewMatches } from '../apps/web/src/lib/fullViewSearch';

/**
 * T-211 전문 보기와 내보내기(인쇄·PDF·한/글) 본문의 조 머리 — `제N조(제목)` 한 줄.
 * 예전에는 번호 줄(`제1조`)과 제목 줄(`목적`)이 갈라져 있었다. 화면(React)과 내보내기(HTML 문자열)는
 * 따로 그리므로 같은 규정을 넣어 조마다 같은 글이 나오는지 함께 본다.
 */
const pub = (content: string) => [{ status: 'published', content }];
const row = (over: Record<string, unknown>) => ({ branchNumber: null, clauseNumber: null, itemNumber: null, title: '', versions: [], ...over });

const groups = buildFullViewGroups([
  {
    id: 'c1',
    number: 1,
    title: '총칙',
    sections: [],
    articles: [
      row({ id: 'a1', number: 1, title: '목적', versions: pub('이 규정은 사무를 정한다.') }),
      row({ id: 'a2', number: 2, versions: pub('제목 없는 조 본문') }),
      row({ id: 'a3', number: 3, branchNumber: 2, title: '정의', versions: pub('가지 조 본문') }),
      // 항을 거느린 조 — 머리 행은 본문 없이 제목만 갖는다
      row({ id: 'a4', number: 4, title: '요건' }),
      row({ id: 'a4-1', number: 4, clauseNumber: 1, versions: pub('첫째 항 본문') }),
      row({ id: 'a4-2', number: 4, clauseNumber: 2, title: '입증', versions: pub('둘째 항 본문') }),
      // 옛 데이터 — 조 머리 행 없이 하나뿐인 항이 조 제목을 갖는다
      row({ id: 'a5-1', number: 5, clauseNumber: 1, title: '권한', versions: pub('옛 조 본문') }),
      // 옛 데이터 — 조 제목을 제1항에도 복제해 두었다
      row({ id: 'a6', number: 6, title: '의결' }),
      row({ id: 'a6-1', number: 6, clauseNumber: 1, title: '의결', versions: pub('복제 조 첫째 항') }),
      row({ id: 'a6-2', number: 6, clauseNumber: 2, versions: pub('복제 조 둘째 항') }),
      // 제목 칸에 괄호까지 적었다
      row({ id: 'a7', number: 7, title: '(보칙)', versions: pub('괄호 제목 조 본문') }),
      // 괄호까지 적은 조 제목을 제1항에는 괄호 없이 복제해 두었다
      row({ id: 'a8', number: 8, title: '(통지)' }),
      row({ id: 'a8-1', number: 8, clauseNumber: 1, title: '통지', versions: pub('통지 첫째 항') }),
      // 제1항이 아닌 항 하나가 부제를 가졌다 — 조 제목으로 올리지 않는다
      row({ id: 'a9-2', number: 9, clauseNumber: 2, title: '특례', versions: pub('둘째 항만 있는 조') }),
    ],
  },
]);

/** 조마다 읽히는 글 — 번호 줄, 부제 줄, 본문 순서 그대로 */
const WANT: [key: string, text: string][] = [
  ['1', '제1조(목적)이 규정은 사무를 정한다.'],
  ['2', '제2조제목 없는 조 본문'],
  ['3-2', '제3조의2(정의)가지 조 본문'],
  ['4', '제4조(요건)① 첫째 항 본문② 입증둘째 항 본문'],
  ['5', '제5조(권한)① 옛 조 본문'],
  ['6', '제6조(의결)① 복제 조 첫째 항② 복제 조 둘째 항'],
  ['7', '제7조(보칙)괄호 제목 조 본문'],
  ['8', '제8조(통지)① 통지 첫째 항'],
  ['9', '제9조② 특례둘째 항만 있는 조'],
];

const textOf = (html: string) => html.replace(/<span class="sr-only">.*?<\/span>/g, '').replace(/<[^>]+>/g, '');
const marks = (html: string) => (html.match(/<mark/g) || []).length;

const renderScreen = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(DefaultPolicyRenderer as any, { fullViewGroups: groups, ...props }));
/** 화면의 조 블록들 — `<article aria-label="…">` 단위 */
const screenBlocks = (html: string) => html.split('<article').slice(1).map((s) => `<article${s.split('</article>')[0]}</article>`);

const exportHtml = (query?: string) => buildEnterprisePolicyBodyHtml(groups, query);
/** 내보내기의 조 블록들 — `tmpl-article-block` 단위 */
const exportBlocks = (html: string) => html.split('<div class="tmpl-article-block').slice(1).map((s) => `<div class="tmpl-article-block${s}`);

describe('전문 보기 화면의 조 머리 (T-211 ①)', () => {
  const blocks = screenBlocks(renderScreen());

  it.each(WANT.map(([key, text], i) => [key, text, i] as const))('조 %s: %s', (_key, text, i) => {
    expect(textOf(blocks[i])).toBe(text);
  });

  it('머리는 h3 한 줄이고 낭독용 이름도 같다', () => {
    expect(blocks[0]).toContain('aria-label="제1조(목적)"');
    expect(blocks[0]).toMatch(/<h3[^>]*>제1조\(목적\)<\/h3>/);
    expect(blocks[1]).toMatch(/<h3[^>]*>제2조<\/h3>/);
    expect(blocks[2]).toMatch(/<h3[^>]*>제3조의2\(정의\)<\/h3>/);
  });

  it('제목이 머리로 올라간 조 머리 행은 빈 줄 상자를 남기지 않는다', () => {
    const rowBoxes = (html: string) => (html.match(/border-l-2/g) || []).length;
    expect(rowBoxes(blocks[0])).toBe(1); // 본문이 있는 조 머리 행
    expect(rowBoxes(blocks[3])).toBe(2); // 제4조: 항 둘뿐(머리 행은 그릴 것이 없다)
    expect(rowBoxes(blocks[5])).toBe(2); // 제6조도
  });

  it('제목을 끈 양식은 번호만 — 항 부제도 그대로 숨긴다', () => {
    const off = screenBlocks(renderScreen({ showArticleTitle: false }));
    expect(textOf(off[0])).toBe('제1조이 규정은 사무를 정한다.');
    expect(off[0]).toContain('aria-label="제1조"');
    expect(textOf(off[3])).toBe('제4조① 첫째 항 본문② 둘째 항 본문');
    expect(textOf(off[4])).toBe('제5조① 옛 조 본문');
  });
});

describe('내보내기 본문 HTML의 조 머리 — 인쇄·PDF·한/글 (T-211 ②)', () => {
  const html = exportHtml();
  const blocks = exportBlocks(html);

  it.each(WANT.map(([key, text], i) => [key, text, i] as const))('조 %s: 화면과 같은 글 — %s', (_key, text, i) => {
    expect(textOf(blocks[i])).toBe(text);
  });

  it('머리 줄(tmpl-article-label) 하나에 번호와 제목이 함께 들어간다', () => {
    expect(html).toContain('<div class="tmpl-article-label">제1조(목적)</div>');
    expect(html).toContain('<div class="tmpl-article-label">제2조</div>');
    expect(html).toContain('<div class="tmpl-article-label">제3조의2(정의)</div>');
    expect(html).toContain('<div class="tmpl-article-label">제7조(보칙)</div>');
  });

  it('조 머리 행은 제목 줄을 따로 내지 않고, 그릴 것이 없으면 빈 행도 남기지 않는다', () => {
    expect(blocks[0]).not.toContain('tmpl-article-head');
    expect(blocks[0]).toContain('tmpl-row-jo'); // 본문이 있는 조 머리 행은 그대로
    expect(blocks[3]).not.toContain('tmpl-row-jo');
    expect(blocks[5]).not.toContain('tmpl-row-jo');
  });

  it('항의 부제 줄은 그대로다', () => {
    expect(blocks[3]).toContain('<div class="tmpl-article-head"><span class="tmpl-article-sub">②</span><span class="tmpl-article-name"> 입증</span></div>');
    // 조 제목을 되풀이한 제1항은 부제 줄 없이 번호를 본문에 붙인다
    expect(blocks[4]).not.toContain('tmpl-article-head');
    expect(blocks[5]).not.toContain('tmpl-article-head');
  });
});

describe('전문 보기 검색 — 한 줄 머리에서도 강조와 개수가 같다 (T-211 ⑥)', () => {
  it.each([
    ['목적', 1], // 조 머리의 제목
    ['의결', 1], // 제1항에 복제된 조 제목은 한 번만 적으므로 한 번만 센다
    ['권한', 1], // 항에서 머리로 올라간 제목
    ['보칙', 1], // 겉 괄호를 벗겨 적은 제목
    ['통지', 2], // 머리의 제목 + 항 본문("통지 첫째 항") — 괄호 없이 복제된 제1항 제목은 세지 않는다
    ['특례', 1], // 제1항이 아닌 항의 부제는 항 줄에 그대로
    ['입증', 1], // 항 부제
    ['본문', 6], // 본문 — 제2·3조의2·7조와 제4조의 두 항, 제5조의 항
    ['없는말', 0],
  ])('"%s" — %d곳', (query, want) => {
    expect(countFullViewMatches(groups, query)).toBe(want);
    expect(marks(renderScreen({ highlightQuery: query }))).toBe(want);
    expect(marks(exportHtml(query))).toBe(want);
  });

  it('검색 중에도 머리는 한 줄로 읽힌다', () => {
    const block = screenBlocks(renderScreen({ highlightQuery: '목적' }))[0];
    expect(textOf(block)).toBe('제1조(목적)이 규정은 사무를 정한다.');
    expect(textOf(exportBlocks(exportHtml('목적'))[0])).toBe('제1조(목적)이 규정은 사무를 정한다.');
  });

  it.each([
    ['조 번호', '제1조', 1],
    ['가지 조 번호', '3조의2', 1],
    ['번호 일부 — 모든 조 머리와 본문의 「조」', '조', null],
    ['괄호는 강조 대상이 아니다', '(목적)', 0],
  ] as const)('%s "%s" — 화면 강조·개수·내보내기 강조가 같다', (_name, query, want) => {
    const count = countFullViewMatches(groups, query);
    expect(marks(renderScreen({ highlightQuery: query }))).toBe(count);
    expect(marks(exportHtml(query))).toBe(count);
    if (want != null) expect(count).toBe(want);
    else expect(count).toBeGreaterThan(9);
  });

  it('검색어가 비면 0', () => {
    expect(countFullViewMatches(groups, '  ')).toBe(0);
  });
});

describe('항을 거느린 조 머리 행 — 자기 글이 있으면 남는다 (T-211 ①)', () => {
  const hangOf = (number: number) => row({ id: `h${number}`, number, clauseNumber: 1, versions: pub('항 본문') });
  const withText = buildFullViewGroups([
    {
      id: 'c2',
      number: 2,
      title: '보칙',
      sections: [],
      articles: [
        row({ id: 'b11', number: 11, title: '시행본', versions: pub('조 머리 본문') }),
        hangOf(11),
        row({ id: 'b12', number: 12, title: '예정', scheduledVersions: [{ id: 's', versionNum: 2, effectiveDate: '2099-03-01', content: '바뀔 본문' }] }),
        hangOf(12),
        row({ id: 'b13', number: 13, title: '초안', pendingVersion: { status: 'draft', content: '초안 본문' } }),
        hangOf(13),
        row({ id: 'b14', number: 14, title: '폐지', currentState: 'repealed', repealedOn: '2025-01-01' }),
        hangOf(14),
        // 견줄 것 — 자기 글이 없는 조 머리 행
        row({ id: 'b15', number: 15, title: '빈 머리' }),
        hangOf(15),
        // 시행일이 아직 안 붙은 시행 예정 판 — 날짜 표시(삭제·시행 예정)는 없어도 화면에는 예정 표시가 있다
        row({ id: 'b16', number: 16, title: '날짜 없음', scheduledVersions: [{ id: 's2', versionNum: 2, content: '날짜 없는 예정 본문' }] }),
        hangOf(16),
      ],
    },
  ]);
  const screen = screenBlocks(renderToStaticMarkup(createElement(DefaultPolicyRenderer as any, { fullViewGroups: withText })));
  const exported = exportBlocks(buildEnterprisePolicyBodyHtml(withText));
  const rowBoxes = (html: string) => (html.match(/border-l-2 border-gray-100/g) || []).length;

  it.each([
    ['시행본', 0, '제11조(시행본)조 머리 본문① 항 본문'],
    ['시행 예정만', 1, '아직 시행 전인 조문입니다.'],
    ['초안만', 2, '초안 본문'],
    ['폐지', 3, '삭제 &lt;2025. 1. 1.&gt;'],
    ['시행일 없는 시행 예정', 5, '날짜 없는 예정 본문'],
  ])('화면: %s — 조 머리 행이 남는다', (_name, i, text) => {
    expect(rowBoxes(screen[i])).toBe(2);
    expect(textOf(screen[i])).toContain(text);
  });

  it('화면: 자기 글이 없는 조 머리 행만 사라진다', () => {
    expect(rowBoxes(screen[4])).toBe(1);
    expect(textOf(screen[4])).toBe('제15조(빈 머리)① 항 본문');
  });

  it('내보내기: 시행본·시행 예정 표시·삭제 표시가 있는 조 머리 행은 남고, 초안뿐이거나 빈 행은 내지 않는다', () => {
    expect(textOf(exported[0])).toBe('제11조(시행본)조 머리 본문① 항 본문');
    expect(textOf(exported[1])).toBe('제12조(예정)2099-03-01 시행 예정① 항 본문');
    expect(exported[2]).not.toContain('tmpl-row-jo');
    expect(textOf(exported[2])).toBe('제13조(초안)① 항 본문');
    expect(textOf(exported[3])).toBe('제14조(폐지)삭제 &lt;2025. 1. 1.&gt;① 항 본문');
    expect(exported[4]).not.toContain('tmpl-row-jo');
  });
});

describe('조 머리 행이 있고 제목만 빈 조 — 제1항의 부제는 조 머리로 올리지 않는다 (T-211 ①)', () => {
  const g = buildFullViewGroups([
    {
      id: 'c3',
      number: 3,
      title: '부칙',
      sections: [],
      articles: [
        row({ id: 'd10', number: 10, title: '', versions: pub('조 본문') }),
        row({ id: 'd10-1', number: 10, clauseNumber: 1, title: '적용 범위', versions: pub('첫째 항 본문') }),
      ],
    },
  ]);

  it('화면·내보내기 — 머리는 번호만, 항 줄에 부제', () => {
    const screen = screenBlocks(renderToStaticMarkup(createElement(DefaultPolicyRenderer as any, { fullViewGroups: g })));
    const exported = exportBlocks(buildEnterprisePolicyBodyHtml(g));
    expect(textOf(screen[0])).toBe('제10조조 본문① 적용 범위첫째 항 본문');
    expect(textOf(exported[0])).toBe('제10조조 본문① 적용 범위첫째 항 본문');
  });

  it('검색 — 항 부제로 찾아도 강조와 개수가 같다', () => {
    expect(countFullViewMatches(g, '적용 범위')).toBe(1);
    expect(marks(renderToStaticMarkup(createElement(DefaultPolicyRenderer as any, { fullViewGroups: g, highlightQuery: '적용 범위' })))).toBe(1);
    expect(marks(buildEnterprisePolicyBodyHtml(g, '적용 범위'))).toBe(1);
  });
});

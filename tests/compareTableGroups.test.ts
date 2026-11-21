import { describe, it, expect } from 'vitest';
import { buildComparisonRows, type CompareArticleInput } from '../apps/api/src/policies/policy-compare';
import {
  compareAddress,
  countChangedJo,
  countMovedOnly,
  currentJoTitles,
  groupComparisonRows,
  type CompareTableGroup,
} from '../apps/web/src/lib/compareTableGroups';
import type { ArticleHeadingSegment } from '../apps/web/src/lib/articleHeading';

/**
 * 신구조문대비표의 조 묶음과 주소 (T-229, SRS POLICY-10).
 *
 * 대표가 본 대비표는 구분 칸에 `1.`·`③`만 있어 어느 조의 개정인지 알 수 없었다. 행은 서버의 맞대기(buildComparisonRows)
 * 그대로 만들어 화면의 묶기에 넘긴다 — 서버의 위치 규칙(신조문 날짜, 삭제 행은 구조문 날짜, movedFrom)과 함께 본다.
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

const table = (before: CompareArticleInput[], after: CompareArticleInput[], hideUnchanged = true) =>
  groupComparisonRows(buildComparisonRows(before, after).rows, hideUnchanged);

const view = (groups: CompareTableGroup[]) =>
  groups.map((g) => ({ heading: g.heading, rows: g.rows.map((r) => `${r.address} ${r.movedOnly ? 'moved' : r.row.kind}`) }));

const text = (segments: ArticleHeadingSegment[] | null) => (segments ? segments.map((s) => s.text).join('') : null);

/** 지금 규정(GET /policies/:id) 꼴 — 장 하나에 조문 행 */
const currentOf = (rows: { id: string; number: number; clauseNumber?: number | null; title?: string; currentState?: string }[]) => ({
  chapters: [{ articles: rows.map((r) => ({ clauseNumber: null, itemNumber: null, title: '', ...r })) }],
});

// 대표 캡처와 같은 경우 — 바뀌지 않은 제12조의 제2항 아래에 목 넷, 제3항이 새로 생겼다
const ceoBefore = [
  art('h11', 11, { title: '위원회', content: '' }),
  art('h12', 12, { title: '감사위원회의 조사', content: '' }),
  art('c1', 12, { clauseNumber: 1 }),
  art('c2', 12, { clauseNumber: 2 }),
];
const ceoAfter = [
  ...ceoBefore,
  ...[1, 2, 3, 4].map((n) => art(`i${n}`, 12, { clauseNumber: 2, itemNumber: n })),
  art('c3', 12, { clauseNumber: 3 }),
];
/** 시점 조회처럼 조 머리 행(본문 없음, 판 없음)이 빠진 행 — 대표 캡처의 실제 모양 */
const withoutHead = (rows: CompareArticleInput[], id = 'h12') => rows.filter((a) => a.id !== id);

describe('신구조문대비표의 조 묶음과 주소 (T-229)', () => {
  it('구분 칸에 어느 조인지까지 적고, 숨긴 조 머리 행 대신 묶음 머리에 제N조(제목)을 적는다', () => {
    expect(view(table(ceoBefore, ceoAfter))).toEqual([
      {
        heading: '제12조(감사위원회의 조사)',
        rows: ['제12조 ② 1. added', '제12조 ② 2. added', '제12조 ② 3. added', '제12조 ② 4. added', '제12조 ③ added'],
      },
    ]);
  });

  it('숨기기를 끄면 조 머리 행과 변동 없는 행도 그 조 묶음에 — 조 머리 행의 칸 제목 줄은 제N조(제목)', () => {
    const groups = table(ceoBefore, ceoAfter, false);
    expect(groups.map((g) => g.heading)).toEqual(['제11조(위원회)', '제12조(감사위원회의 조사)']);
    const head = groups[1].rows[0];
    expect(head.address).toBe('제12조');
    expect([text(head.beforeTitle), text(head.afterTitle)]).toEqual(['제12조(감사위원회의 조사)', '제12조(감사위원회의 조사)']);
    expect(groups[1].rows.map((r) => r.address)).toEqual([
      '제12조', '제12조 ①', '제12조 ②', '제12조 ② 1.', '제12조 ② 2.', '제12조 ② 3.', '제12조 ② 4.', '제12조 ③',
    ]);
  });

  it('요약의 바뀐 조 수는 행 수와 따로 센다 — 신설 다섯 줄이 한 조', () => {
    expect(countChangedJo(table(ceoBefore, ceoAfter))).toBe(1);
    expect(countChangedJo(table(ceoBefore, ceoAfter, false))).toBe(1);
    expect(countChangedJo(table(ceoBefore, ceoBefore, false))).toBe(0);
  });

  it('항 없이 조에 달린 목은 제3조 1., 가지 조문은 제3조의2 ② — 제3조와 제3조의2 는 다른 묶음', () => {
    const before = [art('j3', 3, { title: '용어', content: '' }), art('b3', 3, { branchNumber: 2, title: '(정의)', content: '' })];
    const after = [...before, art('m1', 3, { itemNumber: 1 }), art('b3c2', 3, { branchNumber: 2, clauseNumber: 2 })];
    expect(view(table(before, after))).toEqual([
      { heading: '제3조(용어)', rows: ['제3조 1. added'] },
      { heading: '제3조의2(정의)', rows: ['제3조의2 ② added'] },
    ]);
  });

  it('조 머리 행이 없는 옛 데이터는 하나뿐인 제1항의 제목을 조 제목으로 보고(목차와 같은 판정) 위치로 묶는다', () => {
    const before = [art('p1', 5, { clauseNumber: 1, title: '휴가' }), art('p2', 5, { clauseNumber: 2 })];
    const after = [art('p1', 5, { clauseNumber: 1, title: '휴가', content: '고친 글' })];
    expect(view(table(before, after))).toEqual([
      { heading: '제5조(휴가)', rows: ['제5조 ① changed', '제5조 ② removed'] },
    ]);
  });

  it('조 머리 행이 없는 옛 데이터에서도 통째로 삭제된 옛 조와 같은 번호의 새 조는 섞지 않는다', () => {
    const before = [art('q1', 5, { clauseNumber: 1, title: '옛 휴가' })];
    const after = [art('r1', 5, { clauseNumber: 1, title: '새 출장' })];
    expect(view(table(before, after))).toEqual([
      { heading: '제5조(옛 휴가)', rows: ['제5조 ① removed'] },
      { heading: '제5조(새 출장)', rows: ['제5조 ① added'] },
    ]);
  });

  it('같은 조에서 삭제한 항은 그 조 묶음에 구조문 위치로 든다', () => {
    const before = [...ceoBefore, art('c3', 12, { clauseNumber: 3 })];
    expect(view(table(before, ceoBefore))).toEqual([{ heading: '제12조(감사위원회의 조사)', rows: ['제12조 ③ removed'] }]);
  });

  it('번호가 바뀐 조 — 묶음 머리는 새 번호, 구조문 칸에 그때 위치, 삭제한 항은 같은 번호의 새 조가 아니라 옮겨 간 조에', () => {
    const before = [
      art('h5', 5, { title: '목적', content: '' }),
      art('h5c2', 5, { clauseNumber: 2, content: '옛 둘째' }),
      art('h5c3', 5, { clauseNumber: 3, content: '셋째' }),
    ];
    const after = [
      art('n5', 5, { title: '신설조', content: '새 조' }),
      art('h5', 6, { title: '목적', content: '' }),
      art('h5c2', 6, { clauseNumber: 2, content: '새 둘째' }),
    ];
    const groups = table(before, after);
    // 조 머리 행은 본문·제목이 그대로라도 번호가 바뀌었으니 보인다(번호만 바뀜)
    expect(view(groups)).toEqual([
      { heading: '제5조(신설조)', rows: ['제5조 added'] },
      { heading: '제6조(목적)', rows: ['제6조 moved', '제6조 ② changed', '제5조 ③ removed'] },
    ]);
    expect(groups[1].rows.map((r) => r.beforeAddress)).toEqual([null, '제5조 ②', null]);

    // 조 머리 행은 위치를 칸 제목 줄에 적는다 — 따로 적는 구조문 위치는 없다
    const head = groups[1].rows[0];
    expect([head.address, text(head.beforeTitle), text(head.afterTitle), head.beforeAddress]).toEqual([
      '제6조', '제5조(목적)', '제6조(목적)', null,
    ]);
  });

  it('번호만 바뀐 행은 숨기기를 켜도 보이고 바뀐 조로 센다 — API 는 변동 없음이라 화면이 따로 센다', () => {
    const before = [art('h3', 3, { title: '휴가', content: '' }), art('h3c1', 3, { clauseNumber: 1, content: '연차' })];
    const after = [art('h3', 5, { title: '휴가', content: '' }), art('h3c1', 5, { clauseNumber: 1, content: '연차' })];
    const { rows, summary } = buildComparisonRows(before, after);
    expect(summary).toEqual({ added: 0, removed: 0, changed: 0, same: 2 });
    const groups = groupComparisonRows(rows, true);
    expect(view(groups)).toEqual([{ heading: '제5조(휴가)', rows: ['제5조 moved', '제5조 ① moved'] }]);
    expect(groups[0].rows[1].beforeAddress).toBe('제3조 ①');
    expect(countChangedJo(groups)).toBe(1);
    expect(countMovedOnly(rows)).toBe(2);
    // 자리가 그대로인 변동 없음 행은 여전히 숨는다
    expect(countMovedOnly(buildComparisonRows(ceoBefore, ceoAfter).rows)).toBe(0);
  });

  it('묶음 차례는 머리의 조 번호 — 멀리 옮겨 간 조의 삭제 행이 앞 번호여도 그 조는 제자리에', () => {
    const before = [
      art('h5', 5, { title: '목적', content: '' }),
      art('h5c3', 5, { clauseNumber: 3 }),
      art('h6', 6, { title: '정의', content: '옛' }),
    ];
    const after = [art('h6', 6, { title: '정의', content: '새' }), art('h5', 9, { title: '목적', content: '' })];
    expect(table(before, after).map((g) => g.heading)).toEqual(['제6조(정의)', '제9조(목적)']);
  });

  it('통째로 삭제된 옛 조와 그 번호로 옮겨 온 조는 다른 묶음이다 — 같은 번호면 삭제된 옛 조가 먼저', () => {
    const before = [
      art('d6', 6, { title: '삭제될 조', content: '' }),
      art('d6c1', 6, { clauseNumber: 1, content: '없어질 항' }),
      art('h7', 7, { title: '옮길 조', content: '' }),
      art('h7c1', 7, { clauseNumber: 1, content: '옛 글' }),
    ];
    const after = [art('h7', 6, { title: '옮길 조', content: '' }), art('h7c1', 6, { clauseNumber: 1, content: '새 글' })];
    const groups = table(before, after);
    expect(view(groups)).toEqual([
      { heading: '제6조(삭제될 조)', rows: ['제6조 removed', '제6조 ① removed'] },
      { heading: '제6조(옮길 조)', rows: ['제6조 moved', '제6조 ① changed'] },
    ]);
    expect(groups[1].rows[1].beforeAddress).toBe('제7조 ①');
  });

  it('다른 조에 합쳐진 옛 조의 삭제 행은 이어진 조 묶음의 맨 뒤에 — 머리 조의 항 사이에 끼지 않는다', () => {
    const before = [
      art('h5', 5, { title: '목적', content: '' }),
      art('h5c1', 5, { clauseNumber: 1, content: '하나' }),
      art('h6', 6, { title: '합칠 조', content: '' }),
      art('h6c1', 6, { clauseNumber: 1, content: '둘' }),
    ];
    const after = [
      art('h5', 5, { title: '목적', content: '' }),
      art('h5c1', 5, { clauseNumber: 1, content: '하나' }),
      art('h6c1', 5, { clauseNumber: 2, content: '둘' }),
    ];
    expect(view(table(before, after, false))).toEqual([
      { heading: '제5조(목적)', rows: ['제5조 same', '제5조 ① same', '제5조 ② moved', '제6조 removed'] },
    ]);
  });

  it('조 제목만 바뀐 개정 — 칸 제목 줄이 옛·새 조 머리, 강조는 제목 조각에만, 겉 괄호 한 겹은 벗긴다', () => {
    const groups = table([art('h1', 1, { title: '(목적)', content: 'A' })], [art('h1', 1, { title: '목적 및 범위', content: 'A' })]);
    expect(groups.map((g) => g.heading)).toEqual(['제1조(목적 및 범위)']);
    const r = groups[0].rows[0];
    expect([r.row.kind, r.titleDiffers, text(r.beforeTitle), text(r.afterTitle)]).toEqual([
      'changed', true, '제1조(목적)', '제1조(목적 및 범위)',
    ]);
    expect(r.beforeTitle!.filter((s) => s.part === 'title').map((s) => s.text)).toEqual(['목적']);
    expect(r.beforeTitle![0]).toEqual({ text: '제1조', part: 'number' });
  });

  it('겉 괄호만 다른 조 제목은 같은 제목이라 변동 없음(숨는다), 제목이 없던 조는 번호에 줄을 긋지 않는다', () => {
    const before = [art('h1', 1, { title: '(목적)', content: 'A' })];
    const after = [art('h1', 1, { title: '목적', content: 'A' })];
    expect(table(before, after)).toEqual([]);
    const parens = table(before, after, false)[0].rows[0];
    expect([parens.row.kind, parens.row.titleChanged, parens.titleDiffers, text(parens.beforeTitle), text(parens.afterTitle)]).toEqual([
      'same', false, false, '제1조(목적)', '제1조(목적)',
    ]);
    const added = table([art('h2', 2, { title: '', content: 'A' })], [art('h2', 2, { title: '정의', content: 'A' })])[0].rows[0];
    expect(added.titleDiffers).toBe(true);
    expect(added.beforeTitle).toEqual([{ text: '제2조', part: 'number' }]);
  });

  it('항의 칸 제목 줄은 부제 그대로, 부제가 없으면 없다', () => {
    const groups = table(
      [art('h2', 2, { title: '수당', content: '' }), art('h2c1', 2, { clauseNumber: 1, title: '지급일', content: '옛' })],
      [art('h2', 2, { title: '수당', content: '' }), art('h2c1', 2, { clauseNumber: 1, content: '새' })],
    );
    expect(groups[0].rows.map((r) => [r.address, text(r.beforeTitle), text(r.afterTitle)])).toEqual([['제2조 ①', '지급일', null]]);
  });

  it('바뀐 행이 없으면 묶음이 없고, 행이 없으면 빈 표다', () => {
    expect(table(ceoBefore, ceoBefore)).toEqual([]);
    expect(table([], [])).toEqual([]);
  });

  it('본문 없는 조 머리 행은 판이 없어 대비표 행에 없다 — 그 조의 머리는 지금 규정에서 그 행들이 든 조의 제목으로', () => {
    const rows = buildComparisonRows(withoutHead(ceoBefore), withoutHead(ceoAfter)).rows;
    const current = currentOf([
      { id: 'h12', number: 12, title: '감사위원회의 조사' },
      { id: 'c1', number: 12, clauseNumber: 1 },
      { id: 'c3', number: 12, clauseNumber: 3 },
    ]);
    expect(groupComparisonRows(rows, true, currentJoTitles(current)).map((g) => g.heading)).toEqual([
      '제12조(감사위원회의 조사)',
    ]);
    // 채울 곳이 없으면 번호만
    expect(groupComparisonRows(rows, true).map((g) => g.heading)).toEqual(['제12조']);
    expect(groupComparisonRows(rows, true, currentJoTitles(undefined)).map((g) => g.heading)).toEqual(['제12조']);
  });

  it('지금 규정에서는 번호가 아니라 행으로 조를 찾는다 — 대비 날짜 뒤 번호가 바뀌어도 다른 조의 제목이 붙지 않는다', () => {
    const rows = buildComparisonRows(withoutHead(ceoBefore), withoutHead(ceoAfter)).rows;
    // 지금은 새 제12조가 끼어 옛 제12조가 제13조로 밀렸다
    const shifted = currentOf([
      { id: 'n12', number: 12, title: '끼운 조' },
      { id: 'h12', number: 13, title: '감사위원회의 조사' },
      { id: 'c1', number: 13, clauseNumber: 1 },
      { id: 'c3', number: 13, clauseNumber: 3 },
    ]);
    expect(groupComparisonRows(rows, true, currentJoTitles(shifted)).map((g) => g.heading)).toEqual([
      '제12조(감사위원회의 조사)',
    ]);
    // 묶음의 행이 지금 여러 조에 흩어졌으면 고르지 않는다(번호만)
    const split = currentOf([
      { id: 'a', number: 12, title: '앞 조' },
      { id: 'c1', number: 12, clauseNumber: 1 },
      { id: 'b', number: 14, title: '뒤 조' },
      { id: 'c3', number: 14, clauseNumber: 1 },
    ]);
    expect(groupComparisonRows(rows, true, currentJoTitles(split)).map((g) => g.heading)).toEqual(['제12조']);
  });

  it('조 머리 행이 행에 없으면 지금 규정의 조 제목이 항 부제로 하는 옛 데이터 판정보다 먼저다', () => {
    const before = [art('h7', 7, { title: '진짜 제목', content: '' }), art('h7c1', 7, { clauseNumber: 1, title: '부제', content: '옛' })];
    const after = [before[0], art('h7c1', 7, { clauseNumber: 1, title: '부제', content: '새' })];
    const rows = buildComparisonRows(withoutHead(before, 'h7'), withoutHead(after, 'h7')).rows;
    const current = currentOf([{ id: 'h7', number: 7, title: '진짜 제목' }, { id: 'h7c1', number: 7, clauseNumber: 1, title: '부제' }]);
    expect(groupComparisonRows(rows, true, currentJoTitles(current))[0].heading).toBe('제7조(진짜 제목)');
    // 지금 규정이 없으면 옛 데이터 판정(하나뿐인 제1항의 제목)
    expect(groupComparisonRows(rows, true)[0].heading).toBe('제7조(부제)');
  });

  it('지금 규정으로도 모르면(지금도 조 머리 행이 없고 판정이 빔) 그날 행으로 판정한다 — 대비 날짜 뒤 제2항이 생긴 옛 데이터', () => {
    const before = [art('p1', 5, { clauseNumber: 1, title: '휴가', content: '옛' })];
    const after = [art('p1', 5, { clauseNumber: 1, title: '휴가', content: '새' })];
    const rows = buildComparisonRows(before, after).rows;
    const current = currentOf([{ id: 'p1', number: 5, clauseNumber: 1, title: '휴가' }, { id: 'p2', number: 5, clauseNumber: 2 }]);
    expect(groupComparisonRows(rows, true, currentJoTitles(current))[0].heading).toBe('제5조(휴가)');
  });

  it('대비 날짜 뒤에 다른 조로 합쳐진 조는 지금 규정에서 제목을 고르지 않는다(번호만) — 다른 조의 제목이 붙지 않게', () => {
    const before = [art('a1', 3, { clauseNumber: 1, content: '셋 옛' }), art('b1', 4, { clauseNumber: 1, content: '넷 옛' })];
    const after = [art('a1', 3, { clauseNumber: 1, content: '셋 새' }), art('b1', 4, { clauseNumber: 1, content: '넷 새' })];
    const rows = buildComparisonRows(before, after).rows;
    // 지금은 제4조의 항이 제3조로 합쳐졌다
    const merged = currentOf([
      { id: 'h3', number: 3, title: '정의' },
      { id: 'a1', number: 3, clauseNumber: 1 },
      { id: 'b1', number: 3, clauseNumber: 2 },
    ]);
    expect(groupComparisonRows(rows, true, currentJoTitles(merged)).map((g) => g.heading)).toEqual(['제3조', '제4조']);
  });

  it('지금 규정에 남은 폐지 행(대비의 삭제 행)은 지금 조를 찾거나 다른 묶음을 가리는 데 쓰지 않는다', () => {
    // 옛 제5조(본문 없는 머리)가 제6조로 옮겨지며 ③을 폐지했고, 옛 제6조는 통째로 폐지됐다 — 폐지 행은 지금도 그때 자리에 남는다
    const before = [
      art('o5c1', 5, { clauseNumber: 1, content: '하나' }),
      art('o5c3', 5, { clauseNumber: 3, content: '셋' }),
      art('o6c1', 6, { clauseNumber: 1, content: '폐지될 조' }),
    ];
    const after = [art('o5c1', 6, { clauseNumber: 1, content: '하나 고침' })];
    const rows = buildComparisonRows(before, after).rows;
    const current = currentOf([
      { id: 'o5', number: 6, title: '목적' },
      { id: 'o5c1', number: 6, clauseNumber: 1 },
      { id: 'o5c3', number: 5, clauseNumber: 3, currentState: 'repealed' },
      { id: 'o6c1', number: 6, clauseNumber: 1, currentState: 'repealed' },
    ] as Parameters<typeof currentOf>[0]);
    expect(groupComparisonRows(rows, true, currentJoTitles(current)).map((g) => g.heading)).toEqual(['제6조', '제6조(목적)']);

    // 삭제 행이 그 뒤 다른 조에서 다시 시행돼 지금 살아 있어도, 지금 조는 신조문에 있는 행으로만 찾는다
    const revived = currentOf([
      { id: 'o5', number: 6, title: '목적' },
      { id: 'o5c1', number: 6, clauseNumber: 1 },
      { id: 'o5c3', number: 9, clauseNumber: 1, currentState: 'in_force' },
    ]);
    expect(groupComparisonRows(rows, true, currentJoTitles(revived)).map((g) => g.heading)).toEqual(['제6조', '제6조(목적)']);
  });

  it('조 머리 행이 행에 있으면(제목이 비어도) 지금 규정 제목으로 바꾸지 않고, 통째로 삭제된 옛 조도 채우지 않는다', () => {
    const fallback = () => '지금 제목';
    const blankHead = [art('h4', 4, { title: '', content: '' }), art('h4c1', 4, { clauseNumber: 1, content: '옛' })];
    const changed = [blankHead[0], art('h4c1', 4, { clauseNumber: 1, content: '새' })];
    expect(groupComparisonRows(buildComparisonRows(blankHead, changed).rows, true, fallback)[0].heading).toBe('제4조');

    const gone = buildComparisonRows([art('g8c1', 8, { clauseNumber: 1 })], []).rows;
    expect(groupComparisonRows(gone, true, fallback)[0].heading).toBe('제8조');
  });

  it('규정 간 비교의 위치 칸도 같은 주소 — 두 규정이 같은 번호로 맞대므로 위치는 하나다', () => {
    expect(compareAddress({ number: 3, branchNumber: null, clauseNumber: 2, itemNumber: 1 })).toBe('제3조 ② 1.');
    expect(compareAddress({ number: 3, branchNumber: 1, clauseNumber: null, itemNumber: null })).toBe('제3조의1');
    expect(compareAddress({ number: 3, branchNumber: 0, clauseNumber: 2, itemNumber: null })).toBe('제3조 ②');
    expect(compareAddress({ number: 4, clauseNumber: null, itemNumber: 2 })).toBe('제4조 2.');
  });
});

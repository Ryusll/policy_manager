import { describe, it, expect } from 'vitest';
import {
  contentFingerprint,
  looseText,
  matchReparse,
  normalizeText,
  type MatchItem,
  type ParsedChapter,
  type ParsedRow,
  type StoredChapter,
  type StoredRow,
} from '../apps/api/src/regulation-parse/reparse-match';
import { parsedFromTree } from '../apps/api/src/regulation-parse/reparse-plan';

type Pos = [number, number | null, number | null, number | null];
const P = (index: number, [number, branch, clause, item]: Pos, content: string, title = '', chapterIndex = 0, renumbered = false): ParsedRow => ({
  index,
  nodeId: `n${index}`,
  number,
  branch,
  clause,
  item,
  chapterIndex,
  sectionIndex: null,
  title,
  content,
  renumbered,
});
let order = 0;
const S = (id: string, [number, branch, clause, item]: Pos, content: string | null, title = '', chapterId = 'c1', extra: Partial<StoredRow> = {}): StoredRow => ({
  articleId: id,
  number,
  branch,
  clause,
  item,
  chapterId,
  sectionId: null,
  title,
  base: content == null ? null : { versionId: `v-${id}`, status: 'published', content },
  repealed: false,
  pending: null,
  order: order++,
  ...extra,
});
const PCH: ParsedChapter[] = [{ index: 0, number: 1, title: '본문', hidden: true, sections: [] }];
const SCH: StoredChapter[] = [{ id: 'c1', number: 1, title: '본문', hidden: true, sections: [] }];
const run = (ps: ParsedRow[], ss: StoredRow[], pch = PCH, sch = SCH) => matchReparse(ps, pch, ss, sch);
const byParsed = (items: MatchItem[], i: number) => items.find((x) => x.parsed === i)!;
const missing = (items: MatchItem[]) => items.filter((x) => x.kind === 'missing').map((x) => x.articleId);

describe('normalizeText·looseText·contentFingerprint (도 6 S611)', () => {
  it('줄바꿈·중복 공백·문자 표현만 맞추고 수치·부정·단위·문장 부호는 남긴다', () => {
    expect(normalizeText('  직원은\n  매년 １５일의\t휴가를 받는다 ')).toBe('직원은 매년 15일의 휴가를 받는다');
    expect(normalizeText('인사ㆍ총무')).toBe(normalizeText('인사·총무'));
    expect(normalizeText('“휴가”')).toBe('"휴가"');
    expect(normalizeText('10⁴ m³')).toBe('10⁴ m³'); // NFKC 를 쓰지 않는다 — 104 가 되면 수치가 바뀐다
    expect(normalizeText('주지 않는다')).not.toBe(normalizeText('준다'));
    expect(normalizeText('15일.')).not.toBe(normalizeText('15일'));
  });

  it('띄어쓰기는 후보 비교에서만 빼되, 숫자 사이 공백은 남긴다', () => {
    expect(looseText(normalizeText('운영팀이 관리한 다'))).toBe(looseText(normalizeText('운영팀이 관리한다')));
    expect(looseText('1 2개월')).not.toBe(looseText('12개월'));
    expect(looseText('15 일')).toBe('15일');
  });

  it('지문은 정규화 본문의 SHA-256, 빈 본문은 지문이 없다', () => {
    expect(contentFingerprint(normalizeText('가 나'))).toBe(contentFingerprint(normalizeText('가\n나')));
    expect(contentFingerprint('')).toBeNull();
    expect(contentFingerprint('가')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('matchReparse — 계층·지문 2축 판정 (도 6 S630~S641)', () => {
  it('그대로면 같은 조문, 띄어쓰기만 다른 것도 본문 변경이 아니다', () => {
    const r = run(
      [P(0, [1, null, null, null], '이 규정은 목적을 정한다.', '목적'), P(1, [2, null, null, null], '휴가는 운영팀이 관리한다.')],
      [S('a1', [1, null, null, null], '이 규정은 목적을 정한다.', '목적'), S('a2', [2, null, null, null], '휴가는 운영팀이 관리한 다.')],
    );
    expect(r.items.map((x) => [x.kind, x.articleId])).toEqual([
      ['same', 'a1'],
      ['same', 'a2'],
    ]);
    expect(byParsed(r.items, 1).changes).toMatchObject({ content: false, spacingOnly: true });
  });

  it('숫자 사이 공백이 달라지면 본문 변경이다(1 2 ≠ 12)', () => {
    const r = run([P(0, [1, null, null, null], '휴가는 12개월마다 준다.')], [S('a1', [1, null, null, null], '휴가는 1 2개월마다 준다.')]);
    expect(r.items[0]).toMatchObject({ kind: 'changed', articleId: 'a1', recommended: false });
  });

  it('조가 끼어들어 번호가 밀리면 뒤 조문은 옮김(이웃이 같은 쪽으로 대응돼 추천), 끼어든 조는 새 조문 후보', () => {
    const stored = [
      S('a1', [1, null, null, null], '목적 본문'),
      S('a2', [2, null, null, null], '정의 본문'),
      S('a3', [3, null, null, null], '적용 범위 본문'),
      S('a4', [4, null, null, null], '휴가 본문'),
    ];
    const parsed = [
      P(0, [1, null, null, null], '목적 본문'),
      P(1, [2, null, null, null], '새로 넣은 조 본문'),
      P(2, [3, null, null, null], '정의 본문'),
      P(3, [4, null, null, null], '적용 범위 본문'),
      P(4, [5, null, null, null], '휴가 본문'),
    ];
    const r = run(parsed, stored);
    expect(r.items.map((x) => [x.kind, x.articleId, x.recommended])).toEqual([
      ['same', 'a1', true],
      ['new', null, true],
      ['moved', 'a2', true],
      ['moved', 'a3', true],
      ['moved', 'a4', true],
    ]);
    expect(byParsed(r.items, 2).reasons).toEqual(expect.arrayContaining(['content', 'neighbor']));
    expect(missing(r.items)).toEqual([]);
  });

  it('같은 자리에서 본문이 바뀌면 "개정인지 새 조문인지" 사람이 고른다(추천 없음)', () => {
    const r = run([P(0, [3, null, null, null], '연차휴가는 20일로 한다.')], [S('a3', [3, null, null, null], '연차휴가는 15일로 한다.')]);
    expect(r.items).toEqual([
      expect.objectContaining({ kind: 'changed', articleId: 'a3', recommended: false, reasons: ['position'] }),
    ]);
  });

  it('옮기면서 고쳐진 조문은 자동으로 잇지 않는다 — 새 조문 후보와 원문에 없음으로 남아 사람이 잇는다', () => {
    const stored = [S('a1', [1, null, null, null], 'A'), S('a2', [2, null, null, null], 'B'), S('a3', [3, null, null, null], 'C')];
    const parsed = [P(0, [1, null, null, null], 'A'), P(1, [2, null, null, null], 'X'), P(2, [3, null, null, null], 'B'), P(3, [4, null, null, null], 'C 고침')];
    const r = run(parsed, stored);
    expect(byParsed(r.items, 2)).toMatchObject({ kind: 'moved', articleId: 'a2' });
    expect(byParsed(r.items, 3).kind).toBe('new');
    expect(missing(r.items)).toEqual(['a3']);
  });

  it('같은 본문이 여럿이면 지문만으로 고르지 않는다 — 부모 조가 대응된 쪽이 하나면 그것', () => {
    const stored = [
      S('j1', [1, null, null, null], null, '총칙'),
      S('h11', [1, null, 1, null], '<삭제>'),
      S('h12', [1, null, 2, null], '첫째 조의 둘째 항'),
      S('j2', [2, null, null, null], null, '휴가'),
      S('h21', [2, null, 1, null], '<삭제>'),
      S('h22', [2, null, 2, null], '둘째 조의 둘째 항'),
    ];
    // 제2조가 제3조로 밀렸다(앞에 새 제2조)
    const parsed = [
      P(0, [1, null, null, null], '', '총칙'),
      P(1, [1, null, 1, null], '<삭제>'),
      P(2, [1, null, 2, null], '첫째 조의 둘째 항'),
      P(3, [2, null, null, null], '새 조 본문'),
      P(4, [3, null, null, null], '', '휴가'),
      P(5, [3, null, 1, null], '<삭제>'),
      P(6, [3, null, 2, null], '둘째 조의 둘째 항'),
    ];
    const r = run(parsed, stored);
    expect(byParsed(r.items, 1)).toMatchObject({ kind: 'same', articleId: 'h11' });
    expect(byParsed(r.items, 4)).toMatchObject({ kind: 'moved', articleId: 'j2' });
    expect(byParsed(r.items, 4).reasons).toEqual(expect.arrayContaining(['children', 'empty']));
    expect(byParsed(r.items, 5)).toMatchObject({ kind: 'moved', articleId: 'h21' });
    expect(byParsed(r.items, 5).reasons).toEqual(expect.arrayContaining(['parent']));
    expect(byParsed(r.items, 6)).toMatchObject({ kind: 'moved', articleId: 'h22', recommended: true });
    expect(byParsed(r.items, 3).kind).toBe('new');
  });

  it('부모로도 가를 수 없는 같은 본문은 판정 보류 — 후보를 모두 보여 준다', () => {
    const stored = [S('a1', [1, null, null, null], '<삭제>'), S('a2', [2, null, null, null], '<삭제>')];
    const parsed = [P(0, [7, null, null, null], '<삭제>')];
    const r = run(parsed, stored);
    expect(r.items[0]).toMatchObject({ kind: 'ambiguous', candidates: ['a1', 'a2'] });
    expect(r.items[0].reasons).toEqual(expect.arrayContaining(['duplicate']));
  });

  it('본문만 같고 다른 근거가 없는 먼 이동은 옮김으로 보이되 추천하지 않는다', () => {
    const stored = [S('a1', [1, null, null, null], 'A'), S('a2', [2, null, null, null], 'B'), S('a3', [3, null, null, null], 'C')];
    const parsed = [P(0, [1, null, null, null], 'C'), P(1, [2, null, null, null], 'Y'), P(2, [3, null, null, null], 'Z')];
    const r = run(parsed, stored);
    expect(byParsed(r.items, 0)).toMatchObject({ kind: 'moved', articleId: 'a3', recommended: false });
  });

  it('폐지된 조문은 자동으로 잇지 않고 수동 후보로만 — 원문에 없음에도 넣지 않는다', () => {
    const stored = [S('a1', [1, null, null, null], '폐지된 본문', '', 'c1', { repealed: true })];
    const r = run([P(0, [1, null, null, null], '폐지된 본문')], stored);
    expect(r.items).toEqual([expect.objectContaining({ kind: 'ambiguous', candidates: ['a1'] })]);
    expect(r.items[0].reasons).toEqual(expect.arrayContaining(['repealed']));
  });

  it('조 제목만 바뀌어도 계층 변경(옮김)이고, 원문에 없는 조문은 삭제 확인 대상', () => {
    const r = run([P(0, [1, null, null, null], '본문', '목적과 범위')], [S('a1', [1, null, null, null], '본문', '목적'), S('a2', [2, null, null, null], '없어진 조')]);
    expect(r.items[0]).toMatchObject({ kind: 'moved', articleId: 'a1', recommended: true });
    expect(r.items[0].changes).toMatchObject({ title: true, position: false, content: false });
    expect(missing(r.items)).toEqual(['a2']);
  });

  it('장이 끼어들어 장 번호가 밀려도 조문은 그대로 — 장 단위 변경(번호 바뀜·새 장)으로 묶는다', () => {
    const sch: StoredChapter[] = [
      { id: 'c1', number: 1, title: '총칙', hidden: false, sections: [] },
      { id: 'c2', number: 2, title: '휴가', hidden: false, sections: [] },
    ];
    const pch: ParsedChapter[] = [
      { index: 0, number: 1, title: '총칙', hidden: false, sections: [] },
      { index: 1, number: 2, title: '근무', hidden: false, sections: [] },
      { index: 2, number: 3, title: '휴가', hidden: false, sections: [] },
    ];
    const stored = [S('a1', [1, null, null, null], '목적', '', 'c1'), S('a2', [2, null, null, null], '연차', '', 'c2')];
    const parsed = [P(0, [1, null, null, null], '목적', '', 0), P(1, [2, null, null, null], '연차', '', 2)];
    const r = run(parsed, stored, pch, sch);
    expect(r.items.map((x) => x.kind)).toEqual(['same', 'same']);
    expect(r.chapters).toEqual([
      { parsed: 0, storedId: 'c1', change: 'same' },
      { parsed: 1, storedId: null, change: 'new' },
      { parsed: 2, storedId: 'c2', change: 'renumbered' },
    ]);
  });

  it('다른 장으로 옮긴 조문은 옮김(장 변경)', () => {
    const sch: StoredChapter[] = [
      { id: 'c1', number: 1, title: '총칙', hidden: false, sections: [] },
      { id: 'c2', number: 2, title: '휴가', hidden: false, sections: [] },
    ];
    const pch: ParsedChapter[] = [
      { index: 0, number: 1, title: '총칙', hidden: false, sections: [] },
      { index: 1, number: 2, title: '휴가', hidden: false, sections: [] },
    ];
    const stored = [S('a1', [1, null, null, null], '목적', '', 'c1'), S('a2', [2, null, null, null], '정의', '', 'c1'), S('a3', [3, null, null, null], '연차', '', 'c2')];
    const parsed = [P(0, [1, null, null, null], '목적', '', 0), P(1, [2, null, null, null], '정의', '', 1), P(2, [3, null, null, null], '연차', '', 1)];
    const r = run(parsed, stored, pch, sch);
    expect(byParsed(r.items, 1)).toMatchObject({ kind: 'moved', articleId: 'a2' });
    expect(byParsed(r.items, 1).changes).toMatchObject({ chapter: true, position: false });
  });

  it('번호를 다시 매긴 재파싱 행은 번호로 잇지 않는다', () => {
    const r = run([P(0, [3, null, null, null], '고친 본문', '', 0, true)], [S('a3', [3, null, null, null], '원래 본문')]);
    expect(r.items.map((x) => x.kind)).toEqual(['new', 'missing']);
    expect(r.items[0].reasons).toEqual(['renumbered']);
  });
});

describe('parsedFromTree — 미리보기 트리를 재파싱 행으로', () => {
  const node = (id: string, articleNumber: string, articleTitle: string, content: string, children: any[] = []) => ({
    id,
    articleNumber,
    articleTitle,
    content,
    parentId: null,
    depth: 0,
    pageNumber: null,
    sortOrder: 0,
    children,
  });

  it('노드 id 를 남기고, 원문 번호를 못 쓴 행을 표시한다', () => {
    const { rows, chapters } = parsedFromTree([
      node('n1', 'L1', '목적', '본문', [node('n2', 'C1', '①', '첫 항'), node('n3', 'C3', '③', '셋째 항')]),
      node('n4', 'L1', '중복', '다시 1조'),
    ]);
    expect(rows.map((r) => [r.nodeId, r.number, r.clause, r.renumbered])).toEqual([
      ['n1', 1, null, false],
      ['n2', 1, 1, false],
      ['n3', 1, 3, false],
      ['n4', 2, null, true],
    ]);
    expect(chapters).toEqual([{ index: 0, number: 1, title: '본문', hidden: true, sections: [] }]);
  });
});

describe('matchReparse — 띄어쓰기만 다른 채 옮긴 조문', () => {
  it('같은 번호의 다른 조문과 "본문 변경"으로 묶지 않고, 옮김으로 보이되 추천하지 않는다', () => {
    const stored = [S('a4', [4, null, null, null], '휴가는 3일 전까지 신청한다.'), S('a5', [5, null, null, null], '이 조는 빠진다.')];
    const parsed = [P(0, [5, null, null, null], '휴가는 3일 전까지 신청한 다.')];
    const r = run(parsed, stored);
    expect(r.items[0]).toMatchObject({ kind: 'moved', articleId: 'a4', recommended: false });
    expect(r.items[0].changes).toMatchObject({ content: false, spacingOnly: true, position: true });
    expect(missing(r.items)).toEqual(['a5']);
  });
});

describe('matchReparse — 본문 없는 조 머리 행', () => {
  it('같은 번호의 빈 머리 행끼리 묶지 않고, 하위 항이 따라간 조와 잇는다(앞에 새 조가 끼어든 경우)', () => {
    const stored = [
      S('j2', [2, null, null, null], null, '정의'),
      S('h21', [2, null, 1, null], '"직원"이란 근로자를 말한다.'),
      S('h22', [2, null, 2, null], '"회사"란 이 법인을 말한다.'),
    ];
    const parsed = [
      P(0, [2, null, null, null], '', '적용 범위'),
      P(1, [2, null, 1, null], '모든 직원에게 적용한다.'),
      P(2, [2, null, 2, null], '파견 근로자에게도 적용한다.'),
      P(3, [3, null, null, null], '', '정의'),
      P(4, [3, null, 1, null], '"직원"이란 근로자를 말한다.'),
      P(5, [3, null, 2, null], '"회사"란 이 법인을 말한다.'),
    ];
    const r = run(parsed, stored);
    expect(byParsed(r.items, 3)).toMatchObject({ kind: 'moved', articleId: 'j2' });
    expect(byParsed(r.items, 0).kind).toBe('new');
    expect(byParsed(r.items, 1).kind).toBe('new');
  });
});

describe('matchReparse — 옮긴 조의 바뀐 항', () => {
  it('끼어든 새 조의 같은 번호 항이 먼저 가로채지 않는다 — 대응된 상위 조 안의 같은 항 번호가 먼저', () => {
    const stored = [
      S('j2', [2, null, null, null], null, '정의'),
      S('h21', [2, null, 1, null], '"직원"이란 근로자를 말한다.'),
      S('h22', [2, null, 2, null], '"회사"란 이 법인을 말한다.'),
    ];
    const parsed = [
      P(0, [2, null, null, null], '', '적용 범위'),
      P(1, [2, null, 1, null], '모든 직원에게 적용한다.'),
      P(2, [2, null, 2, null], '파견 근로자에게도 적용한다.'),
      P(3, [3, null, null, null], '', '정의'),
      P(4, [3, null, 1, null], '"직원"이란 근로자를 말한다.'),
      P(5, [3, null, 2, null], '"회사"란 이 법인과 자회사를 말한다.'),
    ];
    const r = run(parsed, stored);
    expect(byParsed(r.items, 5)).toMatchObject({ kind: 'changed', articleId: 'h22' });
    expect(byParsed(r.items, 5).reasons).toEqual(expect.arrayContaining(['parent', 'position']));
    expect(byParsed(r.items, 2).kind).toBe('new');
  });
});

describe('matchReparse — 번호를 믿을 수 없거나 같은 본문이 여럿일 때', () => {
  it('번호를 다시 매긴 행은 같은 번호·같은 본문이라도 그 번호로 확정하지 않는다(같은 본문이 다른 데도 있으면 보류)', () => {
    const stored = [S('a3', [3, null, null, null], '<삭제>'), S('a7', [7, null, null, null], '<삭제>')];
    const r = run([P(0, [3, null, null, null], '<삭제>', '', 0, true)], stored);
    expect(r.items[0]).toMatchObject({ kind: 'ambiguous', candidates: ['a3', 'a7'] });
  });

  it('대응된 조 안에서 항 번호가 밀린 같은 본문은 부모 조로 가른다', () => {
    const stored = [
      S('j1', [1, null, null, null], null, '총칙'),
      S('h11', [1, null, 1, null], '<삭제>'),
      S('h12', [1, null, 2, null], '첫째 조 본문'),
      S('j2', [2, null, null, null], null, '휴가'),
      S('h21', [2, null, 1, null], '<삭제>'),
      S('h22', [2, null, 2, null], '둘째 조 본문'),
    ];
    const parsed = [
      P(0, [1, null, null, null], '', '총칙'),
      P(1, [1, null, 1, null], '새로 넣은 항'),
      P(2, [1, null, 2, null], '<삭제>'),
      P(3, [1, null, 3, null], '첫째 조 본문'),
      P(4, [2, null, null, null], '', '휴가'),
      P(5, [2, null, 1, null], '<삭제>'),
      P(6, [2, null, 2, null], '둘째 조 본문'),
    ];
    const r = run(parsed, stored);
    expect(byParsed(r.items, 2)).toMatchObject({ kind: 'moved', articleId: 'h11', recommended: true });
    expect(byParsed(r.items, 2).reasons).toEqual(expect.arrayContaining(['parent']));
    expect(byParsed(r.items, 1).kind).toBe('new');
    expect(byParsed(r.items, 5)).toMatchObject({ kind: 'same', articleId: 'h21' });
  });
});

describe('matchReparse — 띄어쓰기로만 맺은 짝은 근거가 있어도 추천하지 않는다', () => {
  it('앞 조가 같은 쪽으로 대응돼도 띄어쓰기를 빼야 같은 본문이면 사람이 확인한다', () => {
    const stored = [S('a1', [1, null, null, null], 'A'), S('a2', [2, null, null, null], 'B'), S('a3', [3, null, null, null], '휴가는 3일 전까지 신청한다.')];
    const parsed = [
      P(0, [1, null, null, null], 'A'),
      P(1, [2, null, null, null], '새 조'),
      P(2, [3, null, null, null], 'B'),
      P(3, [4, null, null, null], '휴가는 3일 전까지 신청한 다.'),
    ];
    const r = run(parsed, stored);
    expect(byParsed(r.items, 2)).toMatchObject({ kind: 'moved', articleId: 'a2', recommended: true });
    expect(byParsed(r.items, 3)).toMatchObject({ kind: 'moved', articleId: 'a3', recommended: false });
    expect(byParsed(r.items, 3).reasons).toEqual(expect.arrayContaining(['neighbor', 'spacing']));
  });
});

import { describe, it, expect } from 'vitest';
import {
  buildJoRows,
  moveJo,
  assignChapter,
  renumberPreview,
  hasReorderChanges,
  toReorderPayload,
} from '../apps/web/src/lib/joReorder';

const chapters = [
  {
    id: 'ch1',
    number: 1,
    title: '총칙',
    articles: [
      { number: 1, title: '목적' },
      { number: 1, title: '', clauseNumber: 1 },
      { number: 2, title: '적용범위' },
    ],
  },
  {
    id: 'ch2',
    number: 2,
    title: '운영',
    articles: [{ number: 3, title: '운영원칙' }],
  },
];

describe('buildJoRows', () => {
  it('장 순서 → 조 순서로 평탄한 목록을 만든다', () => {
    const rows = buildJoRows(chapters);
    expect(rows.map((r) => r.jo)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.chapterId)).toEqual(['ch1', 'ch1', 'ch2']);
  });

  it('조 제목은 항·목이 아니라 조 본문 행에서 가져온다', () => {
    // 항 행에도 제목이 들어 있을 수 있어서, 아무 행이나 집으면 엉뚱한 제목이 붙는다
    const rows = buildJoRows([
      {
        id: 'ch1',
        number: 1,
        articles: [
          { number: 1, title: '항 제목', clauseNumber: 1 },
          { number: 1, title: '조 제목' },
        ],
      },
    ]);
    expect(rows[0].title).toBe('조 제목');
  });

  it('빈 입력도 견딘다', () => {
    expect(buildJoRows(undefined)).toEqual([]);
    expect(buildJoRows([])).toEqual([]);
  });
});

describe('moveJo', () => {
  it('아래 조를 맨 위로 끌어 올린다', () => {
    const rows = buildJoRows(chapters);
    const next = moveJo(rows, 2, 0);
    expect(next.map((r) => r.jo)).toEqual([3, 1, 2]);
  });

  /** 장 경계를 넘어 끌면 그 장으로 옮겨진 것으로 본다 — 화면에서 보이는 대로 */
  it('옮겨 간 자리의 장을 따라간다', () => {
    const rows = buildJoRows(chapters);
    const next = moveJo(rows, 0, 2); // 제1조를 제2장 쪽으로
    expect(next[2].jo).toBe(1);
    expect(next[2].chapterId).toBe('ch2');
  });

  it('맨 위로 올리면 아래쪽 이웃의 장을 따른다', () => {
    const rows = buildJoRows(chapters);
    const next = moveJo(rows, 2, 0); // 제3조(제2장)를 맨 위로
    expect(next[0].chapterId).toBe('ch1');
  });

  it('제자리로 옮기면 그대로다', () => {
    const rows = buildJoRows(chapters);
    expect(moveJo(rows, 1, 1)).toBe(rows);
  });

  it('범위 밖 위치는 끝으로 좁힌다', () => {
    const rows = buildJoRows(chapters);
    expect(moveJo(rows, 0, 99).map((r) => r.jo)).toEqual([2, 3, 1]);
    expect(moveJo(rows, 99, 0)).toBe(rows);
  });
});

describe('assignChapter', () => {
  it('순서는 그대로 두고 장만 바꾼다', () => {
    const rows = buildJoRows(chapters);
    const next = assignChapter(rows, 0, {
      chapterId: 'ch2',
      chapterNumber: 2,
      chapterTitle: '운영',
      chapterHidden: false,
    });
    expect(next.map((r) => r.jo)).toEqual([1, 2, 3]);
    expect(next[0].chapterId).toBe('ch2');
  });
});

describe('renumberPreview', () => {
  it('바뀌는 조를 표시한다', () => {
    const rows = moveJo(buildJoRows(chapters), 2, 0);
    expect(renumberPreview(rows)).toEqual([
      { jo: 3, newNumber: 1, moved: true },
      { jo: 1, newNumber: 2, moved: true },
      { jo: 2, newNumber: 3, moved: true },
    ]);
  });

  it('그대로면 아무것도 바뀌지 않는다', () => {
    const preview = renumberPreview(buildJoRows(chapters));
    expect(preview.every((p) => !p.moved)).toBe(true);
  });
});

describe('hasReorderChanges', () => {
  it('순서가 같으면 변경 없음', () => {
    const rows = buildJoRows(chapters);
    expect(hasReorderChanges(rows, [...rows])).toBe(false);
  });

  it('순서가 바뀌면 변경 있음', () => {
    const rows = buildJoRows(chapters);
    expect(hasReorderChanges(rows, moveJo(rows, 0, 2))).toBe(true);
  });

  it('순서는 같고 장만 바뀌어도 변경 있음', () => {
    // 번호는 그대로여도 장 이동은 저장해야 한다
    const rows = buildJoRows(chapters);
    const moved = assignChapter(rows, 0, {
      chapterId: 'ch2',
      chapterNumber: 2,
      chapterTitle: '운영',
      chapterHidden: false,
    });
    expect(hasReorderChanges(rows, moved)).toBe(true);
  });
});

describe('toReorderPayload', () => {
  it('서버가 받는 모양으로 줄인다', () => {
    const rows = moveJo(buildJoRows(chapters), 2, 0);
    expect(toReorderPayload(rows)).toEqual([
      { chapterId: 'ch1', jo: 3 },
      { chapterId: 'ch1', jo: 1 },
      { chapterId: 'ch1', jo: 2 },
    ]);
  });
});

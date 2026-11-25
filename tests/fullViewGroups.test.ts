import { describe, it, expect } from 'vitest';
import {
  buildFullViewGroups,
  collectJoNumbers,
  filterFullViewGroupsByJo,
  joGroupRenderRows,
} from '../apps/web/src/lib/fullViewGroups';

const article = (over: Record<string, any>) => ({
  clauseNumber: null,
  itemNumber: null,
  sectionId: null,
  title: '',
  versions: [{ content: '본문' }],
  ...over,
});

describe('joGroupRenderRows', () => {
  it('조 루트를 한 번만 그린다 (items가 main을 다시 포함해도)', () => {
    const chapters = [
      {
        id: 'c1',
        number: 1,
        title: '총칙',
        sections: [],
        articles: [article({ id: 'a1', number: 1, title: '목적' })],
      },
    ];
    const [chapter] = buildFullViewGroups(chapters);
    const group = chapter.blocks[0].groups[0];

    expect(group.items).toHaveLength(1);
    expect(joGroupRenderRows(group).map((r) => r.article.id)).toEqual(['a1']);
  });

  it('항·목을 깊이대로 편다', () => {
    const chapters = [
      {
        id: 'c1',
        number: 1,
        title: '총칙',
        sections: [],
        articles: [
          article({ id: 'a2', number: 2, title: '정의' }),
          article({ id: 'a2h1', number: 2, clauseNumber: 1 }),
          article({ id: 'a2h1i1', number: 2, clauseNumber: 1, itemNumber: 1 }),
          article({ id: 'a2h2', number: 2, clauseNumber: 2 }),
        ],
      },
    ];
    const [chapter] = buildFullViewGroups(chapters);
    const group = chapter.blocks[0].groups[0];

    expect(joGroupRenderRows(group).map((r) => [r.article.id, r.depth])).toEqual([
      ['a2', 0],
      ['a2h1', 1],
      ['a2h1i1', 2],
      ['a2h2', 1],
    ]);
  });

  it('구조 필드 없이 items만 넘기는 호출자도 지원한다', () => {
    const rows = joGroupRenderRows({
      articleNumber: 1,
      items: [{ id: 'x1', number: 1, title: '목적' }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].depth).toBe(0);
  });
});

describe('buildFullViewGroups — 절(節) 순서', () => {
  // 절에 속한 조와 아닌 조가 섞여도 조 번호는 문서 전체에서 오름차순이어야 한다.
  const chapters = [
    {
      id: 'c2',
      number: 2,
      title: '보안 운영',
      sections: [
        { id: 's1', number: 1, title: '접근통제' },
        { id: 's2', number: 2, title: '사고대응' },
      ],
      articles: [
        article({ id: 'a3', number: 3, sectionId: 's1' }),
        article({ id: 'a4', number: 4 }),
        article({ id: 'a5', number: 5, sectionId: 's2' }),
        article({ id: 'a5h1', number: 5, sectionId: 's2', clauseNumber: 1 }),
        article({ id: 'a6', number: 6, sectionId: 's2' }),
        article({ id: 'a7', number: 7 }),
      ],
    },
  ];

  it('조 번호가 역전되지 않는다', () => {
    const [chapter] = buildFullViewGroups(chapters);
    const order: number[] = [];
    for (const block of chapter.blocks) {
      for (const group of block.groups) order.push(group.articleNumber);
    }
    expect(order).toEqual([3, 4, 5, 6, 7]);
  });

  it('절 헤더가 그 절의 첫 조 앞에 열린다', () => {
    const [chapter] = buildFullViewGroups(chapters);
    const shape = chapter.blocks.map((b: any) =>
      b.kind === 'section'
        ? `절${b.number}:${b.groups.map((g: any) => g.articleNumber).join(',')}`
        : `직속:${b.groups.map((g: any) => g.articleNumber).join(',')}`,
    );
    expect(shape).toEqual(['절1:3', '직속:4', '절2:5,6', '직속:7']);
  });

  it('allGroups는 절 소속 조문까지 포함한다 (txt 내보내기·검색 집계용)', () => {
    const [chapter] = buildFullViewGroups(chapters);
    expect(chapter.allGroups.map((g: any) => g.articleNumber)).toEqual([3, 4, 5, 6, 7]);
    const rowCount = chapter.allGroups.reduce((n: number, g: any) => n + g.items.length, 0);
    expect(rowCount).toBe(6); // 조 5건 + 항 1건
  });
});

describe('빈 장(章) 처리', () => {
  it('조문 없는 장은 blocks가 비어 있다 (렌더러가 건너뛸 수 있도록)', () => {
    const chapters = [
      { id: 'c1', number: 1, title: '총칙', sections: [], articles: [article({ id: 'a1', number: 1 })] },
      { id: 'c2', number: 2, title: '', sections: [], articles: [] },
      { id: 'c3', number: 3, title: '보안', sections: [], articles: [article({ id: 'a2', number: 2 })] },
    ];
    const built = buildFullViewGroups(chapters);
    const hasContent = (ch: any) => (ch.blocks || []).some((b: any) => (b.groups?.length ?? 0) > 0);
    expect(built.map(hasContent)).toEqual([true, false, true]);
  });
});

describe('filterFullViewGroupsByJo — 선택 조문 인쇄 (T-74)', () => {
  const chapters = [
    {
      id: 'c1',
      number: 1,
      title: '총칙',
      sections: [],
      articles: [
        article({ id: 'a1', number: 1, title: '목적' }),
        article({ id: 'a2', number: 2, title: '정의' }),
        article({ id: 'a3', number: 3, title: '적용' }),
      ],
    },
  ];

  it('선택이 비어 있으면 원본 그대로 (전체 인쇄)', () => {
    const built = buildFullViewGroups(chapters);
    expect(filterFullViewGroupsByJo(built, new Set())).toBe(built);
  });

  it('고른 조만 남긴다', () => {
    const built = buildFullViewGroups(chapters);
    const out = filterFullViewGroupsByJo(built, new Set([1, 3]));
    expect(out[0].allGroups.map((g: any) => g.articleNumber)).toEqual([1, 3]);
    expect(out[0].blocks[0].groups.map((g: any) => g.articleNumber)).toEqual([1, 3]);
  });

  it('조문이 안 남은 장은 통째로 뺀다', () => {
    // 빈 장 제목만 인쇄되면 무엇을 뽑은 건지 알아볼 수 없다.
    const two = [
      ...chapters,
      { id: 'c2', number: 2, title: '운영', sections: [], articles: [article({ id: 'b1', number: 9 })] },
    ];
    const out = filterFullViewGroupsByJo(buildFullViewGroups(two), new Set([1]));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('c1');
  });

  it('collectJoNumbers 는 조 번호를 정렬해 돌려준다', () => {
    expect(collectJoNumbers(buildFullViewGroups(chapters))).toEqual([1, 2, 3]);
  });
});

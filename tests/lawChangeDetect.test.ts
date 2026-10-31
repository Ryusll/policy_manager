import { describe, it, expect } from 'vitest';
import { detectLawArticleChanges, type ExistingLawArticleSnapshot } from '../apps/api/src/laws/law-change-detect';
import { lawVersionKey } from '../apps/api/src/laws/law-version-key';

function existing(nodeKey: string, content: string, lawArticleId = `id-${nodeKey}`): ExistingLawArticleSnapshot {
  return { lawArticleId, nodeKey, content, versionKey: lawVersionKey(content) };
}

function incoming(nodeKey: string, content: string) {
  return { nodeKey, content, versionKey: lawVersionKey(content) };
}

describe('detectLawArticleChanges (T-103)', () => {
  it('내용이 동일하면 이벤트를 만들지 않는다', () => {
    const before = [existing('60//', '연차 유급휴가를 준다.')];
    const after = [incoming('60//', '연차 유급휴가를 준다.')];
    const ids = new Map([['60//', before[0].lawArticleId]]);

    expect(detectLawArticleChanges(before, after, ids)).toEqual([]);
  });

  it('공백·개행만 다르면 이벤트를 만들지 않는다 (versionKey 정규화가 흡수)', () => {
    const before = [existing('60//', '연차   유급휴가를\n준다.')];
    const after = [incoming('60//', '연차 유급휴가를 준다.')];
    const ids = new Map([['60//', before[0].lawArticleId]]);

    expect(detectLawArticleChanges(before, after, ids)).toEqual([]);
  });

  it('실제로 내용이 바뀌면 modified 이벤트 — 전후 본문·지문을 모두 담는다', () => {
    const before = [existing('60//', '15일의 유급휴가를 준다.', 'la-1')];
    const after = [incoming('60//', '11일의 유급휴가를 준다.')];
    const ids = new Map([['60//', 'la-1']]);

    const changes = detectLawArticleChanges(before, after, ids);
    expect(changes).toEqual([
      {
        type: 'modified',
        nodeKey: '60//',
        lawArticleId: 'la-1',
        before: before[0],
        after: after[0],
      },
    ]);
  });

  it('이전에 없던 nodeKey 는 created 이벤트 — beforeContent 가 없다', () => {
    const before = [existing('60//', '연차 유급휴가를 준다.', 'la-60')];
    const after = [incoming('60//', '연차 유급휴가를 준다.'), incoming('60의2//', '제60조의2 신설 조문')];
    const ids = new Map([
      ['60//', 'la-60'],
      ['60의2//', 'la-new'],
    ]);

    const changes = detectLawArticleChanges(before, after, ids);
    expect(changes).toEqual([
      { type: 'created', nodeKey: '60의2//', lawArticleId: 'la-new', after: after[1] },
    ]);
  });

  it('최초 등록(이전 스냅샷이 비어 있음)은 이벤트를 만들지 않는다 — 조문 수만큼 created 가 쏟아지면 안 된다', () => {
    const after = [incoming('1//', '제1조'), incoming('2//', '제2조'), incoming('3//', '제3조')];
    const ids = new Map([
      ['1//', 'la-1'],
      ['2//', 'la-2'],
      ['3//', 'la-3'],
    ]);

    expect(detectLawArticleChanges([], after, ids)).toEqual([]);
  });

  it('이번 응답에 없는 nodeKey 는 deleted 이벤트 — afterContent 가 없다', () => {
    const before = [existing('61//', '제61조 (삭제 예정 조문)', 'la-old')];
    const after: ReturnType<typeof incoming>[] = [];
    const ids = new Map<string, string>();

    const changes = detectLawArticleChanges(before, after, ids);
    expect(changes).toEqual([{ type: 'deleted', nodeKey: '61//', lawArticleId: 'la-old', before: before[0] }]);
  });

  it('신설·변경·삭제·무변경이 한 번의 재등록에 섞여도 각각 맞게 분류한다', () => {
    const before = [
      existing('58//', '변경 없음', 'la-58'),
      existing('59//', '이전 본문', 'la-59'),
      existing('60//', '삭제될 조문', 'la-60'),
    ];
    const after = [
      incoming('58//', '변경 없음'),
      incoming('59//', '바뀐 본문'),
      incoming('61//', '새로 생긴 조문'),
    ];
    const ids = new Map([
      ['58//', 'la-58'],
      ['59//', 'la-59'],
      ['61//', 'la-61'],
    ]);

    const changes = detectLawArticleChanges(before, after, ids);
    const byType = Object.fromEntries(changes.map((c) => [c.nodeKey, c.type]));
    expect(byType).toEqual({ '59//': 'modified', '61//': 'created', '60//': 'deleted' });
    expect(changes).toHaveLength(3);
  });

  it('articleIdByNodeKey 에 없는 incoming 행은 호출 쪽 실수 — 던진다', () => {
    const before = [existing('60//', '본문')];
    const after = [incoming('60//', '본문')];
    expect(() => detectLawArticleChanges(before, after, new Map())).toThrow();
  });
});

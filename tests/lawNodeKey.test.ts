import { describe, it, expect } from 'vitest';
import {
  closestPerArticle,
  descendantPrefix,
  nodeKeyDepth,
  selfAndAncestorNodeKeys,
} from '../apps/api/src/laws/law-node-key';

/**
 * 법령조항 nodeKey 의 위아래 (T-148).
 *
 * 인용 자동 찾기는 '제60조'를 조 머리 행(60//)에 잇는데, 항이 여럿인 조는 머리 행 본문이 비어 있어
 * 항 개정 이벤트가 항(60/1/)에만 생긴다. 영향을 볼 때 "바뀐 조항과 그 위 조항"을 함께 봐야
 * 조 단위로 건 연결이 실제 개정을 받는다.
 */
describe('T-148 법령조항 위아래', () => {
  it('자신과 상위 조항을 가까운 것부터 돌려준다', () => {
    expect(selfAndAncestorNodeKeys('60//')).toEqual(['60//']);
    expect(selfAndAncestorNodeKeys('60/1/')).toEqual(['60/1/', '60//']);
    expect(selfAndAncestorNodeKeys('60/1/3')).toEqual(['60/1/3', '60/1/', '60//']);
    // 항 없이 조 바로 아래의 호
    expect(selfAndAncestorNodeKeys('60//3')).toEqual(['60//3', '60//']);
    // 가지번호는 조·호 모두 살린다
    expect(selfAndAncestorNodeKeys('3의2/1/1의2')).toEqual(['3의2/1/1의2', '3의2/1/', '3의2//']);
  });

  it('형식이 어긋난 nodeKey 는 자신만 — 엉뚱한 조항으로 넓히지 않는다', () => {
    expect(selfAndAncestorNodeKeys('엉뚱한값')).toEqual(['엉뚱한값']);
    expect(selfAndAncestorNodeKeys('60/1')).toEqual(['60/1']);
    expect(selfAndAncestorNodeKeys('')).toEqual(['']);
  });

  it('아래 조항을 가리는 머리말은 다른 조·항을 덮지 않는다', () => {
    expect(descendantPrefix('60//')).toBe('60/');
    expect(descendantPrefix('60/1/')).toBe('60/1/');
    // 호 아래에는 행이 없다(목은 호 본문에 합친다)
    expect(descendantPrefix('60/1/3')).toBeNull();
    expect(descendantPrefix('60//3')).toBeNull();
    expect(descendantPrefix('엉뚱한값')).toBeNull();

    const jo = descendantPrefix('60//')!;
    expect(['60//', '60/1/', '60/1/3', '60//3'].every((k) => k.startsWith(jo))).toBe(true);
    // 제600조·제60조의2 는 다른 조다
    expect('600//'.startsWith(jo)).toBe(false);
    expect('60의2//'.startsWith(jo)).toBe(false);
    // 제1항의 머리말이 제10항을 덮으면 안 된다
    expect('60/10/'.startsWith(descendantPrefix('60/1/')!)).toBe(false);
  });

  it('단계 — 조 0, 항 1, 호 2(항 없는 호도 2)', () => {
    expect(nodeKeyDepth('60//')).toBe(0);
    expect(nodeKeyDepth('60/1/')).toBe(1);
    expect(nodeKeyDepth('60/1/3')).toBe(2);
    expect(nodeKeyDepth('60//3')).toBe(2);
  });

  it('조문마다 바뀐 조항에 가장 가까운 연결 하나만 남긴다', () => {
    const links = [
      { id: 'jo', articleId: 'A', nodeKey: '60//' },
      { id: 'hang', articleId: 'A', nodeKey: '60/1/' },
      { id: 'jo-b', articleId: 'B', nodeKey: '60//' },
    ];
    expect(closestPerArticle(links).map((l) => l.id).sort()).toEqual(['hang', 'jo-b']);
    // 들어온 순서와 상관없이 같다
    expect(closestPerArticle([...links].reverse()).map((l) => l.id).sort()).toEqual(['hang', 'jo-b']);
    expect(closestPerArticle([])).toEqual([]);
  });
});

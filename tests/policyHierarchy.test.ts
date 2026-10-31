import { describe, it, expect } from 'vitest';
import {
  buildPolicyForest,
  countForest,
} from '../apps/api/src/policies/policy-hierarchy';

const p = (id: string, parentId: string | null = null) => ({ id, parentId });
const ids = (nodes: ReturnType<typeof buildPolicyForest>) => nodes.map((n) => n.id).sort();

describe('buildPolicyForest — 규정 체계도', () => {
  it('규정 > 세칙 > 지침 3단을 엮는다', () => {
    const roots = buildPolicyForest([p('규정'), p('세칙', '규정'), p('지침', '세칙')]);
    expect(roots.map((r) => r.id)).toEqual(['규정']);
    expect(roots[0].children.map((c) => c.id)).toEqual(['세칙']);
    expect(roots[0].children[0].children.map((c) => c.id)).toEqual(['지침']);
  });

  it('상위가 없는 규정은 최상위가 된다', () => {
    const roots = buildPolicyForest([p('a'), p('b')]);
    expect(ids(roots)).toEqual(['a', 'b']);
  });

  it('상위가 목록에 없으면 숨기지 않고 최상위로 올린다', () => {
    // 상위가 지워졌거나 다른 테넌트인 경우. 안 올리면 화면에서 사라진다.
    const roots = buildPolicyForest([p('고아', '없는id')]);
    expect(ids(roots)).toEqual(['고아']);
  });

  it('자기 자신을 상위로 가져도 사라지지 않는다', () => {
    const roots = buildPolicyForest([p('자기', '자기')]);
    expect(ids(roots)).toEqual(['자기']);
  });

  it('순환(A→B→A)에 든 규정을 삼키지 않는다', () => {
    // 링크만 걸면 A·B 둘 다 어느 루트에도 안 걸려 통째로 사라진다.
    const rows = [p('A', 'B'), p('B', 'A'), p('정상')];
    const roots = buildPolicyForest(rows);
    expect(countForest(roots)).toBe(rows.length);
    expect(ids(roots)).toEqual(['A', 'B', '정상']);
  });

  it('긴 순환(A→B→C→A)도 마찬가지다', () => {
    const rows = [p('A', 'C'), p('B', 'A'), p('C', 'B')];
    expect(countForest(buildPolicyForest(rows))).toBe(rows.length);
  });

  it('어떤 입력이든 노드를 잃지 않는다', () => {
    const rows = [p('r'), p('c1', 'r'), p('c2', 'r'), p('g', 'c1'), p('orphan', 'gone'), p('self', 'self')];
    expect(countForest(buildPolicyForest(rows))).toBe(rows.length);
  });

  it('빈 목록은 빈 트리', () => {
    expect(buildPolicyForest([])).toEqual([]);
  });
});

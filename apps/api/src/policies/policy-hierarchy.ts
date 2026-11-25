/**
 * 규정 체계도 조립 (T-71).
 *
 * 평면 목록을 상위·하위 트리로 엮는다. DB 조회와 분리해 둔 이유는 여기가
 * 조용히 데이터를 감출 수 있는 자리이기 때문이다 — 링크만 걸면 순환(A→B→A)에 든
 * 규정은 어느 루트에도 안 걸려 **화면에서 통째로 사라진다.**
 */

export type HierarchyInput = {
  id: string;
  parentId: string | null;
};

export type HierarchyNode<T extends HierarchyInput> = T & { children: HierarchyNode<T>[] };

/**
 * 최상위 목록을 만든다. 다음은 전부 최상위로 올린다(숨기지 않는다):
 * - `parentId`가 없는 규정
 * - 상위가 이 목록에 없는 규정 (다른 테넌트이거나 지워진 경우)
 * - 자기 자신을 상위로 가진 규정
 * - 순환에 든 규정
 */
export function buildPolicyForest<T extends HierarchyInput>(rows: T[]): HierarchyNode<T>[] {
  const byId = new Map<string, HierarchyNode<T>>(
    rows.map((row) => [row.id, { ...row, children: [] as HierarchyNode<T>[] }]),
  );

  /** 조상을 거슬러 올라가 순환에 들었는지 본다 */
  const inCycle = (start: HierarchyNode<T>): boolean => {
    const seen = new Set<string>([start.id]);
    let cursor = start.parentId ? byId.get(start.parentId) : undefined;
    while (cursor) {
      if (seen.has(cursor.id)) return true;
      seen.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return false;
  };

  const roots: HierarchyNode<T>[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (!parent || parent.id === node.id || inCycle(node)) {
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }
  return roots;
}

/** 트리에 담긴 노드 수 (조립 과정에서 유실이 없었는지 확인용) */
export function countForest<T extends HierarchyInput>(roots: HierarchyNode<T>[]): number {
  let n = 0;
  const walk = (nodes: HierarchyNode<T>[]) => {
    for (const node of nodes) {
      n += 1;
      walk(node.children);
    }
  };
  walk(roots);
  return n;
}

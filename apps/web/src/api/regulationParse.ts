import client from './client';

/** 파싱 트리 노드 — 서버 `regulation-tree.builder.ts`의 `RegulationArticleNode`와 같은 모양 */
export type ParseTreeNode = {
  id: string;
  articleNumber: string;
  articleTitle: string;
  content: string;
  parentId: string | null;
  depth: number;
  pageNumber: number | null;
  sortOrder: number;
  children?: ParseTreeNode[];
};

export type ParseSession = {
  id: string;
  fileName: string;
  mimeType: string | null;
  /** pending | processing | ready | failed */
  status: string;
  extractedText: string | null;
  extractMeta: Record<string, any> | null;
  parseTree: { roots?: ParseTreeNode[] } | null;
  errorMessage: string | null;
  committedPolicyId: string | null;
  createdAt: string;
};

/** 커밋 응답 — 서버는 만들어진 규정의 id를 `policyId`로 돌려준다(`id` 아님) */
export type CommitResult = {
  policyId: string;
  sessionId: string;
  articleCount: number;
};

export const regulationParseApi = {
  upload: (file: File): Promise<ParseSession> => {
    const form = new FormData();
    form.append('file', file);
    return client
      .post('/regulation-parse/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
  get: (id: string): Promise<ParseSession> =>
    client.get('/regulation-parse/' + id).then((r) => r.data),
  updateTree: (id: string, roots: ParseTreeNode[]): Promise<ParseSession> =>
    client.patch('/regulation-parse/' + id + '/tree', { roots }).then((r) => r.data),
  commit: (
    id: string,
    data: { code: string; title: string; description?: string },
  ): Promise<CommitResult> =>
    client.post('/regulation-parse/' + id + '/commit', data).then((r) => r.data),
};

/** 트리를 평탄화 (미리보기 목록·개수 집계용) */
export function flattenParseTree(roots: ParseTreeNode[] | undefined | null): ParseTreeNode[] {
  const out: ParseTreeNode[] = [];
  const walk = (nodes: ParseTreeNode[]) => {
    for (const node of nodes) {
      out.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(roots || []);
  return out;
}

/** 트리에서 노드 1건을 교체한 새 트리를 만든다 (원본 불변) */
export function replaceParseNode(
  roots: ParseTreeNode[],
  nodeId: string,
  patch: Partial<ParseTreeNode>,
): ParseTreeNode[] {
  return roots.map((node) => {
    if (node.id === nodeId) return { ...node, ...patch };
    if (node.children?.length) {
      return { ...node, children: replaceParseNode(node.children, nodeId, patch) };
    }
    return node;
  });
}

/** 트리에서 노드 1건(과 그 하위)을 제거한 새 트리를 만든다 */
export function removeParseNode(roots: ParseTreeNode[], nodeId: string): ParseTreeNode[] {
  return roots
    .filter((node) => node.id !== nodeId)
    .map((node) =>
      node.children?.length ? { ...node, children: removeParseNode(node.children, nodeId) } : node,
    );
}

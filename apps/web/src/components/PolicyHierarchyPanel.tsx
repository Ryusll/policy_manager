/**
 * 규정 체계도 (T-71) — 규정 > 세칙 > 지침 관계를 보고 그 자리에서 바꾼다.
 *
 * 상위 지정을 규정 상세의 설정에 숨기지 않고 체계도 화면에 둔 이유는, 체계는 보통
 * 한 건씩이 아니라 전체를 놓고 한 번에 정리하기 때문이다.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Network, CornerDownRight } from 'lucide-react';
import { clsx } from 'clsx';
import { policiesApi, type PolicyTreeNode } from '../api/policies';
import { LoadingBlock } from '../components/ui/LoadingBlock';
import { EmptyState } from '../components/ui/EmptyState';
import { toast } from '../stores/toastStore';

/** 트리를 화면 순서대로 편다(들여쓰기 깊이를 함께 들고 나온다) */
function flatten(nodes: PolicyTreeNode[], depth = 0): { node: PolicyTreeNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)]);
}

/** 자기 자신과 모든 하위 — 상위 후보에서 빼야 순환이 안 생긴다 */
function selfAndDescendants(node: PolicyTreeNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: PolicyTreeNode) => {
    out.add(n.id);
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

export function PolicyHierarchyPanel({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['policies', 'hierarchy'],
    queryFn: policiesApi.hierarchy,
  });

  const rows = useMemo(() => flatten(data?.roots || []), [data]);

  const setParent = useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) =>
      policiesApi.update(id, { parentId }),
    onMutate: ({ id }) => setSavingId(id),
    onSettled: () => setSavingId(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policies'] });
      toast('체계를 저장했습니다.', 'success');
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message?.toString() || '체계를 저장하지 못했습니다.', 'error');
    },
  });

  if (isLoading) return <LoadingBlock label="체계도를 불러오는 중" />;

  if (!rows.length) {
    return (
      <EmptyState
        title="등록된 규정이 없습니다"
        description="규정을 먼저 등록하면 상·하위 체계를 지정할 수 있습니다."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 px-1">
        상위 규정을 지정해 <b>규정 &gt; 세칙 &gt; 지침</b> 체계를 만듭니다. 상위가 지워진 규정은
        최상위로 올라옵니다.
      </p>

      <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden bg-white">
        {rows.map(({ node, depth }) => {
          const blocked = selfAndDescendants(node);
          return (
            <li
              key={node.id}
              className="flex flex-wrap items-center gap-2 px-3 py-2.5 hover:bg-gray-50/70"
            >
              <div
                className="flex items-center gap-1.5 min-w-0 flex-1"
                style={{ paddingLeft: `${Math.min(depth, 6) * 20}px` }}
              >
                {depth > 0 ? (
                  <CornerDownRight size={13} className="text-gray-300 flex-none" aria-hidden />
                ) : (
                  <Network size={13} className="text-navy-500 flex-none" aria-hidden />
                )}
                <Link
                  to={`/policies/${node.id}`}
                  className="text-sm font-medium text-gray-900 hover:text-navy-700 truncate"
                >
                  {node.title}
                </Link>
                <span className="text-[11px] text-gray-400 font-mono flex-none">{node.code}</span>
                {!node.isActive && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200 flex-none">
                    비활성
                  </span>
                )}
              </div>

              {canEdit && (
                <label className="flex items-center gap-1.5 flex-none">
                  <span className="text-[11px] text-gray-500">상위</span>
                  <select
                    className={clsx('input text-xs w-auto max-w-[220px]', savingId === node.id && 'opacity-60')}
                    value={node.parentId ?? ''}
                    disabled={savingId === node.id}
                    onChange={(e) =>
                      setParent.mutate({ id: node.id, parentId: e.target.value || null })
                    }
                  >
                    <option value="">— 최상위 —</option>
                    {rows
                      .filter(({ node: other }) => !blocked.has(other.id))
                      .map(({ node: other }) => (
                        <option key={other.id} value={other.id}>
                          {other.title}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

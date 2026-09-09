/**
 * 즐겨찾기 목록 (T-80) — 담아둔 규정·조문을 한 곳에서 본다.
 *
 * 조문 즐겨찾기는 T-73 안정 링크로 이동한다. 조문 UUID로 걸면 규정을 다시
 * 가져왔을 때 목록이 통째로 죽는다.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Star, FileText, BookOpen, X } from 'lucide-react';
import { favoritesApi, type Favorite } from '../api/favorites';
import { formatArticleAnchor } from '../lib/articleAnchor';
import { LoadingBlock } from './ui/LoadingBlock';
import { EmptyState } from './ui/EmptyState';
import { toast } from '../stores/toastStore';

function targetHref(fav: Favorite): string {
  if (!fav.article) return `/policies/${fav.policyId}`;
  return `/policies/${fav.policyId}#${formatArticleAnchor(fav.article)}`;
}

function targetLabel(fav: Favorite): string {
  if (!fav.article) return fav.policy.title;
  const anchor = formatArticleAnchor(fav.article);
  return fav.article.title ? `${anchor} ${fav.article.title}` : anchor;
}

export function FavoritesPanel() {
  const qc = useQueryClient();
  const { data: favorites = [], isLoading } = useQuery({
    queryKey: ['favorites'],
    queryFn: favoritesApi.list,
  });

  const remove = useMutation({
    mutationFn: (id: string) => favoritesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['favorites'] });
      qc.invalidateQueries({ queryKey: ['favorite'] });
      toast('즐겨찾기에서 뺐습니다.', 'success');
    },
  });

  if (isLoading) return <LoadingBlock label="즐겨찾기를 불러오는 중" />;

  if (!favorites.length) {
    return (
      <EmptyState
        icon={Star}
        title="담아둔 항목이 없습니다"
        description="규정 목록이나 조문 화면의 별을 눌러 담아두면 여기에 모입니다."
      />
    );
  }

  return (
    <ul className="divide-y divide-gray-100">
      {favorites.map((fav) => (
        <li key={fav.id} className="flex items-center gap-2 px-1 py-2.5">
          {fav.article ? (
            <BookOpen size={15} className="text-gold-600 flex-none" aria-hidden />
          ) : (
            <FileText size={15} className="text-navy-600 flex-none" aria-hidden />
          )}
          <Link to={targetHref(fav)} className="min-w-0 flex-1 group">
            <span className="block truncate text-sm text-gray-900 group-hover:text-navy-700">
              {targetLabel(fav)}
            </span>
            {fav.article && (
              <span className="block truncate text-[11px] text-gray-500">{fav.policy.title}</span>
            )}
          </Link>
          {!fav.policy.isActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200 flex-none">
              비활성
            </span>
          )}
          <button
            type="button"
            onClick={() => remove.mutate(fav.id)}
            disabled={remove.isPending}
            aria-label={`즐겨찾기 해제: ${targetLabel(fav)}`}
            className="p-1 text-gray-400 hover:text-gray-700 flex-none disabled:opacity-50"
          >
            <X size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}

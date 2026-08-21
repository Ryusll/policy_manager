/**
 * 즐겨찾기 별 (T-80).
 *
 * 규정 전체(articleId 없음)와 조문 하나를 같은 컴포넌트로 다룬다.
 * 목록 갱신은 낙관적으로 하지 않는다 — 담긴 개수가 화면 여러 곳에 나오는데
 * 서버가 거부하면 되돌리기가 지저분해진다. 요청은 한 번뿐이라 체감 차이도 없다.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { clsx } from 'clsx';
import { favoritesApi } from '../api/favorites';
import { toast } from '../stores/toastStore';

export function FavoriteButton({
  policyId,
  articleId,
  label,
  className,
}: {
  policyId: string;
  articleId?: string | null;
  /** 툴팁·스크린리더용 대상 이름 */
  label: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const key = ['favorite', policyId, articleId ?? null];

  const { data: existing } = useQuery({
    queryKey: key,
    queryFn: () => favoritesApi.lookup(policyId, articleId),
    enabled: !!policyId,
  });

  const toggle = useMutation({
    mutationFn: async () => {
      if (existing?.id) {
        await favoritesApi.remove(existing.id);
        return null;
      }
      return favoritesApi.add(policyId, articleId);
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['favorites'] });
      toast(result ? `즐겨찾기에 담았습니다 — ${label}` : `즐겨찾기에서 뺐습니다 — ${label}`, 'success');
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message?.toString() || '즐겨찾기를 바꾸지 못했습니다.', 'error');
    },
  });

  const on = !!existing?.id;
  return (
    <button
      type="button"
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
      aria-pressed={on}
      aria-label={on ? `즐겨찾기 해제: ${label}` : `즐겨찾기: ${label}`}
      title={on ? '즐겨찾기 해제' : '즐겨찾기'}
      className={clsx(
        'inline-flex items-center justify-center rounded p-1 transition-colors disabled:opacity-50',
        on ? 'text-gold-500 hover:text-gold-600' : 'text-gray-300 hover:text-gray-500',
        className,
      )}
    >
      <Star size={15} fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}

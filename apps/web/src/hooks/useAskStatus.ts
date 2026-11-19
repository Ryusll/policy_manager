import { useQuery } from '@tanstack/react-query';
import { askApi } from '../api/ask';

/** 규정 질문 상태의 쿼리 키 — 상단 메뉴·질문 화면·대시보드 입구가 같은 캐시를 쓴다(질문 뒤 사용량도 여기에 고쳐 넣는다) */
export const ASK_STATUS_KEY = ['ask-status'] as const;

/**
 * 규정 질문 상태(서버 설정·회사 켜짐·고지·이번 달 사용량). 메뉴는 자주 다시 받을 필요가 없어 `staleTime` 을 길게 준다 —
 * 같은 키라 받아 둔 값은 함께 쓰고, 신선도만 부르는 곳마다 다르다.
 */
export function useAskStatus(options: { enabled?: boolean; staleTime?: number } = {}) {
  return useQuery({
    queryKey: ASK_STATUS_KEY,
    queryFn: askApi.status,
    enabled: options.enabled ?? true,
    ...(options.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
  });
}

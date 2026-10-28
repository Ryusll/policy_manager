import { useQuery } from '@tanstack/react-query';
import { policiesApi } from '../api/policies';

/**
 * 규정 자리(T-198). 키가 `['policies', …]` 아래라 규정을 만들거나 지워 `['policies']` 를 무효화하면 함께 다시 센다.
 * 관리자·편집자만 부른다(서버도 그 둘만 받는다).
 */
export function usePolicySlots(enabled: boolean) {
  // 창을 열 때마다 다시 센다 — 전역 30초 신선도로는 요금제를 올리거나 규정을 지운 뒤에도 버튼이 막힌 채 남는다
  return useQuery({ queryKey: ['policies', 'slots'], queryFn: policiesApi.slots, enabled, staleTime: 0 });
}

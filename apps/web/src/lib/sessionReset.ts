import type { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { useBrandStore } from '../stores/brandStore';
import { useToastStore } from '../stores/toastStore';
import { endAuthScope, watchAuthIdentity } from './authScope';

/**
 * 인증 주체가 바뀌면 앞 주체의 것을 모두 버린다 (T-181).
 *
 * 로그인·로그아웃·토큰 만료·비밀번호 변경 뒤 로그아웃·다른 탭의 전환을 이 한 곳이 덮는다 — 화면마다
 * 비우는 코드를 넣으면 다른 탭에서 들어온 전환(저장소 `storage` 이벤트)이 빠진다.
 * ① 진행 중 요청을 끊고 구간 번호를 올린다 — 늦게 온 응답·토큰 갱신·401 재시도가 다음 주체에 닿지 않게
 * ② 화면 캐시(조회·변경)를 모두 버린다 — 진행 중 조회는 취소되고 늦게 온 결과는 버려진다
 * ③ 떠 있는 안내(앞 사람의 규정 제목이 든 저장 안내 등)를 내리고, 다른 회사 사람이 들어오면 저장해 둔
 *    앞 회사의 로고를 첫 화면을 그리기 전에 지운다(동기화는 그린 뒤에 돈다). 로그아웃·같은 회사는 두고 —
 *    로그인할 때마다 로고가 기본 배지로 튀지 않게 — 회사 기록이 없는 예전 캐시(v2)도 둔다: 첫 동기화가
 *    그 로고를 서버로 올린다(`brandStore.syncFromServer`)
 * 같은 사람의 토큰 갱신·이름·역할 변경은 주체가 같아 비우지 않는다.
 *
 * 전제: 캐시를 비워도 이미 그려진 화면의 조회 결과는 그대로다(조용한 취소). 지금은 주체가 바뀌면
 * 그 화면이 내려간다 — 로그아웃·로그인은 화면 이동, 다른 탭의 로그아웃은 `PrivateRoute` 가 로그인
 * 화면으로 보내고, 바로 다른 사람이 되면 첫 화면부터 새로 연다(`followOtherTab`). 라우트 밖에서
 * 사용자 데이터를 조회하는 컴포넌트를 두면 이 전제가 깨진다.
 */
export function installSessionReset(queryClient: QueryClient): () => void {
  return watchAuthIdentity(useAuthStore, () => {
    endAuthScope();
    queryClient.clear();
    useToastStore.getState().clear();
    const tenantId = useAuthStore.getState().user?.tenantId ?? null;
    const cached = useBrandStore.getState().cachedTenantId;
    if (tenantId !== null && cached !== null && cached !== tenantId) useBrandStore.getState().clearCache();
  });
}

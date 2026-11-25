import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useBrandStore } from '../stores/brandStore';
import { canCustomizeBranding } from '../lib/planFeatures';

/**
 * 로그인 상태가 되면 회사 브랜딩을 서버에서 받아 온다 (T-57).
 *
 * 실패해도 조용히 넘긴다. 캐시가 이미 화면을 그리고 있고, 로고가 잠깐 옛 값인 것은
 * 브랜딩 때문에 화면 전체를 막는 것보다 낫다.
 */
export function useTenantBrandingSync() {
  const user = useAuthStore((s) => s.user);
  const syncFromServer = useBrandStore((s) => s.syncFromServer);
  const tenantId = user?.tenantId;

  useEffect(() => {
    if (!tenantId) return;
    // 로컬에만 있던 브랜딩의 서버 이관은 저장 권한이 있는 사람만 시도할 수 있다
    const canWrite = user?.role === 'admin' && canCustomizeBranding(user?.plan);
    void syncFromServer(tenantId, { canWrite }).catch(() => {});
  }, [tenantId, user?.role, user?.plan, syncFromServer]);
}

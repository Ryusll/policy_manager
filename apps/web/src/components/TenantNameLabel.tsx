import { useAuthStore } from '../stores/authStore';

/**
 * 상단바의 회사(테넌트) 이름(T-217, SRS BRAND-6) — 지금 어느 회사의 규정을 보고 있는지 알 수 있게.
 * 길면 줄이고(전체 이름은 마우스를 올리면), 상단바가 좁아지는 768px 아래에서는 숨긴다(내 정보 창에는 그대로 나온다).
 * 로고·서비스명보다 먼저 줄어들도록 줄어드는 비율을 크게 둔다.
 */
export default function TenantNameLabel() {
  const name = useAuthStore((s) => s.user?.tenantName)?.trim();
  if (!name) return null;
  return (
    <span
      className="hidden md:block min-w-0 max-w-[16rem] shrink-[10] truncate border-l border-white/25 pl-3 text-sm text-white/80"
      title={name}
      data-testid="header-tenant-name"
    >
      {name}
    </span>
  );
}

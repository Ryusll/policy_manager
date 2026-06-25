/** Browser navigates to API (same origin via /api proxy) for Google OAuth start. */
export function googleOAuthStartUrl(params: {
  mode: 'login' | 'register';
  tenantSlug: string;
  tenantName?: string;
}): string {
  const q = new URLSearchParams();
  q.set('mode', params.mode);
  q.set('tenantSlug', params.tenantSlug);
  if (params.mode === 'register' && params.tenantName) {
    q.set('tenantName', params.tenantName);
  }
  return `/api/auth/google?${q.toString()}`;
}

export interface GoogleOAuthState {
  mode: 'login' | 'register';
  tenantSlug: string;
  tenantName: string;
}

export function parseGoogleOAuthState(
  raw: string | undefined,
): GoogleOAuthState | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    const mode = o.mode === 'register' ? 'register' : 'login';
    return {
      mode,
      tenantSlug:
        typeof o.tenantSlug === 'string' ? o.tenantSlug : '',
      tenantName:
        typeof o.tenantName === 'string' ? o.tenantName : '',
    };
  } catch {
    return null;
  }
}

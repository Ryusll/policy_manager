/**
 * Browser-facing origin (scheme + host [+ port]). One value drives:
 * CORS, post-OAuth redirect to the SPA, and Google OAuth callback URL.
 *
 * Deploy: set PUBLIC_URL once (e.g. https://app.example.com). No need to set
 * FRONTEND_URL, CORS_ORIGIN, or GOOGLE_CALLBACK_URL unless you need legacy overrides.
 */
function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

export function getPublicUrl(): string {
  const raw =
    process.env.PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    process.env.CORS_ORIGIN ||
    'http://localhost:5173';
  return stripTrailingSlash(raw);
}

/** Must match an "Authorized redirect URI" in Google Cloud Console. */
export function getGoogleOAuthCallbackUrl(): string {
  if (process.env.GOOGLE_CALLBACK_URL) {
    return stripTrailingSlash(process.env.GOOGLE_CALLBACK_URL);
  }
  return `${getPublicUrl()}/api/auth/google/callback`;
}

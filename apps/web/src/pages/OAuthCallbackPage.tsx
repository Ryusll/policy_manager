import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../api/auth';
import { useI18n } from '../i18n/useI18n';

export default function OAuthCallbackPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const access = params.get('access_token');
    const refresh = params.get('refresh_token');
    window.history.replaceState({}, '', '/oauth/callback');

    if (!access || !refresh) {
      setError(t('oauth.callbackError'));
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        useAuthStore.setState({
          accessToken: access,
          refreshToken: refresh,
          isAuthenticated: false,
        });
        const user = await authApi.me();
        if (cancelled) return;
        setAuth(user, access, refresh);
        navigate('/', { replace: true });
      } catch {
        if (cancelled) return;
        useAuthStore.getState().logout();
        setError(t('oauth.callbackError'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, setAuth, t]);

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="text-center text-sm text-gray-600">
        {error ? (
          <div className="space-y-3">
            <p className="text-red-700">{error}</p>
            <button
              type="button"
              className="text-navy-700 underline"
              onClick={() => navigate('/login', { replace: true })}
            >
              {t('register.loginLink')}
            </button>
          </div>
        ) : (
          <p>{t('oauth.callbackWorking')}</p>
        )}
      </div>
    </div>
  );
}

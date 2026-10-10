import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../api/auth';
import { useI18n } from '../i18n/useI18n';
import { clsx } from 'clsx';
import { AppBrandLockup } from '../components/AppBrandLockup';
import AppFooterBranding from '../components/AppFooterBranding';

export default function LoginPage() {
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [form, setForm] = useState({ email: '', password: '', tenantSlug: 'demo' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { data: signupOptions } = useQuery({
    queryKey: ['auth-options'],
    queryFn: authApi.options,
    staleTime: 5 * 60_000,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await authApi.login(form);
      setAuth(data.user, data.accessToken, data.refreshToken);
      navigate('/');
    } catch (err: any) {
      // 비밀번호 없는 계정(예전 구글 로그인으로 만든 것)은 관리자 재설정으로 안내한다(T-136)
      if (err.response?.data?.code === 'PASSWORD_NOT_SET') {
        setError(t('login.passwordNotSet'));
        return;
      }
      const apiMsg = err.response?.data?.message;
      const raw =
        typeof apiMsg === 'string' ? apiMsg : Array.isArray(apiMsg) ? String(apiMsg[0]) : '';
      const mapped: Record<string, string> = {
        'Tenant not found': t('login.tenantNotFound'),
        'Invalid credentials': t('login.invalidCredentials'),
      };
      setError(mapped[raw] || raw || t('login.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <header className="bg-navy-900 text-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-3">
          <AppBrandLockup variant="login" />
          <div className="flex items-center rounded border border-navy-600 overflow-hidden flex-shrink-0">
            <button
              type="button"
              onClick={() => setLocale('ko')}
              className={clsx(
                'px-2 py-1 text-[11px] font-medium transition-colors',
                locale === 'ko' ? 'bg-navy-700 text-white' : 'text-navy-300 hover:text-white',
              )}
            >
              {t('layout.lang.ko')}
            </button>
            <button
              type="button"
              onClick={() => setLocale('en')}
              className={clsx(
                'px-2 py-1 text-[11px] font-medium transition-colors border-l border-navy-600',
                locale === 'en' ? 'bg-navy-700 text-white' : 'text-navy-300 hover:text-white',
              )}
            >
              {t('layout.lang.en')}
            </button>
          </div>
        </div>
        <div className="h-1 bg-gold-500" />
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-gray-800">{t('login.title')}</h1>
            <p className="text-sm text-gray-500 mt-1">{t('login.welcome')}</p>
          </div>

          <div className="bg-white border border-gray-300 shadow-sm">
            <div className="bg-navy-800 px-5 py-3 border-b border-navy-700">
              <h2 className="text-white font-medium text-sm">{t('login.cardTitle')}</h2>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  {t('login.tenant')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.tenantSlug}
                  onChange={(e) => setForm({ ...form, tenantSlug: e.target.value })}
                  className="input"
                  placeholder="demo"
                  required
                />
                <p className="text-xs text-gray-500 mt-1.5">{t('login.tenantHint')}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  {t('login.email')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="input"
                  placeholder="admin@demo.com"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  {t('login.password')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="input"
                  placeholder="••••••••"
                  required
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-300 text-red-700 px-3 py-2 rounded text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-navy-800 text-white text-sm font-medium hover:bg-navy-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded"
              >
                {loading ? t('login.submitting') : t('login.submit')}
              </button>

            </form>

            <div className="px-5 pb-4 text-center text-sm text-gray-600">
              {/* 고객사는 아스트룸이 개설한다 — 공개 가입이 닫힌 서버(운영)에서는 링크 대신 안내(T-122) */}
              {signupOptions?.publicSignup ? (
                <>
                  {t('login.noAccount')}{' '}
                  <Link to="/register" className="text-navy-700 font-medium hover:underline">
                    {t('login.registerLink')}
                  </Link>
                </>
              ) : (
                <span className="text-xs text-gray-500">{t('login.askAdmin')}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <AppFooterBranding />
    </div>
  );
}

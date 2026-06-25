import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../api/auth';
import { useI18n } from '../i18n/useI18n';
import { clsx } from 'clsx';
import { AppBrandLockup } from '../components/AppBrandLockup';
import { googleOAuthStartUrl } from '../lib/oauth';

function normalizeSlug(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export default function RegisterPage() {
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [form, setForm] = useState({
    tenantName: '',
    tenantSlug: '',
    name: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const slug = normalizeSlug(form.tenantSlug);
    if (slug.length < 2 || slug.length > 40) {
      setError(t('register.slugInvalid'));
      return;
    }
    setLoading(true);
    try {
      const data = await authApi.register({
        tenantName: form.tenantName.trim(),
        tenantSlug: slug,
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      setAuth(data.user, data.accessToken, data.refreshToken);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message || t('register.error'));
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
            <h1 className="text-xl font-bold text-gray-800">{t('register.title')}</h1>
            <p className="text-sm text-gray-500 mt-1">{t('register.subtitle')}</p>
          </div>

          <div className="bg-white border border-gray-300 shadow-sm">
            <div className="bg-navy-800 px-5 py-3 border-b border-navy-700">
              <h2 className="text-white font-medium text-sm">{t('register.cardTitle')}</h2>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  {t('register.tenantName')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.tenantName}
                  onChange={(e) => setForm({ ...form, tenantName: e.target.value })}
                  className="input"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  {t('register.tenantSlug')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.tenantSlug}
                  onChange={(e) => setForm({ ...form, tenantSlug: e.target.value })}
                  onBlur={() => setForm((f) => ({ ...f, tenantSlug: normalizeSlug(f.tenantSlug) }))}
                  className="input font-mono text-sm"
                  placeholder="my-org"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">{t('register.tenantSlugHint')}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  {t('register.name')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  {t('register.email')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="input"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  {t('register.password')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="input"
                  minLength={6}
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
                {loading ? t('register.submitting') : t('register.submit')}
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-white text-gray-400">{t('login.dividerOr')}</span>
                </div>
              </div>

              <button
                type="button"
                className="w-full py-2.5 border border-gray-300 bg-white text-gray-800 text-sm font-medium hover:bg-gray-50 transition-colors rounded flex items-center justify-center gap-2"
                onClick={() => {
                  setError('');
                  const slug = normalizeSlug(form.tenantSlug);
                  if (slug.length < 2 || slug.length > 40) {
                    setError(t('register.slugInvalid'));
                    return;
                  }
                  const name = form.tenantName.trim();
                  if (!name) {
                    setError(t('register.googleNeedTenant'));
                    return;
                  }
                  window.location.href = googleOAuthStartUrl({
                    mode: 'register',
                    tenantSlug: slug,
                    tenantName: name,
                  });
                }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                {t('register.google')}
              </button>
              <p className="text-xs text-gray-500 text-center">{t('register.googleHint')}</p>
            </form>

            <div className="px-5 pb-5 text-center text-sm text-gray-600">
              {t('register.hasAccount')}{' '}
              <Link to="/login" className="text-navy-700 font-medium hover:underline">
                {t('register.loginLink')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

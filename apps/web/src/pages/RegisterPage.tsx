import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../api/auth';
import { useI18n } from '../i18n/useI18n';
import { clsx } from 'clsx';
import { AppBrandLockup } from '../components/AppBrandLockup';

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
  const { data: signupOptions } = useQuery({
    queryKey: ['auth-options'],
    queryFn: authApi.options,
    staleTime: 5 * 60_000,
  });

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

  // 고객사는 아스트룸이 개설한다 — 주소를 직접 쳐서 들어와도 가입 양식을 보이지 않는다(T-122)
  if (signupOptions && !signupOptions.publicSignup) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white border border-gray-300 shadow-sm p-6 space-y-3 text-center">
          <h1 className="text-base font-semibold text-gray-800">{t('register.closedTitle')}</h1>
          <p className="text-sm text-gray-600 leading-relaxed">{t('register.closedBody')}</p>
          <Link to="/login" className="inline-block text-sm text-navy-700 font-medium hover:underline">
            {t('register.loginLink')}
          </Link>
        </div>
      </div>
    );
  }

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

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useI18n } from '../i18n/useI18n';
import { usersApi } from '../api/users';
import { authApi } from '../api/auth';
import { toast } from '../stores/toastStore';
import { apiErrorMessage } from '../lib/apiError';
import AppFooterBranding from '../components/AppFooterBranding';

/**
 * 첫 로그인 비밀번호 변경 (T-122).
 *
 * 회사 관리자나 아스트룸이 정해 준 비밀번호로 들어온 사람은, 바꾸기 전까지 이 화면만 본다.
 * 정해 준 사람이 그 비밀번호를 알고 있으므로 그대로 쓰게 두면 안 된다. 서버도 같은 상태에서
 * 대부분의 API 를 막는다(PasswordChangeGuard) — 이 화면은 그걸 사람에게 보여 주는 쪽이다.
 */
export default function ForcePasswordChangePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const mismatch = pw.confirm.length > 0 && pw.next !== pw.confirm;
  const ready = pw.current.length > 0 && pw.next.length >= 8 && pw.next === pw.confirm;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || !ready) return;
    setSaving(true);
    setError('');
    try {
      await usersApi.changePassword({ currentPassword: pw.current, newPassword: pw.next });
      // 서버가 모든 세션의 갱신을 끊었다 — 새 비밀번호로 다시 들어오게 한다
      useAuthStore.getState().logout();
      toast(t('forcePw.done'), 'success');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, t('password.error')));
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    try {
      await authApi.logout();
    } catch {
      // 로컬 세션은 어차피 지운다
    }
    useAuthStore.getState().logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <form
          onSubmit={submit}
          className="w-full max-w-md bg-white border border-gray-300 shadow-sm"
          aria-labelledby="force-pw-title"
        >
          <div className="bg-navy-900 text-white px-5 py-3 flex items-center gap-2">
            <KeyRound size={16} />
            <h1 id="force-pw-title" className="text-sm font-medium">
              {t('forcePw.title')}
            </h1>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-sm text-gray-700 leading-relaxed">{t('forcePw.lead')}</p>
            {user && (
              <p className="text-xs text-gray-500">
                {user.tenantName} · {user.email}
              </p>
            )}
            {(
              [
                ['current', 'forcePw.current', 'current-password'],
                ['next', 'password.new', 'new-password'],
                ['confirm', 'password.confirm', 'new-password'],
              ] as const
            ).map(([key, label, autoComplete]) => (
              <div key={key}>
                <label htmlFor={`force-${key}`} className="block text-xs text-gray-600 mb-1">
                  {t(label)}
                </label>
                <input
                  id={`force-${key}`}
                  type="password"
                  className="input"
                  autoComplete={autoComplete}
                  autoFocus={key === 'current'}
                  value={pw[key]}
                  onChange={(e) => setPw({ ...pw, [key]: e.target.value })}
                />
              </div>
            ))}
            <p className="text-[11px] text-gray-400">{t('password.hint')}</p>
            {mismatch && <p className="text-xs text-red-700">{t('password.mismatch')}</p>}
            {error && (
              <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                {error}
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <button type="button" className="text-xs text-gray-500 underline" onClick={signOut}>
                {t('layout.logout')}
              </button>
              <button type="submit" className="btn-primary text-sm" disabled={saving || !ready}>
                {saving ? t('password.submitting') : t('password.submit')}
              </button>
            </div>
          </div>
        </form>
      </div>
      <AppFooterBranding />
    </div>
  );
}

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useI18n } from '../i18n/useI18n';
import { usersApi } from '../api/users';
import { toast } from '../stores/toastStore';
import { apiErrorMessage } from '../lib/apiError';

const NAME_MAX = 100;

interface Props {
  onClose: () => void;
}

/** 내 정보 — 이름만 직접 고칠 수 있다. 이메일·역할은 조직 관리자가 구성원 관리에서 바꾼다 */
export default function ProfileModal({ onClose }: Props) {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !pwSaving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving, pwSaving]);

  if (!user) return null;

  const trimmed = name.trim();
  const unchanged = trimmed === user.name;
  const invalid = trimmed.length === 0 || trimmed.length > NAME_MAX;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || unchanged || invalid) return;
    setSaving(true);
    setError('');
    try {
      const updated = await usersApi.updateMe({ name: trimmed });
      // 저장하는 동안 다른 곳에서 바뀐 값을 덮지 않도록 지금 저장소의 값에 이름만 얹는다
      const current = useAuthStore.getState().user;
      if (current) useAuthStore.getState().setUser({ ...current, name: updated.name });
      toast(t('profile.saved'), 'success');
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t('profile.error')));
    } finally {
      setSaving(false);
    }
  };

  const pwMismatch = pw.confirm.length > 0 && pw.next !== pw.confirm;
  const pwReady = pw.current.length > 0 && pw.next.length >= 8 && pw.next === pw.confirm;

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (pwSaving || !pwReady) return;
    setPwSaving(true);
    setPwError('');
    try {
      await usersApi.changePassword({ currentPassword: pw.current, newPassword: pw.next });
      // 서버가 모든 세션의 갱신을 끊었다 — 이 화면도 다시 로그인하게 한다
      useAuthStore.getState().logout();
      toast(t('password.done'), 'success');
      navigate('/login');
    } catch (err) {
      setPwError(apiErrorMessage(err, t('password.error')));
    } finally {
      setPwSaving(false);
    }
  };

  const roleLabel: Record<string, string> = {
    admin: t('role.admin'),
    editor: t('role.editor'),
    viewer: t('role.viewer'),
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        className="w-full max-w-md max-h-full overflow-y-auto shadow-2xl"
      >
      <form onSubmit={submit} className="bg-white border border-gray-300">
        <div className="bg-navy-900 text-white px-5 py-3 flex items-center justify-between">
          <h2 id="profile-modal-title" className="text-sm font-medium">
            {t('profile.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-navy-700 rounded transition-colors"
            aria-label={t('profile.close')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="profile-name" className="block text-xs text-gray-600 mb-1">
              {t('profile.name')}
            </label>
            <input
              id="profile-name"
              ref={inputRef}
              type="text"
              className="input"
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-[11px] text-gray-400 mt-1">{t('profile.nameHint')}</p>
          </div>

          <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-gray-500">{t('profile.email')}</dt>
            <dd className="text-gray-800 break-all">{user.email}</dd>
            <dt className="text-gray-500">{t('profile.role')}</dt>
            <dd className="text-gray-800">{roleLabel[user.role] ?? user.role}</dd>
            <dt className="text-gray-500">{t('profile.org')}</dt>
            <dd className="text-gray-800">{user.tenantName}</dd>
          </dl>
          <p className="text-[11px] text-gray-400 -mt-2">{t('profile.emailHint')}</p>

          {error && (
            <p
              role="alert"
              className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1"
            >
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={onClose}>
              {t('profile.cancel')}
            </button>
            <button
              type="submit"
              className="btn-primary text-sm"
              disabled={saving || unchanged || invalid}
            >
              {saving ? t('profile.saving') : t('profile.save')}
            </button>
          </div>
        </div>
      </form>
      <div className="bg-white border border-t-0 border-gray-300 px-5 pb-5">
        <button
          type="button"
          className="text-xs text-navy-700 underline"
          aria-expanded={pwOpen}
          onClick={() => setPwOpen((o) => !o)}
        >
          {t('password.section')}
        </button>
        {pwOpen && (
          <form onSubmit={submitPassword} className="mt-3 space-y-3">
            {(
              [
                ['current', 'password.current', 'current-password'],
                ['next', 'password.new', 'new-password'],
                ['confirm', 'password.confirm', 'new-password'],
              ] as const
            ).map(([key, label, autoComplete]) => (
              <div key={key}>
                <label htmlFor={`pw-${key}`} className="block text-xs text-gray-600 mb-1">
                  {t(label)}
                </label>
                <input
                  id={`pw-${key}`}
                  type="password"
                  className="input"
                  autoComplete={autoComplete}
                  value={pw[key]}
                  onChange={(e) => setPw({ ...pw, [key]: e.target.value })}
                />
              </div>
            ))}
            <p className="text-[11px] text-gray-400">{t('password.hint')}</p>
            {pwMismatch && <p className="text-xs text-red-700">{t('password.mismatch')}</p>}
            {pwError && (
              <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                {pwError}
              </p>
            )}
            <div className="flex justify-end">
              <button type="submit" className="btn-primary text-sm" disabled={pwSaving || !pwReady}>
                {pwSaving ? t('password.submitting') : t('password.submit')}
              </button>
            </div>
          </form>
        )}
      </div>
      </div>
    </div>
  );
}

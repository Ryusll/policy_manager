import { useEffect, useRef, useState, type FormEvent } from 'react';
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

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

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
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        onSubmit={submit}
        className="bg-white w-full max-w-md border border-gray-300 shadow-2xl"
      >
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
    </div>
  );
}

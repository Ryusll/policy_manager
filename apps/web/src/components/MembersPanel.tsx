import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil } from 'lucide-react';
import { clsx } from 'clsx';
import { usersApi, type TenantUser, type UpdateUserPayload } from '../api/users';
import { useAuthStore } from '../stores/authStore';
import { useI18n } from '../i18n/useI18n';
import { toast } from '../stores/toastStore';
import { apiErrorMessage } from '../lib/apiError';

type Role = 'admin' | 'editor' | 'viewer';
const ROLES: Role[] = ['admin', 'editor', 'viewer'];
const QUERY_KEY = ['tenant-users'];
const NAME_MAX = 100;

/** 설정 > 구성원 관리 — 관리자가 같은 조직 구성원의 이름·이메일·역할을 고친다 */
export default function MembersPanel() {
  const { t } = useI18n();
  const me = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const { data: users, isLoading, isError } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: usersApi.list,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', email: '', role: 'viewer' as Role });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [resetSaving, setResetSaving] = useState(false);
  const [resetError, setResetError] = useState('');

  const roleLabel: Record<string, string> = {
    admin: t('role.admin'),
    editor: t('role.editor'),
    viewer: t('role.viewer'),
  };

  // 마지막 관리자는 서버도 막지만, 눌러 보기 전에 화면에서 먼저 알려 준다
  const adminCount = useMemo(() => (users ?? []).filter((u) => u.role === 'admin').length, [users]);

  const startEdit = (u: TenantUser) => {
    setResetId(null);
    setEditingId(u.id);
    setDraft({ name: u.name, email: u.email, role: u.role as Role });
    setError('');
  };

  const startReset = (u: TenantUser) => {
    setEditingId(null);
    setResetId(u.id);
    setResetPw('');
    setResetError('');
  };

  const submitReset = async (u: TenantUser) => {
    if (resetSaving || resetPw.length < 8) return;
    setResetSaving(true);
    setResetError('');
    try {
      await usersApi.resetPassword(u.id, resetPw);
      toast(t('members.resetDone'), 'success');
      setResetId(null);
      setResetPw('');
    } catch (err) {
      setResetError(apiErrorMessage(err, t('members.resetError')));
    } finally {
      setResetSaving(false);
    }
  };

  const cancel = () => {
    setEditingId(null);
    setError('');
  };

  const save = async (u: TenantUser) => {
    const name = draft.name.trim();
    const email = draft.email.trim().toLowerCase();
    const changes: UpdateUserPayload = {};
    if (name !== u.name) changes.name = name;
    if (email !== u.email) changes.email = email;
    if (draft.role !== u.role) changes.role = draft.role;
    if (Object.keys(changes).length === 0) {
      cancel();
      return;
    }

    const isMe = u.id === me?.id;
    if (isMe && changes.role && changes.role !== 'admin' && !window.confirm(t('members.confirmSelfDemote'))) {
      return;
    }

    setSaving(true);
    setError('');
    try {
      const updated = await usersApi.update(u.id, changes);
      if (isMe) {
        // 내 이름·이메일·역할이 바뀌었으니 화면의 내 정보도 맞춘다(역할이 내려가면 메뉴가 바로 줄어든다)
        const current = useAuthStore.getState().user;
        if (current) {
          useAuthStore
            .getState()
            .setUser({ ...current, name: updated.name, email: updated.email, role: updated.role });
        }
      }
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast(t('members.saved'), 'success');
      setEditingId(null);
    } catch (err) {
      setError(apiErrorMessage(err, t('members.error')));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <p className="text-xs text-gray-500">{t('members.loading')}</p>;
  if (isError) return <p className="text-xs text-red-700">{t('members.loadError')}</p>;
  if (!users?.length) return <p className="text-xs text-gray-500">{t('members.empty')}</p>;

  return (
    <ul className="divide-y divide-gray-100 border border-gray-200 rounded">
      {users.map((u) => {
        const isMe = u.id === me?.id;
        const editing = editingId === u.id;

        if (!editing) {
          return (
            <li key={u.id} className="p-3">
              <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-navy-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                {u.name.charAt(0) || '?'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {u.name}
                  {isMe && (
                    <span className="ml-1.5 align-middle text-[10px] font-medium px-1.5 py-0.5 rounded bg-gold-500 text-white">
                      {t('members.me')}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 truncate">{u.email}</div>
              </div>
              <span
                className={clsx(
                  'text-xs px-2 py-0.5 rounded shrink-0',
                  u.role === 'admin' ? 'bg-navy-100 text-navy-800' : 'bg-gray-100 text-gray-700',
                )}
              >
                {roleLabel[u.role] ?? u.role}
              </span>
              {u.mustChangePassword && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800 shrink-0"
                  title={t('members.pendingFirstLoginHint')}
                >
                  {t('members.pendingFirstLogin')}
                </span>
              )}
              <button
                type="button"
                className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                disabled={editingId !== null}
                aria-label={`${t('members.edit')}: ${u.name}`}
                onClick={() => startEdit(u)}
              >
                <Pencil size={12} />
                {t('members.edit')}
              </button>
              {!isMe && (
                <button
                  type="button"
                  className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  disabled={editingId !== null}
                  aria-label={`${t('members.resetPassword')}: ${u.name}`}
                  onClick={() => startReset(u)}
                >
                  <KeyRound size={12} />
                  {t('members.resetPassword')}
                </button>
              )}
              </div>
              {resetId === u.id && (
                <form
                  className="mt-3 ml-11 space-y-2"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    void submitReset(u);
                  }}
                >
                  <p className="text-[11px] text-gray-500">{t('members.resetHint')}</p>
                  <input
                    type="password"
                    className="input"
                    autoFocus
                    autoComplete="new-password"
                    aria-label={t('members.resetNew')}
                    placeholder={t('members.resetNew')}
                    value={resetPw}
                    onChange={(e) => setResetPw(e.target.value)}
                  />
                  {resetError && (
                    <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                      {resetError}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <button type="submit" className="btn-primary text-xs py-1.5" disabled={resetSaving || resetPw.length < 8}>
                      {resetSaving ? t('members.saving') : t('members.save')}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-xs py-1.5"
                      disabled={resetSaving}
                      onClick={() => setResetId(null)}
                    >
                      {t('members.cancel')}
                    </button>
                  </div>
                </form>
              )}
            </li>
          );
        }

        const lastAdmin = u.role === 'admin' && adminCount <= 1;
        const name = draft.name.trim();
        const email = draft.email.trim().toLowerCase();
        const dirty = name !== u.name || email !== u.email || draft.role !== u.role;
        const valid = name.length > 0 && name.length <= NAME_MAX && email.length > 0;

        return (
          <li key={u.id} className="p-3 bg-gray-50/70">
            <form
              className="space-y-3"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (!saving && dirty && valid) void save(u);
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`member-name-${u.id}`} className="block text-xs text-gray-600 mb-1">
                    {t('members.name')}
                  </label>
                  <input
                    id={`member-name-${u.id}`}
                    type="text"
                    className="input"
                    autoFocus
                    maxLength={NAME_MAX}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor={`member-email-${u.id}`} className="block text-xs text-gray-600 mb-1">
                    {t('members.email')}
                  </label>
                  <input
                    id={`member-email-${u.id}`}
                    type="email"
                    className="input"
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor={`member-role-${u.id}`} className="block text-xs text-gray-600 mb-1">
                    {t('members.role')}
                  </label>
                  <select
                    id={`member-role-${u.id}`}
                    className="input"
                    value={draft.role}
                    disabled={lastAdmin}
                    onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {roleLabel[r]}
                      </option>
                    ))}
                  </select>
                  {lastAdmin && <p className="text-[11px] text-amber-700 mt-1">{t('members.lastAdmin')}</p>}
                </div>
              </div>

              {email !== u.email && <p className="text-[11px] text-gray-500">{t('members.emailNote')}</p>}
              {error && (
                <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                  {error}
                </p>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="btn-primary text-xs py-1.5"
                  disabled={saving || !dirty || !valid}
                >
                  {saving ? t('members.saving') : t('members.save')}
                </button>
                <button type="button" className="btn-secondary text-xs py-1.5" onClick={cancel} disabled={saving}>
                  {t('members.cancel')}
                </button>
              </div>
            </form>
          </li>
        );
      })}
    </ul>
  );
}

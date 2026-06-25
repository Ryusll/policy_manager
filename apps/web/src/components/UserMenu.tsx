import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { ChevronDown, LogOut, HelpCircle, CreditCard } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useI18n } from '../i18n/useI18n';

type UserRole = 'admin' | 'editor' | 'viewer';
type PlanTier = 'starter' | 'pro' | 'enterprise';

function isUserRole(value: string): value is UserRole {
  return value === 'admin' || value === 'editor' || value === 'viewer';
}

function isPlanTier(value: string): value is PlanTier {
  return value === 'starter' || value === 'pro' || value === 'enterprise';
}

type Props = {
  onOpenPlan: () => void;
  onOpenTour: () => void;
  onLogout: () => void;
};

export default function UserMenu({ onOpenPlan, onOpenTour, onLogout }: Props) {
  const { t, locale, setLocale } = useI18n();
  const { user } = useAuthStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const roleLabel = {
    admin: t('role.admin'),
    editor: t('role.editor'),
    viewer: t('role.viewer'),
  };

  const planLabel = {
    starter: t('plan.starter'),
    pro: t('plan.pro'),
    enterprise: t('plan.enterprise'),
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const planText =
    user?.plan && isPlanTier(user.plan) ? planLabel[user.plan] : user?.plan || '-';
  const roleText =
    user?.role && isUserRole(user.role) ? roleLabel[user.role] : user?.role || '';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-navy-600/80 bg-navy-800/50 px-2 py-1 hover:bg-navy-700 transition-colors text-left"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <div className="w-7 h-7 rounded-full bg-navy-600 flex items-center justify-center text-xs font-bold shrink-0">
          {user?.name?.charAt(0) || '?'}
        </div>
        <span className="hidden md:block text-xs text-navy-100 max-w-[7rem] truncate">{user?.name}</span>
        <ChevronDown size={14} className={clsx('text-navy-400 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-56 rounded-lg border border-gray-200 bg-white shadow-lg text-navy-900 text-sm z-50 py-1"
        >
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="font-medium text-gray-900 truncate">{user?.name}</div>
            <div className="text-xs text-gray-500 mt-0.5">{roleText}</div>
            <div className="text-xs text-gray-500 truncate">{user?.email}</div>
          </div>

          <div className="px-3 py-2 border-b border-gray-100">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">{t('layout.langLabel')}</div>
            <div className="flex rounded border border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setLocale('ko')}
                className={clsx(
                  'flex-1 px-2 py-1 text-xs font-medium',
                  locale === 'ko' ? 'bg-navy-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
                )}
              >
                {t('layout.lang.ko')}
              </button>
              <button
                type="button"
                onClick={() => setLocale('en')}
                className={clsx(
                  'flex-1 px-2 py-1 text-xs font-medium border-l border-gray-200',
                  locale === 'en' ? 'bg-navy-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
                )}
              >
                {t('layout.lang.en')}
              </button>
            </div>
          </div>

          <button
            type="button"
            role="menuitem"
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 text-gray-800"
            onClick={() => {
              setOpen(false);
              onOpenPlan();
            }}
          >
            <CreditCard size={15} className="text-navy-600" />
            <span className="flex-1">{t('layout.planBadgeTitle')}</span>
            <span className="text-xs bg-gold-500 text-white px-1.5 py-0.5 rounded font-medium">{planText}</span>
          </button>
          <Link
            to="/about"
            role="menuitem"
            className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-gray-800"
            onClick={() => setOpen(false)}
          >
            <HelpCircle size={15} className="text-navy-600" />
            {t('layout.helpMenu.about')}
          </Link>
          <button
            type="button"
            role="menuitem"
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 text-gray-800"
            onClick={() => {
              setOpen(false);
              onOpenTour();
            }}
          >
            <HelpCircle size={15} className="text-navy-600 opacity-60" />
            {t('layout.helpMenu.tour')}
          </button>
          <div className="border-t border-gray-100 mt-1 pt-1">
            <button
              type="button"
              role="menuitem"
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-red-50 text-red-700"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
            >
              <LogOut size={15} />
              {t('layout.logout')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

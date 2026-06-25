import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { policiesApi } from '../api/policies';
import { useAuthStore } from '../stores/authStore';
import { FileText, Search, Plus, ArrowRight } from 'lucide-react';
import { useMemo } from 'react';
import { useI18n } from '../i18n/useI18n';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';

type UserRole = 'admin' | 'editor' | 'viewer';

function isUserRole(value: string): value is UserRole {
  return value === 'admin' || value === 'editor' || value === 'viewer';
}

function getPolicyMeta(policy: any) {
  const meta = policy?.metadata && typeof policy.metadata === 'object' ? policy.metadata : {};
  const department = typeof meta.department === 'string' ? meta.department.trim() : '';
  const category = typeof meta.category === 'string' ? meta.category.trim() : '';
  return { department, category };
}

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const roleLabel = useMemo(
    () => ({
      admin: t('role.admin'),
      editor: t('role.editor'),
      viewer: t('role.viewer'),
    }),
    [t, locale],
  );

  const { data: policies = [] } = useQuery({
    queryKey: ['policies'],
    queryFn: policiesApi.list,
  });

  const activeCount = policies.filter((p: any) => p.isActive).length;

  const recentPolicies = useMemo(() => {
    return [...policies]
      .sort((a: any, b: any) => {
        const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return tb - ta;
      })
      .slice(0, 6);
  }, [policies]);

  const stats = useMemo(
    () => [
      { label: t('dashboard.stat.total'), value: policies.length, color: 'border-l-navy-600' },
      { label: t('dashboard.stat.active'), value: activeCount, color: 'border-l-blue-500' },
      { label: t('dashboard.stat.inactive'), value: policies.length - activeCount, color: 'border-l-gray-400' },
      {
        label: t('dashboard.stat.role'),
        value: user?.role && isUserRole(user.role) ? roleLabel[user.role] : user?.role || '-',
        color: 'border-l-gold-500',
      },
    ],
    [t, locale, policies.length, activeCount, roleLabel, user?.role],
  );

  const canCreate = user?.role === 'admin' || user?.role === 'editor';

  return (
    <div className="page-shell">
      <PageHeader
        title={t('dashboard.bannerHeadline')}
        description={t('dashboard.welcomeLine', {
          name: user?.name || '',
          role: user?.role && isUserRole(user.role) ? roleLabel[user.role] : user?.role || '',
        })}
        actions={
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => navigate('/search')}
          >
            <Search size={15} />
            {t('dashboard.quickSearch')}
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s, i) => (
          <div key={i} className={`stat-card ${s.color}`}>
            <div className="text-2xl font-bold text-gray-900 tabular-nums">{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="section-card">
        <div className="section-card__head">
          <h2>{t('dashboard.continueWork')}</h2>
          <Link to="/policies" className="text-xs text-navy-200 hover:text-white inline-flex items-center gap-1">
            {t('dashboard.viewAll')} <ArrowRight size={12} />
          </Link>
        </div>
        {recentPolicies.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={t('dashboard.empty')}
            description={t('policies.subtitle', { n: 0 })}
            action={
              canCreate ? (
                <Link to="/policies" className="btn-primary text-sm">
                  <Plus size={14} /> {t('dashboard.addPolicy')}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {recentPolicies.map((policy: any) => {
              const meta = getPolicyMeta(policy);
              return (
                <li key={policy.id}>
                  <Link
                    to={'/policies/' + policy.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-navy-50/80 transition-colors group"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-navy-50 text-navy-700">
                      <FileText size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900 group-hover:text-navy-800 truncate">
                        {policy.title}
                      </div>
                      <div className="text-xs text-gray-500 font-mono mt-0.5">{policy.code}</div>
                      {(meta.department || meta.category) && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {meta.department ? (
                            <span className="text-[10px] rounded bg-indigo-50 text-indigo-700 px-1.5 py-0.5 border border-indigo-100">
                              {meta.department}
                            </span>
                          ) : null}
                          {meta.category ? (
                            <span className="text-[10px] rounded bg-emerald-50 text-emerald-700 px-1.5 py-0.5 border border-emerald-100">
                              {meta.category}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-md border shrink-0 ${
                        policy.isActive
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-gray-50 text-gray-500 border-gray-200'
                      }`}
                    >
                      {policy.isActive ? t('dashboard.active') : t('dashboard.inactive')}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

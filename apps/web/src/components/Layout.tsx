import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useTenantBrandingSync } from '../hooks/useTenantBrandingSync';
import { authApi } from '../api/auth';
import { policiesApi } from '../api/policies';
import { LayoutDashboard, FileText, Search, Variable, Settings, PlugZap, Menu, X, ChevronRight, Shield, ScrollText } from 'lucide-react';
import UserMenu from './UserMenu';
import { useState, useEffect, useMemo } from 'react';
import { clsx } from 'clsx';
import PlanModal from './PlanModal';
import OnboardingTour, { STORAGE_KEY } from './OnboardingTour';
import { useI18n } from '../i18n/useI18n';
import { AppBrandLockup } from './AppBrandLockup';
import AppFooterBranding from './AppFooterBranding';
import NotificationBell from './NotificationBell';
import { canUseApiIntegration } from '../lib/planFeatures';
import { useQuery } from '@tanstack/react-query';

const navDefs = [
  { path: '/', labelKey: 'layout.nav.dashboard', icon: LayoutDashboard, id: 'nav-dashboard' },
  { path: '/policies', labelKey: 'layout.nav.policies', icon: FileText, id: 'nav-policies' },
  { path: '/search', labelKey: 'layout.nav.search', icon: Search, id: 'nav-search' },
  { path: '/variables', labelKey: 'layout.nav.variables', icon: Variable, id: 'nav-variables' },
  { path: '/settings', labelKey: 'layout.nav.settings', icon: Settings, id: 'nav-settings' },
  { path: '/integrations', labelKey: 'layout.nav.integrations', icon: PlugZap, id: 'nav-integrations' },
  { path: '/audit-logs', labelKey: 'layout.nav.auditLogs', icon: ScrollText, id: 'nav-audit-logs' },
  { path: '/admin', labelKey: 'layout.nav.admin', icon: Shield, id: 'nav-platform-admin' },
] as const;

type PlanTier = 'starter' | 'pro' | 'enterprise';

function isPlanTier(value: string): value is PlanTier {
  return value === 'starter' || value === 'pro' || value === 'enterprise';
}

export default function Layout() {
  const { t, locale } = useI18n();
  const { user, logout } = useAuthStore();
  useTenantBrandingSync();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showTour, setShowTour] = useState(false);

  const navItems = useMemo(() => {
    const isEnterprise = canUseApiIntegration(user?.plan);
    const isViewer = user?.role === 'viewer';
    const isAdmin = user?.role === 'admin';
    return navDefs
      .filter((item) => (item.path === '/integrations' ? isEnterprise : true))
      .filter((item) => (item.path === '/admin' ? user?.platformRole === 'global_admin' : true))
      // 감사 로그에는 다른 구성원의 활동이 담긴다 — 회사 관리자만 본다
      .filter((item) => (item.path === '/audit-logs' ? isAdmin : true))
      .filter((item) => {
        if (!isViewer) return true;
        return item.path === '/search';
      })
      .map((item) => ({ ...item, label: t(item.labelKey) }));
  }, [t, locale, user?.plan, user?.role]);

  const planLabel = useMemo(
    () => ({
      starter: t('plan.starter'),
      pro: t('plan.pro'),
      enterprise: t('plan.enterprise'),
    }),
    [t, locale],
  );

  useEffect(() => {
    const done = localStorage.getItem(STORAGE_KEY);
    if (!done) {
      setTimeout(() => setShowTour(true), 600);
    }
  }, []);

  const handleLogout = async () => {
    // 서버 로그아웃이 실패해도 로컬 세션은 지운다 — 못 나가는 것보다 낫다
      try { await authApi.logout(); } catch { /* 무시 */ }
    logout();
    navigate('/login');
  };

  const pathSegments = location.pathname.split('/').filter(Boolean);
  const hideGlobalBreadcrumb =
    (pathSegments[0] === 'policies' && pathSegments.length >= 2) || pathSegments[0] === 'admin';
  const policyIdInPath = useMemo(() => {
    if (pathSegments[0] !== 'policies') return null;
    return pathSegments[1] || null;
  }, [pathSegments]);
  const { data: policyForBreadcrumb } = useQuery({
    queryKey: ['breadcrumb-policy-title', policyIdInPath],
    queryFn: () => policiesApi.get(policyIdInPath!),
    enabled: !!policyIdInPath,
    staleTime: 60_000,
  });
  const breadcrumbMap: Record<string, string> = useMemo(
    () => ({
      policies: t('layout.nav.policies'),
      search: t('layout.nav.search'),
      variables: t('layout.nav.variables'),
      settings: t('layout.nav.settings'),
      integrations: t('layout.nav.integrations'),
      about: t('layout.nav.about'),
    }),
    [t, locale],
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* 상단 헤더 */}
      <header className="bg-navy-900 text-white">
        <div className="bg-navy-900 border-b border-navy-700">
          <div className="flex items-center justify-between px-4 h-12">
            <div className="flex items-center gap-3">
              <button
                className="p-1.5 rounded hover:bg-navy-700 lg:hidden"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
              <AppBrandLockup variant="app" />
            </div>

            <div className="flex items-center gap-2 sm:gap-3 text-sm flex-shrink-0" id="tour-user-info">
              <NotificationBell />
              <UserMenu
                onOpenPlan={() => setShowPlanModal(true)}
                onOpenTour={() => setShowTour(true)}
                onLogout={handleLogout}
              />
            </div>
          </div>
        </div>

        {/* 데스크탑 네비게이션 */}
        <nav className="hidden lg:flex px-4 bg-navy-800">
          {navItems.map(({ path, label, icon: Icon, id }) => {
            const active = path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
            return (
              <Link
                key={path}
                to={path}
                id={id}
                className={clsx(
                  'flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors',
                  active
                    ? 'border-gold-500 text-white'
                    : 'border-transparent text-navy-300 hover:text-white hover:border-navy-400',
                )}
              >
                <Icon size={15} />
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="flex flex-1">
        {/* 모바일 사이드바 */}
        <aside
          className={clsx(
            'bg-navy-800 text-white w-56 flex-shrink-0 flex flex-col transition-transform duration-200',
            'fixed inset-y-0 z-30 lg:hidden',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          )}
          style={{ top: '48px' }}
        >
          <nav className="flex-1 py-2">
            {navItems.map(({ path, label, icon: Icon, id }) => {
              const active = path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
              return (
                <Link
                  key={path}
                  to={path}
                  id={id + '-mobile'}
                  onClick={() => setSidebarOpen(false)}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 text-sm transition-colors',
                    active
                      ? 'bg-navy-700 text-white border-l-2 border-gold-500'
                      : 'text-navy-300 hover:bg-navy-700 hover:text-white',
                  )}
                >
                  <Icon size={16} />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="p-4 border-t border-navy-700">
            <button
              onClick={() => { setSidebarOpen(false); setShowPlanModal(true); }}
              className="w-full text-left text-xs text-navy-400 hover:text-white"
            >
              <span className="text-navy-400">{t('layout.mobilePlan')} </span>
              <span className="bg-gold-500 text-white px-2 py-0.5 rounded font-medium ml-1">
                {user?.plan && isPlanTier(user.plan) ? planLabel[user.plan] : user?.plan}
              </span>
            </button>
          </div>
        </aside>

        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* 메인 컨텐츠 */}
        <main className="flex-1 flex flex-col min-w-0">
          {!hideGlobalBreadcrumb && pathSegments.length > 0 && (
            <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-2">
              <div className="flex items-center gap-1 text-xs text-gray-500 max-w-6xl mx-auto">
                <Link to="/" className="hover:text-navy-700 hover:underline">
                  {t('layout.breadcrumb.home')}
                </Link>
                {pathSegments.map((seg, i) => {
                  const isPolicyId = pathSegments[0] === 'policies' && i === 1;
                  const label = isPolicyId
                    ? policyForBreadcrumb?.title || t('layout.nav.policies')
                    : breadcrumbMap[seg] || seg;
                  return (
                    <span key={i + '-' + seg} className="flex items-center gap-1 min-w-0">
                      <ChevronRight size={12} className="shrink-0" />
                      <span className="text-gray-700 truncate">{label}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex-1 p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>

      <AppFooterBranding />

      {/* 모달들 */}
      {showPlanModal && <PlanModal onClose={() => setShowPlanModal(false)} />}
      {showTour && <OnboardingTour onFinish={() => setShowTour(false)} />}
    </div>
  );
}

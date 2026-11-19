import { Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useTenantBrandingSync } from '../hooks/useTenantBrandingSync';
import { authApi } from '../api/auth';
import TenantNameLabel from './TenantNameLabel';
import { Menu, X } from 'lucide-react';
import UserMenu from './UserMenu';
import { DesktopNav, MobileNav } from './TopNav';
import Breadcrumbs from './Breadcrumbs';
import { useState, useEffect, useMemo } from 'react';
import { clsx } from 'clsx';
import PlanModal from './PlanModal';
import ProfileModal from './ProfileModal';
import OnboardingTour, { STORAGE_KEY } from './OnboardingTour';
import { useI18n } from '../i18n/useI18n';
import { AppBrandLockup } from './AppBrandLockup';
import AppFooterBranding from './AppFooterBranding';
import NotificationBell from './NotificationBell';

type PlanTier = 'starter' | 'pro' | 'enterprise';

function isPlanTier(value: string): value is PlanTier {
  return value === 'starter' || value === 'pro' || value === 'enterprise';
}

export default function Layout() {
  const { t, locale } = useI18n();
  const { user, logout } = useAuthStore();
  useTenantBrandingSync();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showTour, setShowTour] = useState(false);

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

  // 관리자가 이름·이메일·역할을 바꿨다면 저장소에 남은 값은 지난 로그인 때의 것이다.
  // 화면을 열 때 한 번 서버 값으로 맞춘다. 권한 자체는 서버가 요청마다 DB 에서 다시 읽으므로
  // 이미 최신이고, 여기서 맞추는 것은 화면에 보이는 이름·회사 이름(상단바, T-217)과 메뉴 노출이다.
  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then((fresh) => {
        if (cancelled || !fresh) return;
        const current = useAuthStore.getState().user;
        if (!current || current.id !== fresh.id) return;
        const mustChangePassword = fresh.mustChangePassword === true;
        const tenantName = typeof fresh.tenantName === 'string' ? fresh.tenantName : current.tenantName;
        if (
          current.name === fresh.name &&
          current.email === fresh.email &&
          current.role === fresh.role &&
          current.tenantName === tenantName &&
          (current.mustChangePassword === true) === mustChangePassword
        ) {
          return;
        }
        useAuthStore.getState().setUser({
          ...current,
          name: fresh.name,
          email: fresh.email,
          role: fresh.role,
          tenantName,
          mustChangePassword,
        });
      })
      .catch(() => {
        // 만료·오프라인은 다른 요청이 같은 경로(갱신 → 로그인 화면)로 처리한다
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    // 서버 로그아웃이 실패해도 로컬 세션은 지운다 — 못 나가는 것보다 낫다
      try { await authApi.logout(); } catch { /* 무시 */ }
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* 상단 헤더 */}
      <header className="bg-navy-900 text-white">
        <div className="bg-navy-900 border-b border-navy-700">
          <div className="flex items-center justify-between px-4 h-12">
            <div className="flex min-w-0 items-center gap-3">
              <button
                className="p-1.5 rounded hover:bg-navy-700 lg:hidden"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
              <AppBrandLockup variant="app" />
              <TenantNameLabel />
            </div>

            <div className="flex items-center gap-2 sm:gap-3 text-sm flex-shrink-0" id="tour-user-info">
              <NotificationBell />
              <UserMenu
                onOpenProfile={() => setShowProfileModal(true)}
                onOpenPlan={() => setShowPlanModal(true)}
                onOpenTour={() => setShowTour(true)}
                onLogout={handleLogout}
              />
            </div>
          </div>
        </div>

        {/* 데스크탑 네비게이션 — 업무 메뉴와 '관리' 묶음(T-214, components/TopNav) */}
        <DesktopNav />
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
          <MobileNav onNavigate={() => setSidebarOpen(false)} />
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
          {/* 경로 표시 — 메뉴와 같은 이름, 상세는 대상 이름(T-212, lib/routeSections) */}
          <Breadcrumbs />

          <div className="flex-1 p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>

      <AppFooterBranding />

      {/* 모달들 */}
      {showPlanModal && <PlanModal onClose={() => setShowPlanModal(false)} />}
      {showProfileModal && <ProfileModal onClose={() => setShowProfileModal(false)} />}
      {showTour && <OnboardingTour onFinish={() => setShowTour(false)} />}
    </div>
  );
}

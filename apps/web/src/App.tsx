import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import PoliciesPage from './pages/PoliciesPage';
import PolicyImportPage from './pages/PolicyImportPage';
import PolicyDetailPage from './pages/PolicyDetailPage';
import ReparseReviewPage from './pages/ReparseReviewPage';
import SearchPage from './pages/SearchPage';
import AskPage from './pages/AskPage';
import VariablesPage from './pages/VariablesPage';
import SettingsPage from './pages/SettingsPage';
import AboutPage from './pages/AboutPage';
import IntegrationsPage from './pages/IntegrationsPage';
import PlatformAdminPage from './pages/PlatformAdminPage';
import AuditLogPage from './pages/AuditLogPage';
import LawsPage from './pages/LawsPage';
import LawDetailPage from './pages/LawDetailPage';
import AmendmentsPage from './pages/AmendmentsPage';
import AmendmentDetailPage from './pages/AmendmentDetailPage';
import ToastHost from './components/ui/ToastHost';
import ForcePasswordChangePage from './pages/ForcePasswordChangePage';
import { privateRouteRedirect } from './lib/viewerAccess';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { isAuthenticated, user, hasHydrated } = useAuthStore();
  if (!hasHydrated) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // 남이 정해 준 비밀번호를 바꾸기 전에는 어떤 화면도 열지 않는다(서버도 같은 상태에서 막는다)
  if (user?.mustChangePassword) return <ForcePasswordChangePage />;

  // 열람자 허용 화면·통합 관리 화면 판정은 메뉴(Layout)와 같은 곳에서 한다 — lib/viewerAccess (T-172)
  const redirect = privateRouteRedirect(user, location.pathname);
  if (redirect) return <Navigate to={redirect} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastHost />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        {/* 구글 로그인은 없앴다(T-136) — 예전 콜백 주소로 들어오면 로그인 화면으로 */}
        <Route path="/oauth/callback" element={<Navigate to="/login" replace />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="policies" element={<PoliciesPage />} />
          {/* :id보다 먼저 둬야 "import"가 규정 ID로 잡히지 않는다 */}
          <Route path="policies/import" element={<PolicyImportPage />} />
          <Route path="policies/:id" element={<PolicyDetailPage />} />
          <Route path="policies/:id/reparse/:reviewId" element={<ReparseReviewPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="ask" element={<AskPage />} />
          <Route path="variables" element={<VariablesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="audit-logs" element={<AuditLogPage />} />
          <Route path="laws" element={<LawsPage />} />
          <Route path="laws/:id" element={<LawDetailPage />} />
          <Route path="amendments" element={<AmendmentsPage />} />
          <Route path="amendments/:id" element={<AmendmentDetailPage />} />
          <Route path="admin" element={<PlatformAdminPage />} />
          <Route path="platform-admin" element={<PlatformAdminPage />} />
          <Route path="about" element={<AboutPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
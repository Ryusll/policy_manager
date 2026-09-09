import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage';
import DashboardPage from './pages/DashboardPage';
import PoliciesPage from './pages/PoliciesPage';
import PolicyImportPage from './pages/PolicyImportPage';
import PolicyDetailPage from './pages/PolicyDetailPage';
import SearchPage from './pages/SearchPage';
import VariablesPage from './pages/VariablesPage';
import SettingsPage from './pages/SettingsPage';
import AboutPage from './pages/AboutPage';
import IntegrationsPage from './pages/IntegrationsPage';
import PlatformAdminPage from './pages/PlatformAdminPage';
import AuditLogPage from './pages/AuditLogPage';
import ToastHost from './components/ui/ToastHost';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { isAuthenticated, user, hasHydrated } = useAuthStore();
  if (!hasHydrated) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (user?.role === 'viewer') {
    const allowed =
      location.pathname.startsWith('/search') ||
      location.pathname.startsWith('/policies/') ||
      location.pathname.startsWith('/about');
    if (!allowed) return <Navigate to="/search" replace />;
  }
  if (
    (location.pathname.startsWith('/platform-admin') || location.pathname.startsWith('/admin')) &&
    user?.platformRole !== 'global_admin'
  ) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastHost />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
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
          <Route path="search" element={<SearchPage />} />
          <Route path="variables" element={<VariablesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="audit-logs" element={<AuditLogPage />} />
          <Route path="admin" element={<PlatformAdminPage />} />
          <Route path="platform-admin" element={<PlatformAdminPage />} />
          <Route path="about" element={<AboutPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
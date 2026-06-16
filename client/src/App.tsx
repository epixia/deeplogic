// App shell: glow backdrop + sticky nav + React Router routes, all wrapped in
// <AuthProvider>. Public routes (home / login / signup) + guarded /app routes.

import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import RequireAuth from './auth/RequireAuth'
import RequireAdmin from './auth/RequireAdmin'
import Nav from './components/Nav'
import Home from './pages/Home'
import Demo from './pages/Demo'
import Pricing from './pages/Pricing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import AcceptInvite from './pages/AcceptInvite'
import Onboarding from './pages/Onboarding'
import Ingest from './pages/Ingest'
import Dashboard from './pages/Dashboard'
import Mission from './pages/Mission'
import Settings from './pages/Settings'
import Studio from './pages/Studio'
import StudioEditor from './pages/StudioEditor'
import Vault from './pages/Vault'
import Dashboards from './pages/Dashboards'
import DashboardsList from './pages/DashboardsList'
import DashboardEditor from './pages/DashboardEditor'
import WidgetEditor from './pages/WidgetEditor'
import Agents from './pages/Agents'
import Alerts from './pages/Alerts'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminOrgs from './pages/admin/AdminOrgs'
import AdminOrgDetail from './pages/admin/AdminOrgDetail'
import AdminUsers from './pages/admin/AdminUsers'

// '/app' index: resolve the user's first org -> its ingest page, else onboarding.
function AppIndex() {
  const { orgs, loading } = useAuth()
  if (loading) {
    return (
      <main className="wrap">
        <div className="placeholder-panel">
          <div className="dl-spinner" />
          <h2>Loading…</h2>
        </div>
      </main>
    )
  }
  if (orgs.length > 0) {
    return <Navigate to={`/app/${orgs[0].id}/dashboards`} replace />
  }
  return <Navigate to="/onboarding" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <div className="glow" />
      <Nav />
      <Routes>
        {/* public */}
        <Route path="/" element={<Home />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/demo/:demoId" element={<Demo />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />

        {/* authenticated (no org required) */}
        <Route element={<RequireAuth />}>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/app" element={<AppIndex />} />

          {/* org-scoped */}
          <Route path="/app/:orgId/ingest" element={<Ingest />} />
          <Route path="/app/:orgId/dashboard/:modelId" element={<Dashboard />} />
          <Route path="/app/:orgId/mission/:modelId" element={<Mission />} />
          <Route path="/app/:orgId/settings" element={<Settings />} />
          <Route path="/app/:orgId/vault" element={<Vault />} />
          <Route path="/app/:orgId/studio" element={<Studio />} />
          <Route path="/app/:orgId/studio/:projectId" element={<StudioEditor />} />
          <Route path="/app/:orgId/widgets" element={<Dashboards />} />
          <Route path="/app/:orgId/widgets/:widgetId" element={<WidgetEditor />} />
          <Route path="/app/:orgId/dashboards" element={<DashboardsList />} />
          <Route path="/app/:orgId/dashboards/:dashboardId" element={<DashboardEditor />} />
          <Route path="/app/:orgId/agents" element={<Agents />} />
          <Route path="/app/:orgId/alerts" element={<Alerts />} />
        </Route>

        {/* super-admin (requires auth + admin email) */}
        <Route element={<RequireAuth />}>
          <Route element={<RequireAdmin><Outlet /></RequireAdmin>}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/orgs" element={<AdminOrgs />} />
            <Route path="/admin/orgs/:orgId" element={<AdminOrgDetail />} />
            <Route path="/admin/users" element={<AdminUsers />} />
          </Route>
        </Route>

        {/* fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

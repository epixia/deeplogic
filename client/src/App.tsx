// App shell: glow backdrop + sticky nav + React Router routes, all wrapped in
// <AuthProvider>. Public routes (home / login / signup) + guarded /app routes.

import { useEffect, useState } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { listDashboards } from './lib/api'
import RequireAuth from './auth/RequireAuth'
import RequireAdmin from './auth/RequireAdmin'
import Nav from './components/Nav'
import GlobalChat from './components/GlobalChat'
import AgentActivityToasts from './components/AgentActivityToasts'
import AppShell from './components/AppShell'
import ThemeManager from './components/ThemeManager'
import Home from './pages/Home'
import Demo from './pages/Demo'
import Pricing from './pages/Pricing'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
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
import Memory from './pages/Memory'
import SiteInsights from './pages/SiteInsights'
import Dashboards from './pages/Dashboards'
import DashboardsList from './pages/DashboardsList'
import DashboardsManage from './pages/DashboardsManage'
import DashboardEditor from './pages/DashboardEditor'
import WidgetEditor from './pages/WidgetEditor'
import Agents from './pages/Agents'
import Goals from './pages/Goals'
import Activity from './pages/Activity'
import Alerts from './pages/Alerts'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminOrgs from './pages/admin/AdminOrgs'
import AdminOrgDetail from './pages/admin/AdminOrgDetail'
import AdminUsers from './pages/admin/AdminUsers'
import AdminUserDetail from './pages/admin/AdminUserDetail'

// '/app' index: open the user's company dashboard (the Company-group board the
// onboarding creates, else their first board), else the dashboards list, else
// onboarding when they have no workspace yet.
function AppIndex() {
  const { orgs, loading, getAccessToken } = useAuth()
  const [dest, setDest] = useState<string | null>(null)

  useEffect(() => {
    if (loading || orgs.length === 0) return
    let active = true
    const orgId = orgs[0].id
    const fallback = `/app/${orgId}/dashboards`
    void (async () => {
      try {
        const t = await getAccessToken()
        if (!t) { if (active) setDest(fallback); return }
        const boards = await listDashboards(t, orgId)
        if (!active) return
        const isCompetitor = (g: string | null) => (g ?? '').toLowerCase() === 'competitors'
        // Prefer the Company board; else the first NON-competitor board; never a
        // competitor board. If only competitor boards exist, show the list.
        const company =
          boards.find((b) => (b.group ?? '').toLowerCase() === 'company') ??
          boards.find((b) => !isCompetitor(b.group))
        setDest(company ? `/app/${orgId}/dashboards/${company.id}` : fallback)
      } catch {
        if (active) setDest(fallback)
      }
    })()
    return () => { active = false }
  }, [loading, orgs, getAccessToken])

  const loadingView = (
    <main className="wrap">
      <div className="placeholder-panel">
        <div className="dl-spinner" />
        <h2>Loading…</h2>
      </div>
    </main>
  )

  if (loading) return loadingView
  if (orgs.length === 0) return <Navigate to="/onboarding" replace />
  if (!dest) return loadingView // resolving which dashboard to open
  return <Navigate to={dest} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeManager />
      <div className="glow" />
      <Nav />
      <Routes>
        {/* public */}
        <Route path="/" element={<Home />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/demo/:demoId" element={<Demo />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />
        {/* public: value-first onboarding analyses a website before any account */}
        <Route path="/onboarding" element={<Onboarding />} />

        {/* authenticated (no org required) */}
        <Route element={<RequireAuth />}>
          <Route path="/app" element={<AppIndex />} />

          {/* org-scoped — wrapped in the app shell so the dashboard sidebar is
              persistent on every page */}
          <Route element={<AppShell />}>
            <Route path="/app/:orgId/ingest" element={<Ingest />} />
            <Route path="/app/:orgId/dashboard/:modelId" element={<Dashboard />} />
            <Route path="/app/:orgId/mission/:modelId" element={<Mission />} />
            <Route path="/app/:orgId/settings" element={<Settings />} />
            <Route path="/app/:orgId/vault" element={<Vault />} />
            <Route path="/app/:orgId/memory" element={<Memory />} />
            <Route path="/app/:orgId/site" element={<SiteInsights />} />
            <Route path="/app/:orgId/studio" element={<Studio />} />
            <Route path="/app/:orgId/studio/:projectId" element={<StudioEditor />} />
            <Route path="/app/:orgId/widgets" element={<Dashboards />} />
            <Route path="/app/:orgId/widgets/:widgetId" element={<WidgetEditor />} />
            <Route path="/app/:orgId/dashboards" element={<DashboardsList />} />
            <Route path="/app/:orgId/dashboards/manage" element={<DashboardsManage />} />
            <Route path="/app/:orgId/dashboards/:dashboardId" element={<DashboardEditor />} />
            <Route path="/app/:orgId/agents" element={<Agents />} />
            <Route path="/app/:orgId/goals" element={<Goals />} />
            <Route path="/app/:orgId/activity" element={<Activity />} />
            <Route path="/app/:orgId/alerts" element={<Alerts />} />
          </Route>
        </Route>

        {/* super-admin (requires auth + admin email) */}
        <Route element={<RequireAuth />}>
          <Route element={<RequireAdmin><Outlet /></RequireAdmin>}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/orgs" element={<AdminOrgs />} />
            <Route path="/admin/orgs/:orgId" element={<AdminOrgDetail />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/users/:userId" element={<AdminUserDetail />} />
          </Route>
        </Route>

        {/* fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <GlobalChat />
      <AgentActivityToasts />
    </AuthProvider>
  )
}

// App shell: glow backdrop + sticky nav + React Router routes, all wrapped in
// <AuthProvider>. Public routes (home / login / signup) + guarded /app routes.

import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import RequireAuth from './auth/RequireAuth'
import Nav from './components/Nav'
import Home from './pages/Home'
import Demo from './pages/Demo'
import Pricing from './pages/Pricing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Onboarding from './pages/Onboarding'
import Ingest from './pages/Ingest'
import Dashboard from './pages/Dashboard'
import Mission from './pages/Mission'
import Settings from './pages/Settings'
import Studio from './pages/Studio'
import StudioEditor from './pages/StudioEditor'
import Vault from './pages/Vault'

// '/app' index: resolve the user's first org → its ingest page, else onboarding.
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
    return <Navigate to={`/app/${orgs[0].id}/ingest`} replace />
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

        {/* authenticated (no org required) */}
        <Route element={<RequireAuth />}>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/app" element={<AppIndex />} />

          {/* org-scoped */}
          <Route path="/app/:orgId/ingest" element={<Ingest />} />
          <Route
            path="/app/:orgId/dashboard/:modelId"
            element={<Dashboard />}
          />
          <Route path="/app/:orgId/mission/:modelId" element={<Mission />} />
          <Route path="/app/:orgId/settings" element={<Settings />} />
          <Route path="/app/:orgId/vault" element={<Vault />} />
          <Route path="/app/:orgId/studio" element={<Studio />} />
          <Route
            path="/app/:orgId/studio/:projectId"
            element={<StudioEditor />}
          />
        </Route>

        {/* fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

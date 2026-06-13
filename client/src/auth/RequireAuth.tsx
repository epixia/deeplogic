// Route guard: redirects to /login when there is no session. While the initial
// session is still being restored it shows a lightweight loading state so we
// don't flash the login page for already-authenticated users.

import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'

export default function RequireAuth({ children }: { children?: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()

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

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <>{children ?? <Outlet />}</>
}

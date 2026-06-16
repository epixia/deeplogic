// RequireAdmin — guards all /admin/* routes.
// Calls /api/admin/me; renders children on 200, redirects on 401/403.

import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { adminMe } from '../lib/api'

type State = 'loading' | 'ok' | 'unauth' | 'forbidden'

export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { session, loading: authLoading, getAccessToken } = useAuth()
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    if (authLoading) return
    if (!session) { setState('unauth'); return }

    getAccessToken().then((token) => {
      if (!token) { setState('unauth'); return }
      adminMe(token)
        .then(() => setState('ok'))
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : ''
          setState(msg.includes('403') || msg.includes('Admin') ? 'forbidden' : 'unauth')
        })
    })
  }, [session, authLoading, getAccessToken])

  if (authLoading || state === 'loading') {
    return (
      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="dl-spinner" />
      </main>
    )
  }
  if (state === 'unauth')    return <Navigate to="/login"  replace />
  if (state === 'forbidden') return <Navigate to="/app"    replace />
  return <>{children}</>
}

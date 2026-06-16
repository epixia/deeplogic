// Onboarding — create the first organization. POST /api/orgs both creates the
// org (caller becomes owner) and seeds the two sample models server-side. On
// success we refresh memberships and route into the org's dashboard.
//
// If the user already belongs to an org (e.g. revisiting the page), bounce them
// straight to that org.

import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { createOrg } from '../lib/api'
import Logo from '../components/Logo'
import './auth.css'

export default function Onboarding() {
  const { orgs, getAccessToken, refreshOrgs, loading } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!name) setName('My Dashboard')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Already onboarded → go to the first org's dashboards.
  if (!loading && !busy && orgs.length > 0) {
    return <Navigate to={`/app/${orgs[0].id}/dashboards`} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Give your dashboard a name.')
      return
    }
    setBusy(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Your session expired — please sign in again.')
      const org = await createOrg(token, trimmed)
      await refreshOrgs()
      navigate(`/app/${org.id}/dashboards`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create dashboard.')
      setBusy(false)
    }
  }

  return (
    <main className="dl-auth">
      <div className="dl-auth__card">
        <div className="dl-auth__head">
          <Logo size={44} title="DeepLogic" />
          <h1>Name your dashboard</h1>
          <p>
            We'll seed it with two sample reports so you can explore right away.
          </p>
        </div>

        <form className="dl-auth__form" onSubmit={onSubmit}>
          {error && (
            <div className="dl-auth__error" role="alert">
              {error}
            </div>
          )}

          <div className="dl-field">
            <label htmlFor="orgname">Dashboard name</label>
            <input
              id="orgname"
              className="dl-input"
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Analytics"
            />
          </div>

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Creating dashboard…' : 'Create dashboard'}
          </button>
        </form>
      </div>
    </main>
  )
}

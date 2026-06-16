// Accept an org invitation. Verifies the token, then:
//   - If not logged in → redirects to /signup?invite=TOKEN (or /login?invite=TOKEN)
//   - If logged in     → calls POST /api/invite/:token/accept, then navigates to the org.

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { verifyInviteToken, acceptInviteToken } from '../lib/api'
import Logo from '../components/Logo'
import './auth.css'

interface InviteInfo {
  orgId: string
  orgName: string
  email: string
  role: string
  expiresAt: string
}

export default function AcceptInvite() {
  const { token = '' } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user, getAccessToken, refreshOrgs } = useAuth()

  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  // Verify the token on mount (public fetch — no auth needed).
  useEffect(() => {
    verifyInviteToken(token)
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : 'Invalid invitation'))
  }, [token])

  async function accept() {
    setBusy(true)
    setError(null)
    try {
      const accessToken = await getAccessToken()
      if (!accessToken) throw new Error('Session expired — please sign in again.')
      const { orgId } = await acceptInviteToken(accessToken, token)
      await refreshOrgs()
      setDone(true)
      setTimeout(() => navigate(`/app/${orgId}/ingest`, { replace: true }), 1200)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to accept invitation')
    } finally {
      setBusy(false)
    }
  }

  if (!info && !error) {
    return (
      <main className="dl-auth">
        <div className="dl-auth__card">
          <div className="dl-auth__head">
            <Logo size={44} title="DeepLogic" />
            <div className="dl-spinner" style={{ margin: '24px auto' }} />
            <p>Verifying invitation…</p>
          </div>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="dl-auth">
        <div className="dl-auth__card">
          <div className="dl-auth__head">
            <Logo size={44} title="DeepLogic" />
            <h1>Invitation invalid</h1>
          </div>
          <div className="dl-auth__error" role="alert">{error}</div>
          <div className="dl-auth__foot">
            <Link to="/">Back to home</Link>
          </div>
        </div>
      </main>
    )
  }

  if (done) {
    return (
      <main className="dl-auth">
        <div className="dl-auth__card">
          <div className="dl-auth__head">
            <Logo size={44} title="DeepLogic" />
            <h1>You're in!</h1>
            <p>Redirecting to <strong>{info!.orgName}</strong>…</p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="dl-auth">
      <div className="dl-auth__card">
        <div className="dl-auth__head">
          <Logo size={44} title="DeepLogic" />
          <h1>You're invited</h1>
          <p>
            Join <strong>{info!.orgName}</strong> as <strong>{info!.role}</strong>.
          </p>
        </div>

        {error && (
          <div className="dl-auth__error" role="alert">{error}</div>
        )}

        {user ? (
          <>
            <p style={{ textAlign: 'center', color: 'var(--c-muted)', fontSize: '14px' }}>
              Signed in as <strong>{user.email}</strong>
            </p>
            <button
              className="btn btn-primary"
              onClick={accept}
              disabled={busy}
              style={{ width: '100%', marginTop: '8px' }}
            >
              {busy ? 'Joining…' : `Join ${info!.orgName}`}
            </button>
          </>
        ) : (
          <>
            <p style={{ textAlign: 'center', color: 'var(--c-muted)', fontSize: '14px' }}>
              Create an account or sign in to join.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
              <Link className="btn btn-primary" to={`/signup?invite=${token}`}>
                Create account &amp; join
              </Link>
              <Link className="btn btn-secondary" to={`/login?invite=${token}`}>
                Sign in &amp; join
              </Link>
            </div>
          </>
        )}

        <div className="dl-auth__foot">
          Invitation for <strong>{info!.email}</strong> ·{' '}
          expires {new Date(info!.expiresAt).toLocaleDateString()}
        </div>
      </div>
    </main>
  )
}

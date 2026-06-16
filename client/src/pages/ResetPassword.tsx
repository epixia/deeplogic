// Reset password — the destination of the email link. The browser client has
// detectSessionInUrl:false, so we manually consume the recovery token from the
// URL (hash tokens for implicit flow, ?code= for PKCE), establish the recovery
// session, then let the user set a new password.

import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import Logo from '../components/Logo'
import './auth.css'

type Phase = 'checking' | 'ready' | 'invalid' | 'done'

export default function ResetPassword() {
  const { updatePassword, signOut } = useAuth()
  const navigate = useNavigate()

  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Consume the recovery token on mount and open a recovery session.
  useEffect(() => {
    let active = true
    async function init() {
      const hash = window.location.hash.replace(/^#/, '')
      const hp = new URLSearchParams(hash)
      const qp = new URLSearchParams(window.location.search)

      const errDesc = hp.get('error_description') || qp.get('error_description')
      if (errDesc) {
        if (active) {
          setError(errDesc)
          setPhase('invalid')
        }
        return
      }

      const accessToken = hp.get('access_token')
      const refreshToken = hp.get('refresh_token')
      const code = qp.get('code')

      try {
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (error) throw error
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
        } else {
          // No token in the URL — only valid if a recovery session is already live.
          const { data } = await supabase.auth.getSession()
          if (!data.session) {
            if (active) {
              setError('This reset link is invalid or has expired. Request a new one.')
              setPhase('invalid')
            }
            return
          }
        }
        // Strip the token from the address bar so it isn't bookmarked/shared.
        window.history.replaceState(null, '', window.location.pathname)
        if (active) setPhase('ready')
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Invalid or expired link.')
          setPhase('invalid')
        }
      }
    }
    void init()
    return () => {
      active = false
    }
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords don’t match.')
      return
    }
    setBusy(true)
    const { error } = await updatePassword(password)
    if (error) {
      setBusy(false)
      setError(error)
      return
    }
    // Force a clean re-login with the new credentials.
    await signOut()
    setBusy(false)
    setPhase('done')
  }

  return (
    <main className="dl-auth">
      <div className="dl-auth__card">
        <div className="dl-auth__head">
          <Logo size={44} title="DeepLogic" />
          <h1>Set a new password</h1>
          <p>
            {phase === 'done'
              ? 'Your password has been updated.'
              : 'Choose a strong password you don’t use elsewhere.'}
          </p>
        </div>

        {phase === 'checking' && (
          <div className="placeholder-panel" style={{ textAlign: 'center' }}>
            <div className="dl-spinner" />
            <p style={{ color: 'var(--mut)', fontSize: 14 }}>Verifying your link…</p>
          </div>
        )}

        {phase === 'invalid' && (
          <>
            <div className="dl-auth__error" role="alert">
              {error ?? 'This reset link is invalid or has expired.'}
            </div>
            <div className="dl-auth__foot">
              <Link to="/forgot-password">Request a new link</Link>
            </div>
          </>
        )}

        {phase === 'ready' && (
          <form className="dl-auth__form" onSubmit={onSubmit}>
            {error && (
              <div className="dl-auth__error" role="alert">
                {error}
              </div>
            )}

            <div className="dl-field">
              <label htmlFor="password">New password</label>
              <input
                id="password"
                className="dl-input"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="dl-field">
              <label htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                className="dl-input"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>

            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}

        {phase === 'done' && (
          <>
            <div className="dl-auth__success" role="status">
              Password updated. You can now sign in with your new password.
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => navigate('/login', { replace: true })}
            >
              Go to sign in
            </button>
          </>
        )}
      </div>
    </main>
  )
}

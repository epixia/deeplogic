// Login — email + password sign-in. On success, route to /app, which resolves
// the user's first org (or onboarding).

import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import Logo from '../components/Logo'
import './auth.css'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname?: string } } | null)?.from
    ?.pathname

  const [email, setEmail] = useState(() => localStorage.getItem('dl_last_email') ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    localStorage.setItem('dl_last_email', email.trim())
    const { error } = await signIn(email.trim(), password)
    setBusy(false)
    if (error) {
      setError(error)
      return
    }
    navigate(from && from.startsWith('/app') ? from : '/app', { replace: true })
  }

  return (
    <main className="dl-auth">
      <div className="dl-auth__card">
        <div className="dl-auth__head">
          <Logo size={44} title="DeepLogic" />
          <h1>Welcome back</h1>
          <p>Sign in to your DeepLogic control room.</p>
        </div>

        <form className="dl-auth__form" onSubmit={onSubmit}>
          {error && (
            <div className="dl-auth__error" role="alert">
              {error}
            </div>
          )}

          <div className="dl-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="dl-input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="dl-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="dl-input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="dl-auth__foot">
          No account yet? <Link to="/signup">Create one</Link>
        </div>
      </div>
    </main>
  )
}

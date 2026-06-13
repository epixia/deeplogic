// Signup — email + password registration. On success the user is signed in
// immediately (local Supabase, email confirmation off); we send them to
// /onboarding to create their first org. If they somehow already have orgs,
// /app resolves the first one.

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import Logo from '../components/Logo'
import './auth.css'

export default function Signup() {
  const { signUp } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setBusy(true)
    const { error } = await signUp(email.trim(), password)
    setBusy(false)
    if (error) {
      setError(error)
      return
    }
    // Fresh accounts have no orgs yet → onboarding creates the first one.
    navigate('/onboarding', { replace: true })
  }

  return (
    <main className="dl-auth">
      <div className="dl-auth__card">
        <div className="dl-auth__head">
          <Logo size={44} title="DeepLogic" />
          <h1>Create your account</h1>
          <p>Spin up a DeepLogic workspace in seconds.</p>
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
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <div className="dl-auth__foot">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </main>
  )
}

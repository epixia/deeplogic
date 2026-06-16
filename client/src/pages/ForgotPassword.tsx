// Forgot password — request a reset email. On success we show a confirmation
// (the email lands in the local Inbucket inbox at http://localhost:54324 in dev)
// and never reveal whether the address exists.

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import Logo from '../components/Logo'
import './auth.css'

export default function ForgotPassword() {
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState(
    () => localStorage.getItem('dl_last_email') ?? '',
  )
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await resetPassword(email.trim())
    setBusy(false)
    // Don't leak account existence — show the same confirmation regardless.
    if (error) {
      setError(error)
      return
    }
    setSent(true)
  }

  return (
    <main className="dl-auth">
      <div className="dl-auth__card">
        <div className="dl-auth__head">
          <Logo size={44} title="DeepLogic" />
          <h1>Reset your password</h1>
          <p>
            {sent
              ? 'Check your inbox for the reset link.'
              : 'Enter your email and we’ll send you a link to set a new password.'}
          </p>
        </div>

        {sent ? (
          <>
            <div className="dl-auth__success" role="status">
              If an account exists for <strong>{email.trim()}</strong>, a
              password-reset link is on its way. The link expires shortly, so
              use it soon.
            </div>
            <div className="dl-auth__foot">
              <Link to="/login">Back to sign in</Link>
            </div>
          </>
        ) : (
          <>
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

              <button
                className="btn btn-primary"
                type="submit"
                disabled={busy}
              >
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <div className="dl-auth__foot">
              Remembered it? <Link to="/login">Sign in</Link>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

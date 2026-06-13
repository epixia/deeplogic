// Sticky top navigation shell: logo + DEEPLOGIC wordmark.
// Signed in  → OrgSwitcher + Settings link + Sign out (+ ThemeToggle).
// Signed out → Login / Signup (+ ThemeToggle).

import { Link, useNavigate, useParams } from 'react-router-dom'
import Logo from './Logo'
import ThemeToggle from './ThemeToggle'
import OrgSwitcher from './OrgSwitcher'
import { useAuth } from '../auth/AuthContext'

export default function Nav() {
  const { session, orgs, signOut } = useAuth()
  const { orgId } = useParams<{ orgId: string }>()
  const navigate = useNavigate()

  // Where the wordmark links: into the app when signed in, else home.
  const activeOrgId = orgId ?? orgs[0]?.id
  const brandTo = session
    ? activeOrgId
      ? `/app/${activeOrgId}/ingest`
      : '/app'
    : '/'

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <nav className="dl-nav">
      <div className="wrap nav">
        <Link to={brandTo} className="brand">
          <Logo size={30} className="mark" />
          DEEPLOGIC
        </Link>

        <div className="nav-actions">
          {session ? (
            <>
              <OrgSwitcher />
              {activeOrgId && (
                <Link
                  className="btn btn-ghost"
                  to={`/app/${activeOrgId}/studio`}
                >
                  Reports
                </Link>
              )}
              {activeOrgId && (
                <Link
                  className="btn btn-ghost"
                  to={`/app/${activeOrgId}/vault`}
                >
                  Vault
                </Link>
              )}
              {activeOrgId && (
                <Link
                  className="btn btn-ghost"
                  to={`/app/${activeOrgId}/settings`}
                >
                  Settings
                </Link>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleSignOut}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link className="btn btn-ghost" to="/pricing">
                Pricing
              </Link>
              <Link className="btn btn-ghost" to="/login">
                Login
              </Link>
              <Link className="btn btn-primary" to="/signup">
                Sign up
              </Link>
            </>
          )}
          <ThemeToggle />
        </div>
      </div>
    </nav>
  )
}

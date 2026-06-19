// Sticky top navigation shell: logo + DEEPLOGIC wordmark.
// Signed in  → OrgSwitcher + Settings link + UserMenu (+ ThemeToggle).
// Signed out → Login / Signup (+ ThemeToggle).

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Logo from './Logo'
import ThemeToggle from './ThemeToggle'
import { useAuth } from '../auth/AuthContext'
import { getBillingSubscription, getOpenRouterBalance, type OpenRouterBalance } from '../lib/api'

// ---------------------------------------------------------------------------
// TrialBadge — shows days remaining in the org's trial. Fetches billing once
// per orgId and caches in module state so re-renders don't re-fetch.
// ---------------------------------------------------------------------------

const trialCache = new Map<string, { daysLeft: number; fetchedAt: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 min

interface TrialBadgeProps {
  orgId: string
  getAccessToken: () => Promise<string | null>
}

function TrialBadge({ orgId, getAccessToken }: TrialBadgeProps) {
  const [daysLeft, setDaysLeft] = useState<number | null>(null)

  useEffect(() => {
    const cached = trialCache.get(orgId)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      setDaysLeft(cached.daysLeft)
      return
    }
    let cancelled = false
    getAccessToken().then((token) => {
      if (!token || cancelled) return
      getBillingSubscription(token, orgId)
        .then((sub) => {
          if (cancelled) return
          if (!sub.inTrial || !sub.trialEndsAt) { setDaysLeft(null); return }
          const days = Math.max(0, Math.ceil(
            (new Date(sub.trialEndsAt).getTime() - Date.now()) / 86_400_000
          ))
          trialCache.set(orgId, { daysLeft: days, fetchedAt: Date.now() })
          setDaysLeft(days)
        })
        .catch(() => null)
    })
    return () => { cancelled = true }
  }, [orgId, getAccessToken])

  if (daysLeft === null) return null

  const color =
    daysLeft <= 2 ? '#e07a8a' :
    daysLeft <= 7 ? '#f0a854' :
    'var(--c-muted)'

  return (
    <Link
      to={`/app/${orgId}/settings?tab=billing`}
      style={{
        fontSize: '12px',
        fontWeight: 600,
        color,
        border: `1px solid ${color}`,
        borderRadius: '99px',
        padding: '2px 10px',
        whiteSpace: 'nowrap',
        textDecoration: 'none',
      }}
      title="Upgrade before your trial ends"
    >
      {daysLeft === 0 ? 'Trial ending today' : `${daysLeft}d trial left`}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// OpenRouterBadge — live OpenRouter credit balance, polled every 60s.
// ---------------------------------------------------------------------------

function OpenRouterBadge({
  orgId,
  getAccessToken,
}: {
  orgId: string
  getAccessToken: () => Promise<string | null>
}) {
  const [bal, setBal] = useState<OpenRouterBalance | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const token = await getAccessToken()
      if (!token || cancelled) return
      try {
        const b = await getOpenRouterBalance(token, orgId)
        if (!cancelled) setBal(b)
      } catch {
        /* leave previous value */
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [orgId, getAccessToken])

  if (!bal || !bal.configured || typeof bal.remaining !== 'number') return null

  const remaining = bal.remaining
  const color = remaining <= 1 ? '#e07a8a' : remaining <= 5 ? '#f0a854' : 'var(--c-muted)'

  return (
    <a
      href="https://openrouter.ai/credits"
      target="_blank"
      rel="noreferrer"
      title={`OpenRouter credits — $${(bal.totalUsage ?? 0).toFixed(2)} used of $${(bal.totalCredits ?? 0).toFixed(2)}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        fontSize: '12px',
        fontWeight: 600,
        color,
        border: `1px solid ${color}`,
        borderRadius: '99px',
        padding: '2px 10px',
        whiteSpace: 'nowrap',
        textDecoration: 'none',
      }}
    >
      <span style={{ opacity: 0.7, fontWeight: 700, letterSpacing: '0.04em' }}>OR</span>
      ${remaining.toFixed(2)}
    </a>
  )
}

// ---------------------------------------------------------------------------
// UserMenu — avatar button with dropdown
// ---------------------------------------------------------------------------

const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)

function initials(email: string) {
  const [local] = email.split('@')
  const parts = local.split(/[._-]/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return local.slice(0, 2).toUpperCase()
}

function UserMenu({
  email,
  name,
  avatarUrl,
  activeOrgId,
  onSignOut,
}: {
  email: string
  name?: string
  avatarUrl?: string
  activeOrgId?: string
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isAdmin = ADMIN_EMAILS.includes(email)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="dl-user-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="User menu"
      >
        {avatarUrl
          ? <img className="dl-user-avatar dl-user-avatar--img" src={avatarUrl} alt="" />
          : <span className="dl-user-avatar">{initials(email)}</span>}
        <span className="dl-user-email">{name?.trim() || email}</span>
        <span className="dl-user-caret">▾</span>
      </button>

      {open && (
        <div className="dl-user-dropdown" onClick={() => setOpen(false)}>
          <div className="dl-user-dropdown-email">{email}</div>
          <div className="dl-user-dropdown-divider" />
          {activeOrgId && (
            <Link className="dl-user-dropdown-item" to={`/app/${activeOrgId}/settings`}>
              Settings
            </Link>
          )}
          <Link className="dl-user-dropdown-item" to="/reset-password">
            Change password
          </Link>
          {isAdmin && (
            <>
              <div className="dl-user-dropdown-divider" />
              <Link className="dl-user-dropdown-item dl-user-dropdown-item--admin" to="/admin">
                Admin dashboard
              </Link>
            </>
          )}
          <div className="dl-user-dropdown-divider" />
          <button type="button" className="dl-user-dropdown-item dl-user-dropdown-item--danger" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export default function Nav() {
  const { session, user, orgs, signOut, getAccessToken } = useAuth()
  const { pathname } = useLocation()
  const orgId = pathname.match(/^\/app\/([^/]+)/)?.[1]
  const navigate = useNavigate()

  const activeOrgId = orgId ?? orgs[0]?.id
  const brandTo = session
    ? activeOrgId
      ? `/app/${activeOrgId}/dashboards`
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
          <Logo size={44} className="mark" />
          DEEPLOGIC
        </Link>

        <div className="nav-actions">
          {session ? (
            <>
              {activeOrgId && (
                <Link className="btn btn-ghost" to={`/app/${activeOrgId}/dashboards/manage`}>
                  Dashboards
                </Link>
              )}
              {activeOrgId && (
                <Link className="btn btn-ghost" to={`/app/${activeOrgId}/studio`}>
                  Reports
                </Link>
              )}
              {activeOrgId && (
                <Link className="btn btn-ghost" to={`/app/${activeOrgId}/widgets`}>
                  Widgets
                </Link>
              )}
              {activeOrgId && (
                <Link className="btn btn-ghost" to={`/app/${activeOrgId}/alerts`}>
                  Alerts
                </Link>
              )}
              {activeOrgId && (
                <Link className="btn btn-ghost" to={`/app/${activeOrgId}/agents`}>
                  Agents
                </Link>
              )}
              {activeOrgId && (
                <Link className="btn btn-ghost" to={`/app/${activeOrgId}/goals`}>
                  Goals
                </Link>
              )}
              {activeOrgId && (
                <Link className="btn btn-ghost" to={`/app/${activeOrgId}/activity`}>
                  Activity
                </Link>
              )}
              {activeOrgId && (
                <Link className="btn btn-ghost" to={`/app/${activeOrgId}/vault`}>
                  Data Vault
                </Link>
              )}
              {activeOrgId && (
                <Link className="btn btn-ghost" to={`/app/${activeOrgId}/memory`}>
                  Memory
                </Link>
              )}
              {activeOrgId && (
                <OpenRouterBadge orgId={activeOrgId} getAccessToken={getAccessToken} />
              )}
              {activeOrgId && (
                <TrialBadge orgId={activeOrgId} getAccessToken={getAccessToken} />
              )}
              <UserMenu
                email={session.user.email ?? ''}
                name={user?.name}
                avatarUrl={user?.avatarUrl}
                activeOrgId={activeOrgId}
                onSignOut={handleSignOut}
              />
            </>
          ) : (
            <>
              <Link className="btn btn-ghost" to="/pricing">
                Pricing
              </Link>
              <Link className="btn btn-ghost" to="/login">
                Login
              </Link>
              <Link className="btn btn-primary" to="/onboarding">
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

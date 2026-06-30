// Sticky top navigation shell: logo + DEEPLOGIC wordmark.
// Signed in  → OrgSwitcher + Settings link + UserMenu (+ ThemeToggle).
// Signed out → Login / Signup (+ ThemeToggle).

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Logo from './Logo'
import ThemeToggle from './ThemeToggle'
import { useAuth } from '../auth/AuthContext'
import { getBillingSubscription, getOpenRouterBalance, type OpenRouterBalance } from '../lib/api'
import { NAV_PREFS_EVENT, readHiddenNav, readNavOrder, saveNavOrder, orderedVisibleNav } from '../lib/navPrefs'

// Odoo CRM runs as its own instance outside DeepLogic — the dropdown opens it
// directly in a new tab, deep-linked to the CRM pipeline (not Odoo's home).
// Override the base per-device via localStorage('dl-crm-odoo-url').
const ODOO_BASE =
  (typeof localStorage !== 'undefined' && localStorage.getItem('dl-crm-odoo-url')) || 'http://localhost:8069'
const ODOO_CRM_URL = `${ODOO_BASE.replace(/\/+$/, '')}/web#action=crm.crm_lead_action_pipeline&menu_id=239`

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
      <span aria-hidden style={{ fontSize: '13px', lineHeight: 1 }}>🪙</span>
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
              <a className="dl-user-dropdown-item dl-user-dropdown-item--admin" href={ODOO_CRM_URL} target="_blank" rel="noopener noreferrer">
                📇 CRM ↗
              </a>
              <a className="dl-user-dropdown-item dl-user-dropdown-item--admin" href="/admin/cannara-demo" target="_blank" rel="noopener noreferrer">
                🌿 Cannara Demo ↗
              </a>
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

  // Header pages: which show/hide (Settings → Appearance) and their order
  // (drag-to-reorder in the header). Both per-device, kept in sync via event.
  const [hiddenNav, setHiddenNav] = useState<Set<string>>(readHiddenNav)
  const [navOrder, setNavOrder] = useState<string[]>(readNavOrder)
  useEffect(() => {
    const sync = () => { setHiddenNav(readHiddenNav()); setNavOrder(readNavOrder()) }
    window.addEventListener(NAV_PREFS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(NAV_PREFS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const dragKey = useRef<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  function reorderNav(targetKey: string) {
    const from = dragKey.current
    dragKey.current = null
    setDragOverKey(null)
    if (!from || from === targetKey) return
    const next = [...navOrder]
    const fi = next.indexOf(from)
    const ti = next.indexOf(targetKey)
    if (fi < 0 || ti < 0) return
    next.splice(fi, 1)
    next.splice(ti, 0, from)
    setNavOrder(next)
    saveNavOrder(next)
  }
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
              {activeOrgId && orderedVisibleNav(navOrder, hiddenNav).map((it) => (
                <Link
                  key={it.key}
                  className={`btn btn-ghost nav-drag${dragOverKey === it.key ? ' nav-drag--over' : ''}`}
                  to={`/app/${activeOrgId}${it.path}`}
                  draggable
                  onDragStart={(e) => { dragKey.current = it.key; e.dataTransfer.effectAllowed = 'move' }}
                  onDragOver={(e) => { e.preventDefault(); if (dragOverKey !== it.key) setDragOverKey(it.key) }}
                  onDragLeave={() => setDragOverKey((k) => (k === it.key ? null : k))}
                  onDrop={(e) => { e.preventDefault(); reorderNav(it.key) }}
                  onDragEnd={() => { dragKey.current = null; setDragOverKey(null) }}
                  title={`${it.label} — drag to reorder`}
                >
                  {it.label}
                </Link>
              ))}
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

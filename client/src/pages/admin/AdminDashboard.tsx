// Admin dashboard — platform-wide KPIs + live restart monitor.

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { adminRestart, adminStats, type AdminStats } from '../../lib/api'
import AdminLayout from './AdminLayout'

const PLAN_ORDER = ['free', 'team', 'business', 'enterprise'] as const

type RestartPhase = 'signaling' | 'going-down' | 'offline' | 'back'

export default function AdminDashboard() {
  const { getAccessToken } = useAuth()
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restartState, setRestartState] = useState<'idle' | 'confirm' | 'restarting' | 'done'>('idle')
  const [restartPhase, setRestartPhase] = useState<RestartPhase>('signaling')
  const [elapsed, setElapsed] = useState(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef = useRef(0)

  useEffect(() => {
    getAccessToken().then((token) => {
      if (!token) return
      adminStats(token)
        .then(setStats)
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load stats'))
    })
  }, [getAccessToken])

  // Live restart monitor: poll /api/health until the server goes down then comes back.
  useEffect(() => {
    if (restartState !== 'restarting') return

    setRestartPhase('signaling')
    setElapsed(0)
    startRef.current = Date.now()
    let hasGoneDown = false

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 500)

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/health', {
          cache: 'no-store',
          signal: AbortSignal.timeout(1500),
        })
        if (res.ok) {
          if (hasGoneDown) {
            clearInterval(pollRef.current!)
            clearInterval(timerRef.current!)
            setRestartPhase('back')
            setRestartState('done')
            setTimeout(() => window.location.reload(), 2000)
          } else {
            setRestartPhase('going-down')
          }
        } else {
          hasGoneDown = true
          setRestartPhase('offline')
        }
      } catch {
        hasGoneDown = true
        setRestartPhase('offline')
      }
    }, 600)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [restartState])

  async function handleRestart() {
    if (restartState === 'idle') { setRestartState('confirm'); return }
    if (restartState !== 'confirm') return
    setRestartState('restarting')
    try {
      const token = await getAccessToken()
      if (token) await adminRestart(token)
    } catch { /* process restarting — fetch may throw */ }
  }

  const monitoring = restartState === 'restarting' || restartState === 'done'

  return (
    <AdminLayout>
      <div className="dl-admin__header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div className="dl-admin__eyebrow">Super admin</div>
          <h1 className="dl-admin__title">Dashboard</h1>
        </div>

        {!monitoring && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            {restartState === 'confirm' && (
              <span style={{ fontSize: 13, color: 'var(--mut)' }}>
                Restart the server? This will briefly take the app offline.
              </span>
            )}
            <button
              type="button"
              className={`btn btn-xs ${restartState === 'confirm' ? 'btn-danger' : 'btn-ghost'}`}
              onClick={() => void handleRestart()}
            >
              {restartState === 'idle'    && 'Restart server'}
              {restartState === 'confirm' && 'Confirm restart'}
            </button>
            {restartState === 'confirm' && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setRestartState('idle')}
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>

      {monitoring && (
        <RestartMonitor phase={restartPhase} elapsed={elapsed} />
      )}

      {error && <div className="dl-admin__error">{error}</div>}

      {!stats ? (
        <div className="dl-admin__empty"><div className="dl-spinner" style={{ margin: '40px auto' }} /></div>
      ) : (
        <>
          <div className="dl-admin__stats">
            <StatCard label="Total orgs"        value={stats.totalOrgs}        />
            <StatCard label="Total users"       value={stats.totalUsers}       />
            <StatCard label="New orgs this mo." value={stats.newOrgsThisMonth} variant="good" />
            <StatCard label="Est. MRR"          value={`$${stats.estimatedMrr.toLocaleString()}`} variant="good" />
            <StatCard label="In trial"          value={stats.trialOrgs}        variant="warn" />
            <StatCard label="Past due"          value={stats.pastDueOrgs}      variant={stats.pastDueOrgs > 0 ? 'bad' : undefined} />
            <StatCard label="AI tokens billed"  value={stats.tokensBilledThisMonth.toLocaleString()} sub="this month" />
          </div>

          <div className="dl-admin__card" style={{ display: 'inline-block' }}>
            <div className="dl-admin__card-title" style={{ marginBottom: 14 }}>Plan breakdown</div>
            <div className="dl-admin__plans">
              {PLAN_ORDER.map((plan) => {
                const count = stats.planBreakdown[plan] ?? 0
                return (
                  <span key={plan} className={`dl-admin__plan-pill dl-admin__plan-pill--${plan}`}>
                    {plan} <strong>{count}</strong>
                  </span>
                )
              })}
            </div>
          </div>
        </>
      )}
    </AdminLayout>
  )
}

// ---------------------------------------------------------------------------
// Restart monitor panel
// ---------------------------------------------------------------------------

function RestartMonitor({ phase, elapsed }: { phase: RestartPhase; elapsed: number }) {
  const steps: { label: string; done: boolean; active: boolean }[] = [
    {
      label: 'Restart signal sent',
      done: true,
      active: false,
    },
    {
      label: 'Server going offline',
      done: phase === 'offline' || phase === 'back',
      active: phase === 'going-down',
    },
    {
      label: 'Server restarting',
      done: phase === 'back',
      active: phase === 'offline',
    },
    {
      label: phase === 'back' ? 'Server is back — reloading page...' : 'Waiting for server',
      done: phase === 'back',
      active: false,
    },
  ]

  return (
    <div className="dl-admin__restart-monitor">
      <div className="dl-admin__restart-monitor-head">
        <span className="dl-admin__restart-monitor-title">Server restart</span>
        {phase !== 'back' && (
          <span className="dl-admin__restart-elapsed">{elapsed}s</span>
        )}
        {phase === 'back' && (
          <span className="dl-admin__restart-back-badge">Online</span>
        )}
      </div>
      <div className="dl-admin__restart-steps">
        {steps.map((s) => (
          <div
            key={s.label}
            className={`dl-admin__restart-step${s.done ? ' rs-done' : s.active ? ' rs-active' : ' rs-waiting'}`}
          >
            <span className="dl-admin__restart-step-icon">
              {s.done ? '✓' : s.active ? <span className="rs-pulse" /> : '○'}
            </span>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({
  label, value, sub, variant,
}: {
  label: string
  value: string | number
  sub?: string
  variant?: 'good' | 'warn' | 'bad'
}) {
  return (
    <div className={`dl-admin__stat${variant ? ` dl-admin__stat--${variant}` : ''}`}>
      <div className="dl-admin__stat-label">{label}</div>
      <div className="dl-admin__stat-value">{value}</div>
      {sub && <div className="dl-admin__stat-sub">{sub}</div>}
    </div>
  )
}

// Admin org detail — members, subscription info, plan override, usage.

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import {
  adminGetOrg,
  adminPatchSubscription,
  adminRemoveMember,
  type AdminOrgDetail,
  type AdminOrgMember,
} from '../../lib/api'
import AdminLayout from './AdminLayout'

const PLANS    = ['free', 'team', 'business', 'enterprise'] as const
const STATUSES = ['trialing', 'active', 'past_due', 'canceled'] as const
const PLAN_PRICE: Record<string, number> = { free: 0, team: 39, business: 79, enterprise: 0 }

export default function AdminOrgDetailPage() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()

  const [detail,  setDetail]  = useState<AdminOrgDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = await getAccessToken()
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      setDetail(await adminGetOrg(token, orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load org')
    } finally {
      setLoading(false)
    }
  }, [getAccessToken, orgId])

  useEffect(() => { void load() }, [load])

  if (loading) return (
    <AdminLayout>
      <div className="dl-admin__empty"><div className="dl-spinner" style={{ margin: '60px auto' }} /></div>
    </AdminLayout>
  )
  if (error || !detail) return (
    <AdminLayout>
      <Link to="/admin/orgs" className="dl-admin__back">← Organizations</Link>
      <div className="dl-admin__error">{error ?? 'Organization not found.'}</div>
    </AdminLayout>
  )

  const sub = detail.subscription as Record<string, unknown> | null
  const plan   = (sub?.plan   as string) ?? 'free'
  const status = (sub?.status as string) ?? 'active'
  const trialEndsAt       = (sub?.trial_ends_at       as string | null) ?? null
  const currentPeriodEnd  = (sub?.current_period_end  as string | null) ?? null
  const stripeCustomerId  = (sub?.stripe_customer_id  as string | null) ?? null
  const stripeSubId       = (sub?.stripe_subscription_id as string | null) ?? null
  const seatCount         = (sub?.seat_count as number) ?? 1
  const inTrial = status === 'trialing' && !!trialEndsAt && new Date(trialEndsAt) > new Date()
  const mrr = status === 'active' ? (PLAN_PRICE[plan] ?? 0) * seatCount : 0

  const tokPct = (() => {
    const lim = (plan === 'free' ? 100_000 : plan === 'team' ? 2_000_000 : plan === 'business' ? 10_000_000 : Infinity)
    if (!isFinite(lim) || lim === 0) return 0
    return Math.min(100, (detail.tokensThisMonth / lim) * 100)
  })()

  return (
    <AdminLayout>
      <Link to="/admin/orgs" className="dl-admin__back">← Organizations</Link>

      <div className="dl-admin__header">
        <div className="dl-admin__eyebrow">Organization</div>
        <h1 className="dl-admin__title">{detail.org.name}</h1>
        <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <span className={`dl-admin__badge dl-admin__badge--${plan}`}>{plan}</span>
          <span className={`dl-admin__badge dl-admin__badge--${status}`}>{inTrial ? 'trial' : status}</span>
          <code style={{ fontSize: 12, color: 'var(--mut)', fontFamily: 'ui-monospace, monospace' }}>
            /{detail.org.slug}
          </code>
        </div>
      </div>

      <div className="dl-admin__detail-grid">
        {/* Subscription info */}
        <div className="dl-admin__card">
          <div className="dl-admin__card-head">
            <span className="dl-admin__card-title">Subscription</span>
            {mrr > 0 && (
              <span style={{ fontSize: 13, color: 'var(--cyan)', fontWeight: 700 }}>
                ${mrr}/mo MRR
              </span>
            )}
          </div>
          <dl className="dl-admin__kv">
            <dt>Plan</dt>         <dd>{plan}</dd>
            <dt>Status</dt>       <dd>{status}</dd>
            <dt>Seats</dt>        <dd>{seatCount}</dd>
            {trialEndsAt && <><dt>Trial ends</dt><dd>{fmtDate(trialEndsAt)}</dd></>}
            {currentPeriodEnd && <><dt>Renewal</dt><dd>{fmtDate(currentPeriodEnd)}</dd></>}
            {stripeCustomerId && <><dt>Stripe customer</dt><dd>{stripeCustomerId}</dd></>}
            {stripeSubId && <><dt>Stripe sub</dt><dd style={{ fontSize: 12 }}>{stripeSubId}</dd></>}
            <dt>Created</dt>      <dd>{fmtDate(detail.org.created_at)}</dd>
          </dl>
        </div>

        {/* Usage */}
        <div className="dl-admin__card">
          <div className="dl-admin__card-head">
            <span className="dl-admin__card-title">Usage this month</span>
          </div>
          <dl className="dl-admin__kv">
            <dt>AI tokens</dt>
            <dd>{detail.tokensThisMonth.toLocaleString()}</dd>
            <dt>Members</dt>
            <dd>{detail.members.length} / {seatCount} seats</dd>
            <dt>Invitations</dt>
            <dd>{(detail.invitations as unknown[]).length} pending</dd>
          </dl>
          {tokPct > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--mut2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Token usage
              </div>
              <div className="dl-set__token-bar">
                <div
                  className="dl-set__token-fill"
                  style={{ width: `${tokPct}%`, background: tokPct > 90 ? '#e07a8a' : undefined }}
                />
              </div>
              <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 4 }}>{tokPct.toFixed(1)}% of limit</div>
            </div>
          )}
        </div>
      </div>

      {/* Plan override */}
      <PlanOverrideCard
        orgId={orgId}
        currentPlan={plan}
        currentStatus={status}
        currentTrialEndsAt={trialEndsAt}
        getAccessToken={getAccessToken}
        onSaved={load}
      />

      {/* Members */}
      <MembersCard
        orgId={orgId}
        members={detail.members}
        getAccessToken={getAccessToken}
        onChanged={load}
      />
    </AdminLayout>
  )
}

// ---------------------------------------------------------------------------
// Plan override card
// ---------------------------------------------------------------------------

function PlanOverrideCard({
  orgId, currentPlan, currentStatus, currentTrialEndsAt, getAccessToken, onSaved,
}: {
  orgId: string
  currentPlan: string
  currentStatus: string
  currentTrialEndsAt: string | null
  getAccessToken: () => Promise<string | null>
  onSaved: () => void
}) {
  const [plan,   setPlan]   = useState(currentPlan)
  const [status, setStatus] = useState(currentStatus)
  const [trialDate, setTrialDate] = useState(
    currentTrialEndsAt ? currentTrialEndsAt.slice(0, 10) : ''
  )
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setSuccess(null)
    const token = await getAccessToken()
    if (!token) { setBusy(false); return }
    try {
      await adminPatchSubscription(token, orgId, {
        plan,
        status,
        trialEndsAt: trialDate ? new Date(trialDate).toISOString() : null,
      })
      setSuccess('Subscription updated.')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dl-admin__card" style={{ marginBottom: 20 }}>
      <div className="dl-admin__card-head">
        <span className="dl-admin__card-title">Override subscription</span>
      </div>
      {error   && <div className="dl-admin__error">{error}</div>}
      {success && <div className="dl-admin__success">{success}</div>}
      <form className="dl-admin__override-form" onSubmit={onSubmit}>
        <div>
          <label>Plan</label>
          <select value={plan} onChange={(e) => setPlan(e.target.value)}>
            {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label>Trial ends (date)</label>
          <input type="date" value={trialDate} onChange={(e) => setTrialDate(e.target.value)} />
        </div>
        <div />
        <div className="dl-admin__override-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--mut)' }}>
            Changes are logged in the admin audit log.
          </span>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Members card
// ---------------------------------------------------------------------------

function MembersCard({
  orgId, members, getAccessToken, onChanged,
}: {
  orgId: string
  members: AdminOrgMember[]
  getAccessToken: () => Promise<string | null>
  onChanged: () => void
}) {
  const [busyUser, setBusyUser] = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)

  async function remove(userId: string) {
    if (!confirm('Remove this member from the org?')) return
    setBusyUser(userId); setError(null)
    const token = await getAccessToken()
    if (!token) { setBusyUser(null); return }
    try {
      await adminRemoveMember(token, orgId, userId)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove member')
    } finally {
      setBusyUser(null)
    }
  }

  return (
    <div className="dl-admin__table-wrap" style={{ marginBottom: 20 }}>
      {error && <div className="dl-admin__error" style={{ margin: '0 16px 0', borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>{error}</div>}
      <table className="dl-admin__table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Joined</th>
            <th aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {members.length === 0 ? (
            <tr><td colSpan={4} className="dl-admin__empty">No members.</td></tr>
          ) : members.map((m) => (
            <tr key={m.userId}>
              <td>{m.email}</td>
              <td><span className={`dl-set__rolebadge role-${m.role}`}>{m.role}</span></td>
              <td className="muted">{fmtDate(m.joinedAt)}</td>
              <td style={{ textAlign: 'right' }}>
                <button
                  className="btn btn-ghost dl-set__remove"
                  style={{ height: 30, fontSize: 12 }}
                  disabled={busyUser === m.userId}
                  onClick={() => remove(m.userId)}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Admin org list — paginated, searchable, filterable by plan/status.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { adminListOrgs, type AdminOrg } from '../../lib/api'
import AdminLayout from './AdminLayout'

const LIMIT = 25

function PlanBadge({ plan }: { plan: string }) {
  return <span className={`dl-admin__badge dl-admin__badge--${plan}`}>{plan}</span>
}

function StatusBadge({ status, inTrial }: { status: string; inTrial: boolean }) {
  const label = inTrial ? 'trial' : status
  const cls   = inTrial ? 'trialing' : status
  return <span className={`dl-admin__badge dl-admin__badge--${cls}`}>{label}</span>
}

export default function AdminOrgs() {
  const { getAccessToken } = useAuth()

  const [orgs,    setOrgs]    = useState<AdminOrg[]>([])
  const [total,   setTotal]   = useState(0)
  const [page,    setPage]    = useState(1)
  const [search,  setSearch]  = useState('')
  const [plan,    setPlan]    = useState('')
  const [status,  setStatus]  = useState('')
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const token = await getAccessToken()
    if (!token) return
    try {
      const res = await adminListOrgs(token, { page, limit: LIMIT, search, plan, status })
      setOrgs(res.orgs)
      setTotal(res.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load orgs')
    } finally {
      setLoading(false)
    }
  }, [getAccessToken, page, search, plan, status])

  useEffect(() => { void load() }, [load])

  function handleSearch(val: string) { setSearch(val); setPage(1) }
  function handlePlan(val: string)   { setPlan(val);   setPage(1) }
  function handleStatus(val: string) { setStatus(val); setPage(1) }

  const pages = Math.max(1, Math.ceil(total / LIMIT))

  return (
    <AdminLayout>
      <div className="dl-admin__header">
        <div className="dl-admin__eyebrow">Super admin</div>
        <h1 className="dl-admin__title">Organizations</h1>
      </div>

      {error && <div className="dl-admin__error">{error}</div>}

      <div className="dl-admin__toolbar">
        <input
          className="dl-admin__search"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
        />
        <select className="dl-admin__filter" value={plan} onChange={(e) => handlePlan(e.target.value)}>
          <option value="">All plans</option>
          <option value="free">Free</option>
          <option value="team">Team</option>
          <option value="business">Business</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <select className="dl-admin__filter" value={status} onChange={(e) => handleStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="trialing">Trialing</option>
          <option value="active">Active</option>
          <option value="past_due">Past due</option>
          <option value="canceled">Canceled</option>
        </select>
      </div>

      <div className="dl-admin__table-wrap">
        <table className="dl-admin__table">
          <thead>
            <tr>
              <th>Organization</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Members</th>
              <th>Trial / Renewal</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32 }}>
                <div className="dl-spinner" style={{ margin: '0 auto' }} />
              </td></tr>
            ) : orgs.length === 0 ? (
              <tr><td colSpan={6} className="dl-admin__empty">No organizations found.</td></tr>
            ) : orgs.map((org) => (
              <tr key={org.id}>
                <td>
                  <Link to={`/admin/orgs/${org.id}`}>{org.name}</Link>
                  <div className="muted">/{org.slug}</div>
                </td>
                <td><PlanBadge plan={org.plan} /></td>
                <td><StatusBadge status={org.status} inTrial={org.inTrial} /></td>
                <td>{org.memberCount}</td>
                <td className="muted">
                  {org.inTrial && org.trialEndsAt
                    ? `Trial ends ${fmtDate(org.trialEndsAt)}`
                    : org.currentPeriodEnd
                      ? `Renews ${fmtDate(org.currentPeriodEnd)}`
                      : '—'}
                </td>
                <td className="muted">{fmtDate(org.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="dl-admin__pagination">
          <span>{total} organization{total !== 1 ? 's' : ''}</span>
          <div className="dl-admin__pagination-btns">
            <button className="btn btn-ghost" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
              ← Prev
            </button>
            <span style={{ padding: '0 8px', alignSelf: 'center', fontSize: 13, color: 'var(--mut)' }}>
              {page} / {pages}
            </span>
            <button className="btn btn-ghost" onClick={() => setPage((p) => p + 1)} disabled={page >= pages}>
              Next →
            </button>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

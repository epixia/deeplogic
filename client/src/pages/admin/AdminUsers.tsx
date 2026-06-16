// Admin user list — paginated, searchable.

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { adminListUsers, type AdminUser } from '../../lib/api'
import AdminLayout from './AdminLayout'

const LIMIT = 25

export default function AdminUsers() {
  const { getAccessToken } = useAuth()

  const [users,   setUsers]   = useState<AdminUser[]>([])
  const [total,   setTotal]   = useState(0)
  const [page,    setPage]    = useState(1)
  const [search,  setSearch]  = useState('')
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const token = await getAccessToken()
    if (!token) return
    try {
      const res = await adminListUsers(token, { page, limit: LIMIT, search })
      setUsers(res.users)
      setTotal(res.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [getAccessToken, page, search])

  useEffect(() => { void load() }, [load])

  function handleSearch(val: string) { setSearch(val); setPage(1) }

  const pages = Math.max(1, Math.ceil(total / LIMIT))

  return (
    <AdminLayout>
      <div className="dl-admin__header">
        <div className="dl-admin__eyebrow">Super admin</div>
        <h1 className="dl-admin__title">Users</h1>
      </div>

      {error && <div className="dl-admin__error">{error}</div>}

      <div className="dl-admin__toolbar">
        <input
          className="dl-admin__search"
          placeholder="Search by email…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      <div className="dl-admin__table-wrap">
        <table className="dl-admin__table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Joined</th>
              <th>Orgs</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} style={{ textAlign: 'center', padding: 32 }}>
                <div className="dl-spinner" style={{ margin: '0 auto' }} />
              </td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={3} className="dl-admin__empty">No users found.</td></tr>
            ) : users.map((u) => (
              <tr key={u.id}>
                <td>
                  <span style={{ fontWeight: 600 }}>{u.email}</span>
                  <div className="muted" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{u.id}</div>
                </td>
                <td className="muted">{fmtDate(u.createdAt)}</td>
                <td>
                  {u.orgs.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {u.orgs.map((o) => (
                        <a
                          key={o.orgId}
                          href={`/admin/orgs/${o.orgId}`}
                          style={{
                            fontSize: 12,
                            padding: '2px 8px',
                            borderRadius: 6,
                            border: '1px solid var(--line)',
                            background: 'var(--bg2)',
                            color: 'var(--ink)',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            gap: 4,
                          }}
                        >
                          {o.orgName}
                          <span style={{ color: 'var(--mut)' }}>{o.role}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="dl-admin__pagination">
          <span>{total} user{total !== 1 ? 's' : ''}</span>
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

// Admin user detail — account info, org memberships, and management actions:
// suspend/unsuspend, change password, send reset email, confirm email, delete.

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import {
  adminGetUser,
  adminUpdateUser,
  adminResetUserEmail,
  adminDeleteUser,
  type AdminUserDetail,
} from '../../lib/api'
import AdminLayout from './AdminLayout'

export default function AdminUserDetailPage() {
  const { userId = '' } = useParams<{ userId: string }>()
  const { getAccessToken, user: currentUser } = useAuth()

  const [detail,  setDetail]  = useState<AdminUserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = await getAccessToken()
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      setDetail(await adminGetUser(token, userId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load user')
    } finally {
      setLoading(false)
    }
  }, [getAccessToken, userId])

  useEffect(() => { void load() }, [load])

  if (loading) return (
    <AdminLayout>
      <div className="dl-admin__empty"><div className="dl-spinner" style={{ margin: '60px auto' }} /></div>
    </AdminLayout>
  )
  if (error || !detail) return (
    <AdminLayout>
      <Link to="/admin/users" className="dl-admin__back">← Users</Link>
      <div className="dl-admin__error">{error ?? 'User not found.'}</div>
    </AdminLayout>
  )

  const isSelf = currentUser?.id === detail.id

  return (
    <AdminLayout>
      <Link to="/admin/users" className="dl-admin__back">← Users</Link>

      <div className="dl-admin__header">
        <div className="dl-admin__eyebrow">User</div>
        <h1 className="dl-admin__title">{detail.email}</h1>
        <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {detail.suspended
            ? <span className="dl-admin__badge dl-admin__badge--suspended">suspended</span>
            : <span className="dl-admin__badge dl-admin__badge--active">active</span>}
          {detail.emailConfirmed
            ? <span className="dl-admin__badge dl-admin__badge--trialing">email confirmed</span>
            : <span className="dl-admin__badge dl-admin__badge--past_due">email unconfirmed</span>}
          <code style={{ fontSize: 12, color: 'var(--mut)', fontFamily: 'ui-monospace, monospace' }}>
            {detail.id}
          </code>
        </div>
      </div>

      <div className="dl-admin__detail-grid">
        {/* Account info */}
        <div className="dl-admin__card">
          <div className="dl-admin__card-head">
            <span className="dl-admin__card-title">Account</span>
          </div>
          <dl className="dl-admin__kv">
            <dt>Email</dt>        <dd>{detail.email}</dd>
            {detail.phone && <><dt>Phone</dt><dd>{detail.phone}</dd></>}
            <dt>Provider</dt>     <dd>{detail.providers.length ? detail.providers.join(', ') : detail.provider}</dd>
            <dt>Created</dt>      <dd>{fmtDateTime(detail.createdAt)}</dd>
            <dt>Last sign-in</dt> <dd>{detail.lastSignInAt ? fmtDateTime(detail.lastSignInAt) : 'never'}</dd>
            <dt>Confirmed</dt>    <dd>{detail.emailConfirmed ? 'yes' : 'no'}</dd>
            <dt>Suspended</dt>    <dd>{detail.suspended ? `until ${fmtDateTime(detail.bannedUntil!)}` : 'no'}</dd>
          </dl>
        </div>

        {/* Memberships */}
        <div className="dl-admin__card">
          <div className="dl-admin__card-head">
            <span className="dl-admin__card-title">Organizations ({detail.orgs.length})</span>
          </div>
          {detail.orgs.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>Not a member of any organization.</p>
          ) : (
            <dl className="dl-admin__kv">
              {detail.orgs.map((o) => (
                <div key={o.orgId} style={{ display: 'contents' }}>
                  <dt>
                    <Link to={`/admin/orgs/${o.orgId}`} style={{ color: 'var(--ink)' }}>{o.orgName}</Link>
                  </dt>
                  <dd>
                    <span className={`dl-set__rolebadge role-${o.role}`}>{o.role}</span>
                    <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>joined {fmtDate(o.joinedAt)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      <UserActions
        detail={detail}
        isSelf={isSelf}
        getAccessToken={getAccessToken}
        onChanged={load}
      />
    </AdminLayout>
  )
}

// ---------------------------------------------------------------------------
// Actions card
// ---------------------------------------------------------------------------

function UserActions({
  detail, isSelf, getAccessToken, onChanged,
}: {
  detail: AdminUserDetail
  isSelf: boolean
  getAccessToken: () => Promise<string | null>
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [busy,    setBusy]    = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function run(label: string, fn: (token: string) => Promise<unknown>, successMsg: string) {
    setBusy(label); setError(null); setSuccess(null)
    const token = await getAccessToken()
    if (!token) { setBusy(null); return }
    try {
      await fn(token)
      setSuccess(successMsg)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  async function onSetPassword(e: FormEvent) {
    e.preventDefault()
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    await run('password', (t) => adminUpdateUser(t, detail.id, { action: 'set_password', password }), 'Password updated.')
    setPassword('')
  }

  async function onToggleSuspend() {
    const action = detail.suspended ? 'unsuspend' : 'suspend'
    if (action === 'suspend' && !confirm(`Suspend ${detail.email}? They will be unable to sign in until unsuspended.`)) return
    await run('suspend', (t) => adminUpdateUser(t, detail.id, { action }),
      action === 'suspend' ? 'User suspended.' : 'User unsuspended.')
  }

  async function onReset() {
    await run('reset', (t) => adminResetUserEmail(t, detail.id), 'Password-reset email sent.')
  }

  async function onConfirmEmail() {
    await run('confirm', (t) => adminUpdateUser(t, detail.id, { action: 'confirm_email' }), 'Email confirmed.')
  }

  async function onDelete() {
    if (!confirm(`Permanently delete ${detail.email}? This cannot be undone.`)) return
    if (!confirm('Are you absolutely sure? All of this user’s auth data will be erased.')) return
    setBusy('delete'); setError(null)
    const token = await getAccessToken()
    if (!token) { setBusy(null); return }
    try {
      await adminDeleteUser(token, detail.id)
      navigate('/admin/users')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete user')
      setBusy(null)
    }
  }

  return (
    <div className="dl-admin__card" style={{ marginBottom: 20 }}>
      <div className="dl-admin__card-head">
        <span className="dl-admin__card-title">Manage</span>
        <span style={{ fontSize: 12, color: 'var(--mut)' }}>All actions are logged in the admin audit log.</span>
      </div>
      {error   && <div className="dl-admin__error">{error}</div>}
      {success && <div className="dl-admin__success">{success}</div>}

      {isSelf && (
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          This is your own account — suspend and delete are disabled.
        </p>
      )}

      {/* Change password */}
      <form className="dl-admin__user-action" onSubmit={onSetPassword}>
        <div>
          <label className="dl-admin__action-label">Set a new password</label>
          <input
            className="dl-admin__action-input"
            type="text"
            autoComplete="off"
            placeholder="New password (min 6 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy === 'password' || password.length < 6}>
          {busy === 'password' ? 'Saving…' : 'Change password'}
        </button>
      </form>

      <hr className="dl-admin__action-sep" />

      {/* Other actions */}
      <div className="dl-admin__action-row">
        <div>
          <div className="dl-admin__action-label">Send a password-reset email to the user</div>
          <div className="muted" style={{ fontSize: 12 }}>Triggers the standard recovery flow.</div>
        </div>
        <button className="btn btn-ghost" onClick={onReset} disabled={busy === 'reset'}>
          {busy === 'reset' ? 'Sending…' : 'Send reset email'}
        </button>
      </div>

      {!detail.emailConfirmed && (
        <div className="dl-admin__action-row">
          <div>
            <div className="dl-admin__action-label">Manually confirm the user’s email</div>
            <div className="muted" style={{ fontSize: 12 }}>Marks the address as verified.</div>
          </div>
          <button className="btn btn-ghost" onClick={onConfirmEmail} disabled={busy === 'confirm'}>
            {busy === 'confirm' ? 'Confirming…' : 'Confirm email'}
          </button>
        </div>
      )}

      <div className="dl-admin__action-row">
        <div>
          <div className="dl-admin__action-label">
            {detail.suspended ? 'Restore account access' : 'Suspend this account'}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {detail.suspended ? 'The user will be able to sign in again.' : 'The user will be unable to sign in.'}
          </div>
        </div>
        <button
          className={`btn ${detail.suspended ? 'btn-primary' : 'dl-admin__btn-warn'}`}
          onClick={onToggleSuspend}
          disabled={busy === 'suspend' || (isSelf && !detail.suspended)}
        >
          {busy === 'suspend' ? '…' : detail.suspended ? 'Unsuspend' : 'Suspend'}
        </button>
      </div>

      <hr className="dl-admin__action-sep" />

      {/* Danger zone */}
      <div className="dl-admin__action-row">
        <div>
          <div className="dl-admin__action-label" style={{ color: 'var(--bad)' }}>Delete user</div>
          <div className="muted" style={{ fontSize: 12 }}>Permanently erase this auth account. Cannot be undone.</div>
        </div>
        <button className="btn dl-admin__btn-danger" onClick={onDelete} disabled={busy === 'delete' || isSelf}>
          {busy === 'delete' ? 'Deleting…' : 'Delete user'}
        </button>
      </div>
    </div>
  )
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

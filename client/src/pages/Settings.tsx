// Settings — organization members + RBAC controls.
// Shows the active org's name + slug, a members table, and (for owner/admin)
// controls to change roles, remove members, and add an already-registered user
// by email. Controls are role-gated; only an owner may manage owners.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  addMemberByEmail,
  listMembers,
  removeMember,
  updateMemberRole,
  type Member,
  type OrgRole,
} from '../lib/api'
import AiSettingsCard from '../components/studio/AiSettingsCard'
import './settings.css'

const ROLES: OrgRole[] = ['owner', 'admin', 'member']

export default function Settings() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { orgs, user, getAccessToken } = useAuth()

  const org = useMemo(() => orgs.find((o) => o.id === orgId), [orgs, orgId])
  const myRole: OrgRole | undefined = org?.role
  const canManage = myRole === 'owner' || myRole === 'admin'
  const isOwner = myRole === 'owner'

  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyUser, setBusyUser] = useState<string | null>(null)

  // Add-member form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<OrgRole>('member')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired — please sign in again.')
      const list = await listMembers(token, orgId)
      setMembers(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load members.')
    } finally {
      setLoading(false)
    }
  }, [getAccessToken, orgId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  // Whether the current user may modify a given target member.
  function canEdit(target: Member): boolean {
    if (!canManage) return false
    if (target.userId === user?.id) return false // don't manage yourself here
    if (target.role === 'owner' && !isOwner) return false // only owners manage owners
    return true
  }

  async function changeRole(target: Member, role: OrgRole) {
    if (role === target.role) return
    setBusyUser(target.userId)
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired — please sign in again.')
      const updated = await updateMemberRole(token, orgId, target.userId, role)
      setMembers((prev) =>
        prev.map((m) => (m.userId === updated.userId ? updated : m)),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change role.')
    } finally {
      setBusyUser(null)
    }
  }

  async function remove(target: Member) {
    setBusyUser(target.userId)
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired — please sign in again.')
      await removeMember(token, orgId, target.userId)
      setMembers((prev) => prev.filter((m) => m.userId !== target.userId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove member.')
    } finally {
      setBusyUser(null)
    }
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault()
    setInviteError(null)
    const email = inviteEmail.trim()
    if (!email) return
    setInviteBusy(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired — please sign in again.')
      const added = await addMemberByEmail(token, orgId, email, inviteRole)
      setMembers((prev) => {
        const exists = prev.some((m) => m.userId === added.userId)
        return exists
          ? prev.map((m) => (m.userId === added.userId ? added : m))
          : [...prev, added]
      })
      setInviteEmail('')
      setInviteRole('member')
    } catch (e) {
      setInviteError(
        e instanceof Error ? e.message : 'Could not add member.',
      )
    } finally {
      setInviteBusy(false)
    }
  }

  // Which roles the current user is allowed to assign to a target.
  function assignableRoles(target: Member): OrgRole[] {
    // Only an owner can grant/keep the 'owner' role.
    return isOwner ? ROLES : ROLES.filter((r) => r !== 'owner' || target.role === 'owner')
  }

  return (
    <main className="wrap dl-settings">
      <header className="dl-set__head">
        <span className="eyebrow">Workspace settings</span>
        <h1>{org ? org.name : 'Organization'}</h1>
        {org && (
          <div className="dl-set__sub">
            <span className="dl-set__slug">/{org.slug}</span>
            <span className="dl-set__role">Your role: {org.role}</span>
          </div>
        )}
      </header>

      {error && (
        <div className="dl-set__error" role="alert">
          {error}
        </div>
      )}

      <section className="rounded-card dl-set__card">
        <div className="dl-set__cardhead">
          <h2>Members</h2>
          <span className="dl-set__count">{members.length}</span>
        </div>

        {loading ? (
          <div className="dl-set__empty">Loading members…</div>
        ) : members.length === 0 ? (
          <div className="dl-set__empty">No members found.</div>
        ) : (
          <table className="dl-set__table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const editable = canEdit(m)
                const isMe = m.userId === user?.id
                return (
                  <tr key={m.userId}>
                    <td>
                      {m.email}
                      {isMe && <span className="dl-set__you">you</span>}
                    </td>
                    <td>
                      {editable ? (
                        <select
                          className="dl-set__select"
                          value={m.role}
                          disabled={busyUser === m.userId}
                          onChange={(e) =>
                            changeRole(m, e.target.value as OrgRole)
                          }
                        >
                          {assignableRoles(m).map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={`dl-set__rolebadge role-${m.role}`}>
                          {m.role}
                        </span>
                      )}
                    </td>
                    <td className="dl-set__actions">
                      {editable && (
                        <button
                          type="button"
                          className="btn btn-ghost dl-set__remove"
                          disabled={busyUser === m.userId}
                          onClick={() => remove(m)}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <AiSettingsCard
        orgId={orgId}
        getToken={async () => {
          const t = await getAccessToken()
          if (!t) throw new Error('Session expired — please sign in again.')
          return t
        }}
      />

      {canManage && (
        <section className="rounded-card dl-set__card">
          <div className="dl-set__cardhead">
            <h2>Add a member</h2>
          </div>
          <p className="dl-set__hint">
            The person must already have a DeepLogic account. Ask them to sign up
            first, then add them by email.
          </p>

          {inviteError && (
            <div className="dl-set__error" role="alert">
              {inviteError}
            </div>
          )}

          <form className="dl-set__invite" onSubmit={onInvite}>
            <input
              className="dl-input dl-set__inviteemail"
              type="email"
              placeholder="teammate@company.com"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <select
              className="dl-set__select"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as OrgRole)}
            >
              {(isOwner ? ROLES : ['admin', 'member'] as OrgRole[]).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={inviteBusy}
            >
              {inviteBusy ? 'Adding…' : 'Add member'}
            </button>
          </form>
        </section>
      )}
    </main>
  )
}

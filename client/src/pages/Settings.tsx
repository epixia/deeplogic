// Settings — workspace settings with General, Members, AI Providers, and Billing tabs.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  createOrg,
  updateOrg,
  inviteMember,
  listMembers,
  removeMember,
  updateMemberRole,
  listInvitations,
  cancelInvitation,
  getBillingSubscription,
  createCheckoutSession,
  createPortalSession,
  type Member,
  type OrgRole,
  type Invitation,
  type BillingSubscription,
} from '../lib/api'
import AiSettingsCard from '../components/studio/AiSettingsCard'
import './settings.css'

const ROLES: OrgRole[] = ['owner', 'admin', 'member']

const PLAN_LABELS: Record<string, string> = {
  free:       'Free',
  team:       'Team',
  business:   'Business',
  enterprise: 'Enterprise',
}

type Tab = 'general' | 'members' | 'ai' | 'billing'

export default function Settings() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const activeTab: Tab =
    rawTab === 'members' ? 'members' :
    rawTab === 'ai' ? 'ai' :
    rawTab === 'billing' ? 'billing' :
    'general'

  const { orgs, user, getAccessToken, refreshOrgs } = useAuth()
  const org = useMemo(() => orgs.find((o) => o.id === orgId), [orgs, orgId])
  const myRole: OrgRole | undefined = org?.role
  const canManage = myRole === 'owner' || myRole === 'admin'
  const isOwner = myRole === 'owner'

  function setTab(tab: Tab) {
    if (tab === 'general') setSearchParams({}, { replace: true })
    else setSearchParams({ tab }, { replace: true })
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'general',  label: 'General' },
    { id: 'members',  label: 'Team' },
    { id: 'ai',       label: 'AI Providers' },
    { id: 'billing',  label: 'Billing' },
  ]

  return (
    <main className="wrap dl-settings">
      <header className="dl-set__head">
        <h1>{org?.name ?? 'Organization'}</h1>
        {org && (
          <div className="dl-set__sub">
            <span className="dl-set__slug">/{org.slug}</span>
            <span className={`dl-set__rolebadge role-${org.role} dl-set__role-pill`}>{org.role}</span>
          </div>
        )}
      </header>

      <div className="dl-set__tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`dl-set__tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'general' && (
        <GeneralTab
          orgId={orgId}
          orgName={org?.name ?? ''}
          orgSlug={org?.slug ?? ''}
          canManage={canManage}
          getAccessToken={getAccessToken}
          refreshOrgs={refreshOrgs}
          allOrgs={orgs}
        />
      )}

      {activeTab === 'members' && (
        <MembersTab
          orgId={orgId}
          canManage={canManage}
          isOwner={isOwner}
          myUserId={user?.id}
          getAccessToken={getAccessToken}
        />
      )}

      {activeTab === 'ai' && (
        <div className="dl-set__tab-body">
          <AiSettingsCard orgId={orgId} getToken={() => getAccessToken().then((t) => t ?? '')} />
        </div>
      )}

      {activeTab === 'billing' && (
        <BillingTab
          orgId={orgId}
          isOwner={isOwner}
          getAccessToken={getAccessToken}
        />
      )}
    </main>
  )
}

// ---------------------------------------------------------------------------
// General tab
// ---------------------------------------------------------------------------

interface GeneralTabProps {
  orgId: string
  orgName: string
  orgSlug: string
  canManage: boolean
  getAccessToken: () => Promise<string | null>
  refreshOrgs: () => Promise<void>
  allOrgs: { id: string; name: string; slug: string; role: string }[]
}

function GeneralTab({ orgId, orgName, orgSlug, canManage, getAccessToken, refreshOrgs, allOrgs }: GeneralTabProps) {
  const navigate = useNavigate()

  // ---- Rename workspace ----
  const [editing, setEditing] = useState(false)
  const [nameVal, setNameVal] = useState(orgName)
  const [nameBusy, setNameBusy] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  useEffect(() => { setNameVal(orgName) }, [orgName])

  async function saveName(e: FormEvent) {
    e.preventDefault()
    const trimmed = nameVal.trim()
    if (!trimmed || trimmed === orgName) { setEditing(false); return }
    setNameBusy(true)
    setNameError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired')
      await updateOrg(token, orgId, { name: trimmed })
      await refreshOrgs()
      setEditing(false)
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Failed to rename dashboard.')
    } finally {
      setNameBusy(false)
    }
  }

  // ---- Create new workspace ----
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function createWorkspace(e: FormEvent) {
    e.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) return
    setCreateBusy(true)
    setCreateError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired')
      const org = await createOrg(token, trimmed)
      await refreshOrgs()
      setCreating(false)
      setNewName('')
      navigate(`/org/${org.id}/settings`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create dashboard.')
    } finally {
      setCreateBusy(false)
    }
  }

  return (
    <div className="dl-set__tab-body">
      {/* Dashboard name */}
      <section className="rounded-card dl-set__card">
        <div className="dl-set__cardhead">
          <h2>Dashboard name</h2>
        </div>
        {editing ? (
          <form className="dl-set__rename-form" onSubmit={saveName}>
            <input
              className="dl-input dl-set__rename-input"
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              autoFocus
              maxLength={80}
              required
            />
            <div className="dl-set__rename-actions">
              <button className="btn btn-primary" type="submit" disabled={nameBusy}>
                {nameBusy ? 'Saving…' : 'Save'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => { setEditing(false); setNameVal(orgName) }}>
                Cancel
              </button>
            </div>
            {nameError && <div className="dl-set__error" role="alert">{nameError}</div>}
          </form>
        ) : (
          <div className="dl-set__workspace-row">
            <span className="dl-set__workspace-name">{orgName}</span>
            <span className="dl-set__workspace-slug">/{orgSlug}</span>
            {canManage && (
              <button className="btn btn-secondary dl-set__rename-btn" onClick={() => setEditing(true)}>
                Rename
              </button>
            )}
          </div>
        )}
      </section>

      {/* All dashboards */}
      <section className="rounded-card dl-set__card">
        <div className="dl-set__cardhead">
          <h2>Your dashboards</h2>
          <span className="dl-set__count">{allOrgs.length}</span>
          <button
            className="btn btn-secondary dl-set__ws-new-btn"
            onClick={() => setCreating((v) => !v)}
          >
            + New dashboard
          </button>
        </div>

        {creating && (
          <form className="dl-set__rename-form dl-set__ws-create" onSubmit={createWorkspace}>
            <input
              className="dl-input dl-set__rename-input"
              placeholder="Dashboard name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              maxLength={80}
              required
            />
            <div className="dl-set__rename-actions">
              <button className="btn btn-primary" type="submit" disabled={createBusy}>
                {createBusy ? 'Creating…' : 'Create'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => { setCreating(false); setNewName('') }}>
                Cancel
              </button>
            </div>
            {createError && <div className="dl-set__error" role="alert">{createError}</div>}
          </form>
        )}

        <div className="dl-set__ws-list">
          {allOrgs.map((o) => (
            <div
              key={o.id}
              className={`dl-set__ws-item${o.id === orgId ? ' active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => o.id !== orgId && navigate(`/org/${o.id}/settings`)}
              onKeyDown={(e) => e.key === 'Enter' && o.id !== orgId && navigate(`/org/${o.id}/settings`)}
            >
              <div className="dl-set__ws-avatar">
                {o.name.charAt(0).toUpperCase()}
              </div>
              <div className="dl-set__ws-info">
                <span className="dl-set__ws-name">{o.name}</span>
                <span className="dl-set__ws-role">{o.role}</span>
              </div>
              {o.id === orgId && <span className="dl-set__ws-current">current</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Members tab
// ---------------------------------------------------------------------------

interface MembersTabProps {
  orgId: string
  canManage: boolean
  isOwner: boolean
  myUserId?: string
  getAccessToken: () => Promise<string | null>
}

function MembersTab({ orgId, canManage, isOwner, myUserId, getAccessToken }: MembersTabProps) {
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyUser, setBusyUser] = useState<string | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<OrgRole>('member')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired — please sign in again.')
      const [list, invs] = await Promise.all([
        listMembers(token, orgId),
        canManage ? listInvitations(token, orgId).catch(() => []) : Promise.resolve([]),
      ])
      setMembers(list)
      setInvitations(invs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load members.')
    } finally {
      setLoading(false)
    }
  }, [getAccessToken, orgId, canManage])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  function canEdit(target: Member): boolean {
    if (!canManage) return false
    if (target.userId === myUserId) return false
    if (target.role === 'owner' && !isOwner) return false
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
      setMembers((prev) => prev.map((m) => (m.userId === updated.userId ? updated : m)))
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

  async function cancelInv(inv: Invitation) {
    try {
      const token = await getAccessToken()
      if (!token) return
      await cancelInvitation(token, orgId, inv.id)
      setInvitations((prev) => prev.filter((i) => i.id !== inv.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel invitation.')
    }
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault()
    setInviteError(null)
    setInviteSuccess(null)
    const email = inviteEmail.trim()
    if (!email) return
    setInviteBusy(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired — please sign in again.')
      const result = await inviteMember(token, orgId, email, inviteRole)
      if (result.type === 'member' && result.userId) {
        setMembers((prev) => {
          const exists = prev.some((m) => m.userId === result.userId)
          return exists
            ? prev.map((m) => (m.userId === result.userId ? (result as Member) : m))
            : [...prev, result as Member]
        })
        setInviteSuccess(`${email} added as ${inviteRole}.`)
      } else {
        setInviteSuccess(`Invitation sent to ${email}. They'll get an email to join.`)
        void load()
      }
      setInviteEmail('')
      setInviteRole('member')
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : 'Could not send invitation.')
    } finally {
      setInviteBusy(false)
    }
  }

  function assignableRoles(target: Member): OrgRole[] {
    return isOwner ? ROLES : ROLES.filter((r) => r !== 'owner' || target.role === 'owner')
  }

  return (
    <div className="dl-set__tab-body">
      {error && <div className="dl-set__error" role="alert">{error}</div>}

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
                const isMe = m.userId === myUserId
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
                          onChange={(e) => changeRole(m, e.target.value as OrgRole)}
                        >
                          {assignableRoles(m).map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`dl-set__rolebadge role-${m.role}`}>{m.role}</span>
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

      {invitations.length > 0 && (
        <section className="rounded-card dl-set__card">
          <div className="dl-set__cardhead">
            <h2>Pending invitations</h2>
            <span className="dl-set__count">{invitations.length}</span>
          </div>
          <table className="dl-set__table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Expires</th>
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.email}</td>
                  <td><span className={`dl-set__rolebadge role-${inv.role}`}>{inv.role}</span></td>
                  <td className="dl-set__muted">
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </td>
                  <td className="dl-set__actions">
                    <button
                      type="button"
                      className="btn btn-ghost dl-set__remove"
                      onClick={() => cancelInv(inv)}
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {canManage && (
        <section className="rounded-card dl-set__card">
          <div className="dl-set__cardhead">
            <h2>Invite a member</h2>
          </div>
          <p className="dl-set__hint">
            Enter any email address. If they don't have an account yet, we'll send them an invite link.
          </p>

          {inviteError && <div className="dl-set__error" role="alert">{inviteError}</div>}
          {inviteSuccess && <div className="dl-set__success" role="status">{inviteSuccess}</div>}

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
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <button className="btn btn-primary" type="submit" disabled={inviteBusy}>
              {inviteBusy ? 'Sending…' : 'Send invite'}
            </button>
          </form>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Billing tab
// ---------------------------------------------------------------------------

interface BillingTabProps {
  orgId: string
  isOwner: boolean
  getAccessToken: () => Promise<string | null>
}

function BillingTab({ orgId, isOwner, getAccessToken }: BillingTabProps) {
  const [sub, setSub] = useState<BillingSubscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [portalBusy, setPortalBusy] = useState(false)

  useEffect(() => {
    getAccessToken().then(async (token) => {
      if (!token) { setLoading(false); return }
      try {
        const data = await getBillingSubscription(token, orgId)
        setSub(data)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load subscription.')
      } finally {
        setLoading(false)
      }
    })
  }, [orgId, getAccessToken])

  async function upgrade(plan: 'team' | 'business') {
    setCheckoutBusy(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired')
      const { url } = await createCheckoutSession(token, orgId, plan, sub?.seatCount ?? 1)
      window.location.href = url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start checkout.')
      setCheckoutBusy(false)
    }
  }

  async function managePortal() {
    setPortalBusy(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired')
      const { url } = await createPortalSession(token, orgId)
      window.location.href = url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open billing portal.')
      setPortalBusy(false)
    }
  }

  if (loading) {
    return <div className="dl-set__empty dl-set__tab-body">Loading billing info…</div>
  }

  if (!sub) {
    return (
      <div className="dl-set__tab-body">
        <div className="dl-set__error" role="alert">
          {error ?? 'Could not load billing information.'}
        </div>
      </div>
    )
  }

  const tokenPct = sub.limits.tokensPerMonth
    ? Math.min(100, (sub.tokensUsed / sub.limits.tokensPerMonth) * 100)
    : 0
  const trialDaysLeft = sub.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : null

  return (
    <div className="dl-set__tab-body">
      {error && <div className="dl-set__error" role="alert">{error}</div>}

      <section className="rounded-card dl-set__card">
        <div className="dl-set__cardhead">
          <h2>Current plan</h2>
          <span className={`dl-set__planbadge plan-${sub.plan}`}>
            {PLAN_LABELS[sub.plan] ?? sub.plan}
          </span>
        </div>

        {sub.inTrial && trialDaysLeft !== null && (
          <div className="dl-set__trial-banner">
            Trial — <strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} left</strong>.
            Upgrade before your trial ends to keep Team features.
          </div>
        )}

        {sub.status === 'past_due' && (
          <div className="dl-set__error" role="alert">
            Payment failed — update your payment method to restore access.
          </div>
        )}

        <div className="dl-set__billing-grid">
          <div className="dl-set__billing-stat">
            <span className="dl-set__billing-label">Members</span>
            <span className="dl-set__billing-value">
              {sub.seatCount}
              {sub.limits.members ? ` / ${sub.limits.members}` : ''}
            </span>
          </div>

          <div className="dl-set__billing-stat">
            <span className="dl-set__billing-label">AI tokens this month</span>
            <span className="dl-set__billing-value">
              {sub.tokensUsed.toLocaleString()}
              {sub.limits.tokensPerMonth
                ? ` / ${sub.limits.tokensPerMonth.toLocaleString()}`
                : ' (unlimited)'}
            </span>
            {sub.limits.tokensPerMonth && (
              <div className="dl-set__token-bar">
                <div
                  className="dl-set__token-fill"
                  style={{
                    width: `${tokenPct}%`,
                    background: tokenPct > 90 ? '#e07a8a' : undefined,
                  }}
                />
              </div>
            )}
          </div>

          {sub.currentPeriodEnd && (
            <div className="dl-set__billing-stat">
              <span className="dl-set__billing-label">
                {sub.status === 'trialing' ? 'Trial ends' : 'Renews'}
              </span>
              <span className="dl-set__billing-value">
                {new Date(sub.currentPeriodEnd).toLocaleDateString('en-US', {
                  month: 'long', day: 'numeric', year: 'numeric',
                })}
              </span>
            </div>
          )}
        </div>

        {isOwner && (
          <div className="dl-set__billing-actions">
            {sub.hasStripe ? (
              <button
                className="btn btn-secondary"
                onClick={managePortal}
                disabled={portalBusy}
              >
                {portalBusy ? 'Opening…' : 'Manage billing'}
              </button>
            ) : null}

            {(sub.plan === 'free' || sub.inTrial) && (
              <>
                <button
                  className="btn btn-primary"
                  onClick={() => upgrade('team')}
                  disabled={checkoutBusy}
                >
                  {checkoutBusy ? 'Loading…' : 'Upgrade to Team — $39/seat/mo'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => upgrade('business')}
                  disabled={checkoutBusy}
                >
                  Upgrade to Business — $79/seat/mo
                </button>
              </>
            )}

            {sub.plan === 'team' && !sub.inTrial && (
              <button
                className="btn btn-primary"
                onClick={() => upgrade('business')}
                disabled={checkoutBusy}
              >
                {checkoutBusy ? 'Loading…' : 'Upgrade to Business — $79/seat/mo'}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="rounded-card dl-set__card">
        <div className="dl-set__cardhead">
          <h2>Plan features</h2>
        </div>
        <table className="dl-set__table">
          <tbody>
            {[
              ['Members', sub.limits.members ? `Up to ${sub.limits.members}` : 'Unlimited'],
              ['Reports', sub.limits.reports ? `Up to ${sub.limits.reports}` : 'Unlimited'],
              ['AI tokens / month', sub.limits.tokensPerMonth
                ? sub.limits.tokensPerMonth.toLocaleString()
                : 'Unlimited'],
              ['Bring Your Own Key', sub.limits.byok ? '✓' : '–'],
              ['MCP connectors', sub.limits.mcp ? '✓' : '–'],
              ['Audit log', sub.limits.auditLog ? '✓' : '–'],
            ].map(([label, value]) => (
              <tr key={label}>
                <td>{label}</td>
                <td style={{ color: value === '–' ? 'var(--c-muted)' : undefined }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

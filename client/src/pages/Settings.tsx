// Settings — workspace settings with General, Members, AI Providers, and Billing tabs.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
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
import OrgoIntegrationCard from '../components/settings/OrgoIntegrationCard'
import IntegrationsCatalog from '../components/settings/IntegrationsCatalog'
import PlatformApisCatalog from '../components/settings/PlatformApisCatalog'
import { SKINS, readSkin, saveSkin } from '../styles/skins'
import { getPlatformStatus, type PlatformStatus } from '../lib/api'
import './settings.css'

const ROLES: OrgRole[] = ['owner', 'admin', 'member']

const PLAN_LABELS: Record<string, string> = {
  free:       'Free',
  team:       'Team',
  business:   'Business',
  enterprise: 'Enterprise',
}

type Tab = 'members' | 'ai' | 'integrations' | 'apis' | 'billing' | 'appearance' | 'profile' | 'status'

export default function Settings() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const activeTab: Tab =
    rawTab === 'members' ? 'members' :
    rawTab === 'ai' ? 'ai' :
    rawTab === 'integrations' ? 'integrations' :
    rawTab === 'apis' ? 'apis' :
    rawTab === 'billing' ? 'billing' :
    rawTab === 'appearance' ? 'appearance' :
    rawTab === 'status' ? 'status' :
    'profile'

  const { orgs, user, getAccessToken } = useAuth()
  const org = useMemo(() => orgs.find((o) => o.id === orgId), [orgs, orgId])
  const myRole: OrgRole | undefined = org?.role
  const canManage = myRole === 'owner' || myRole === 'admin'
  const isOwner = myRole === 'owner'

  function setTab(tab: Tab) {
    if (tab === 'profile') setSearchParams({}, { replace: true })
    else setSearchParams({ tab }, { replace: true })
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'profile',    label: 'Profile' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'members',    label: 'Team' },
    { id: 'ai',         label: 'AI Providers' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'apis',       label: 'APIs' },
    { id: 'billing',    label: 'Billing' },
    { id: 'status',     label: 'Status' },
  ]

  return (
    <main className="wrap dl-settings">
      <header className="dl-set__head">
        <h1><span className="grad-text">Settings</span></h1>
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

      {activeTab === 'members' && (
        <MembersTab
          orgId={orgId}
          canManage={canManage}
          isOwner={isOwner}
          myUserId={user?.id}
          getAccessToken={getAccessToken}
        />
      )}

      {activeTab === 'profile' && <ProfileTab />}

      {activeTab === 'status' && <StatusTab orgId={orgId} getAccessToken={getAccessToken} />}

      {activeTab === 'appearance' && <AppearanceTab />}

      {activeTab === 'ai' && (
        <div className="dl-set__tab-body">
          <AiSettingsCard orgId={orgId} getToken={() => getAccessToken().then((t) => t ?? '')} />
        </div>
      )}

      {activeTab === 'integrations' && (
        <div className="dl-set__tab-body">
          <OrgoIntegrationCard orgId={orgId} getToken={() => getAccessToken().then((t) => t ?? '')} />
          <IntegrationsCatalog orgId={orgId} getToken={() => getAccessToken().then((t) => t ?? '')} />
        </div>
      )}

      {activeTab === 'apis' && (
        <div className="dl-set__tab-body">
          <PlatformApisCatalog orgId={orgId} getToken={() => getAccessToken().then((t) => t ?? '')} />
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
// Profile tab — your name, avatar, and password (Supabase auth user)
// ---------------------------------------------------------------------------

function initialsOf(name: string, email: string): string {
  const base = name.trim() || email.split('@')[0] || '?'
  const parts = base.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return base.slice(0, 2).toUpperCase()
}

// Resize an image client-side to a small square data URI (avatar).
function avatarDataUri(file: File, size = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('canvas unsupported')); return }
      const s = Math.min(img.naturalWidth, img.naturalHeight)
      const sx = (img.naturalWidth - s) / 2
      const sy = (img.naturalHeight - s) / 2
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('Could not read image'))
    img.src = url
  })
}

function ProfileTab() {
  const { user, updateProfile, updatePassword } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(user?.name ?? '')
  const [nameBusy, setNameBusy] = useState(false)
  const [nameMsg, setNameMsg] = useState<string | null>(null)

  const [avatar, setAvatar] = useState(user?.avatarUrl ?? '')
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarErr, setAvatarErr] = useState<string | null>(null)

  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwMsg, setPwMsg] = useState<string | null>(null)
  const [pwErr, setPwErr] = useState<string | null>(null)

  useEffect(() => { setName(user?.name ?? ''); setAvatar(user?.avatarUrl ?? '') }, [user?.name, user?.avatarUrl])

  async function saveName(e: FormEvent) {
    e.preventDefault()
    setNameBusy(true); setNameMsg(null)
    const { error } = await updateProfile({ name: name.trim() })
    setNameMsg(error ?? 'Saved')
    setNameBusy(false)
    if (!error) setTimeout(() => setNameMsg(null), 2500)
  }

  async function onPickAvatar(file: File | undefined) {
    if (!file) return
    setAvatarErr(null); setAvatarBusy(true)
    try {
      const uri = await avatarDataUri(file)
      const { error } = await updateProfile({ avatarUrl: uri })
      if (error) setAvatarErr(error)
      else setAvatar(uri)
    } catch (e) {
      setAvatarErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setAvatarBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true); setAvatarErr(null)
    const { error } = await updateProfile({ avatarUrl: '' })
    if (error) setAvatarErr(error); else setAvatar('')
    setAvatarBusy(false)
  }

  async function savePw(e: FormEvent) {
    e.preventDefault()
    setPwErr(null); setPwMsg(null)
    if (pw.length < 6) { setPwErr('Password must be at least 6 characters.'); return }
    if (pw !== pw2) { setPwErr('Passwords do not match.'); return }
    setPwBusy(true)
    const { error } = await updatePassword(pw)
    if (error) setPwErr(error)
    else { setPwMsg('Password updated.'); setPw(''); setPw2('') }
    setPwBusy(false)
  }

  return (
    <div className="dl-set__tab-body">
      <section className="rounded-card dl-set__card">
        <div className="dl-set__cardhead"><h2>Profile</h2></div>

        <div className="dl-prof-row">
          <div className="dl-prof-avatar">
            {avatar
              ? <img src={avatar} alt="Profile" />
              : <span>{initialsOf(name, user?.email ?? '')}</span>}
          </div>
          <div className="dl-prof-avatar-actions">
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={(e) => void onPickAvatar(e.target.files?.[0])} />
            <button className="btn btn-secondary" type="button" disabled={avatarBusy}
              onClick={() => fileRef.current?.click()}>
              {avatarBusy ? 'Uploading…' : avatar ? 'Change photo' : 'Upload photo'}
            </button>
            {avatar && (
              <button className="btn btn-ghost" type="button" disabled={avatarBusy} onClick={() => void removeAvatar()}>
                Remove
              </button>
            )}
            {avatarErr && <div className="dl-set__error">{avatarErr}</div>}
          </div>
        </div>

        <form className="dl-set__rename-form" onSubmit={saveName}>
          <label className="dl-prof-field">
            <span>Name</span>
            <input className="dl-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={80} />
          </label>
          <label className="dl-prof-field">
            <span>Email</span>
            <input className="dl-input" value={user?.email ?? ''} readOnly disabled />
          </label>
          <div className="dl-set__rename-actions">
            <button className="btn btn-primary" type="submit" disabled={nameBusy}>{nameBusy ? 'Saving…' : 'Save'}</button>
            {nameMsg && <span className="dl-set__success">{nameMsg}</span>}
          </div>
        </form>
      </section>

      <section className="rounded-card dl-set__card">
        <div className="dl-set__cardhead"><h2>Change password</h2></div>
        {pwErr && <div className="dl-set__error" role="alert">{pwErr}</div>}
        {pwMsg && <div className="dl-set__success" role="status">{pwMsg}</div>}
        <form className="dl-set__rename-form" onSubmit={savePw}>
          <label className="dl-prof-field">
            <span>New password</span>
            <input className="dl-input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" placeholder="••••••••" />
          </label>
          <label className="dl-prof-field">
            <span>Confirm password</span>
            <input className="dl-input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" placeholder="••••••••" />
          </label>
          <div className="dl-set__rename-actions">
            <button className="btn btn-primary" type="submit" disabled={pwBusy || !pw}>{pwBusy ? 'Updating…' : 'Update password'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status tab — platform health
// ---------------------------------------------------------------------------

function StatusTab({
  orgId,
  getAccessToken,
}: {
  orgId: string
  getAccessToken: () => Promise<string | null>
}) {
  const [status, setStatus] = useState<PlatformStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired')
      setStatus(await getPlatformStatus(token, orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load status.')
    } finally {
      setLoading(false)
    }
  }, [getAccessToken, orgId])

  useEffect(() => { void load() }, [load])

  type Row = { label: string; state: 'ok' | 'warn' | 'down'; detail: string }
  const rows: Row[] = status ? [
    { label: 'API server', state: status.api.ok ? 'ok' : 'down', detail: status.api.ok ? 'Online' : 'Unreachable' },
    { label: 'Database', state: status.database.ok ? 'ok' : 'down', detail: status.database.ok ? 'Connected' : 'Unreachable' },
    { label: 'Authentication', state: status.auth.ok ? 'ok' : 'down', detail: status.auth.ok ? 'Verified' : 'Failing' },
    {
      label: 'AI provider',
      state: status.ai.configured ? 'ok' : (status.ai.envKey ? 'ok' : 'warn'),
      detail: status.ai.configured
        ? `Connected · ${status.ai.provider}${status.ai.model ? ` (${status.ai.model})` : ''}`
        : status.ai.envKey ? 'Using server ANTHROPIC_API_KEY' : 'Not configured — add a key in AI Providers',
    },
    {
      label: 'Web research',
      state: 'ok',
      detail: status.webSearch.mode === 'brave' ? 'Brave Search (API key)' : 'DuckDuckGo (keyless)',
    },
  ] : []

  const DOT: Record<Row['state'], { color: string; label: string }> = {
    ok: { color: '#5fcf8a', label: 'Operational' },
    warn: { color: '#febc2e', label: 'Attention' },
    down: { color: '#ff5f57', label: 'Down' },
  }
  const allOk = rows.every((r) => r.state === 'ok')

  return (
    <div className="dl-set__tab-body">
      <section className="rounded-card dl-set__card">
        <div className="dl-set__cardhead">
          <h2>Platform status</h2>
          {status && (
            <span className={`dl-status-overall ${allOk ? 'ok' : 'warn'}`}>
              {allOk ? 'All systems operational' : 'Needs attention'}
            </span>
          )}
          <button className="btn btn-ghost btn-xs" onClick={() => void load()} disabled={loading} style={{ marginLeft: 'auto' }}>
            {loading ? 'Checking…' : '↻ Refresh'}
          </button>
        </div>

        {error && <div className="dl-set__error" role="alert">{error}</div>}
        {loading && !status ? (
          <div className="dl-set__empty">Checking services…</div>
        ) : (
          <div className="dl-status-list">
            {rows.map((r) => (
              <div className="dl-status-row" key={r.label}>
                <span className="dl-status-dot" style={{ background: DOT[r.state].color }} />
                <span className="dl-status-name">{r.label}</span>
                <span className="dl-status-detail">{r.detail}</span>
                <span className="dl-status-state" style={{ color: DOT[r.state].color }}>{DOT[r.state].label}</span>
              </div>
            ))}
          </div>
        )}
        {status && (
          <div className="dl-status-checked">Last checked {new Date(status.checkedAt).toLocaleTimeString()}</div>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Appearance tab — skin picker (applies to both light & dark, per-device)
// ---------------------------------------------------------------------------

function AppearanceTab() {
  const [skin, setSkinState] = useState<string>(readSkin)

  function choose(id: string) {
    setSkinState(id)
    saveSkin(id) // dispatches event → ThemeManager re-applies instantly
  }

  return (
    <div className="dl-set__tab-body">
      <section className="rounded-card dl-set__card">
        <div className="dl-set__cardhead">
          <h2>Theme style</h2>
        </div>
        <p className="dl-set__hint">
          Pick a palette for the whole platform — it restyles both light and dark mode
          (toggle modes with 🌙 / ☀️ in the top bar). Generated widgets &amp; reports follow
          your choice too. Saved on this device.
        </p>

        <div className="dl-skin-grid">
          {SKINS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`dl-skin-card${skin === s.id ? ' selected' : ''}`}
              onClick={() => choose(s.id)}
            >
              <span className="dl-skin-preview" style={{ background: s.swatch.bg }}>
                <span className="dl-skin-preview-card" style={{ background: s.swatch.card }}>
                  <span className="dl-skin-preview-dot" style={{ background: s.swatch.accent }} />
                  <span className="dl-skin-preview-line" style={{ background: s.swatch.ink, opacity: 0.85 }} />
                  <span className="dl-skin-preview-line short" style={{ background: s.swatch.ink, opacity: 0.4 }} />
                </span>
              </span>
              <span className="dl-skin-meta">
                <span className="dl-skin-name">
                  {s.label}
                  {skin === s.id && <span className="dl-skin-check">✓</span>}
                </span>
                <span className="dl-skin-desc">{s.description}</span>
              </span>
            </button>
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

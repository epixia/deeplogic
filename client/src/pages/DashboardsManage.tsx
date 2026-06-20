// DashboardsManage — the hub for dashboards: create, delete, and organise into
// groups. Groups are created here and dashboards are dragged between them; the
// dropped dashboard's `group` is persisted. Empty groups created by the user
// are remembered locally (per org) so they stay as drop targets until filled.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  listDashboards,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  type DashboardListItem,
} from '../lib/api'
import '../components/studio/studio.css'
import './dashboards-manage.css'

const GROUP_ICON: Record<string, string> = { Company: '🏢', Competitors: '⚔', Competitor: '⚔' }
const groupIcon = (g: string) => GROUP_ICON[g] ?? '▦'
const DEFAULT_GROUP = 'Company'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
const groupOf = (b: DashboardListItem) => b.group?.trim() || DEFAULT_GROUP

export default function DashboardsManage() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken, orgs } = useAuth()
  const navigate = useNavigate()
  const orgName = orgs.find((o) => o.id === orgId)?.name ?? ''

  const [boards, setBoards] = useState<DashboardListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // User-created groups that have no dashboards yet — kept as drop targets.
  const extraKey = `dl-dashgroups-extra-${orgId}`
  const [extraGroups, setExtraGroups] = useState<string[]>(() => {
    try { const raw = localStorage.getItem(extraKey); return raw ? (JSON.parse(raw) as string[]) : [] } catch { return [] }
  })
  const persistExtra = (next: string[]) => {
    setExtraGroups(next)
    try { localStorage.setItem(extraKey, JSON.stringify(next)) } catch { /* ignore */ }
  }

  // Drag + new-group UI state
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropGroup, setDropGroup] = useState<string | null>(null)
  const [addingGroup, setAddingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')

  // New-dashboard form
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newGroup, setNewGroup] = useState(DEFAULT_GROUP)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      setBoards(await listDashboards(t, orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboards.')
    } finally {
      setLoading(false)
    }
  }, [getAccessToken, orgId])

  useEffect(() => { setLoading(true); void load() }, [load])

  // Groups to render = those holding dashboards ∪ user-created empty groups.
  // Competitor dashboards live on the dedicated Competitors page, so their group
  // is excluded from dashboard management.
  const isCompetitorGroup = (g: string) => g.toLowerCase() === 'competitors' || g.toLowerCase() === 'competitor'
  const grouped = useMemo(() => {
    const map = new Map<string, DashboardListItem[]>()
    for (const g of extraGroups) if (!isCompetitorGroup(g) && !map.has(g)) map.set(g, [])
    for (const b of boards) {
      const key = groupOf(b)
      if (isCompetitorGroup(key)) continue
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(b)
    }
    if (!map.has(DEFAULT_GROUP)) map.set(DEFAULT_GROUP, [])
    const order = (g: string) => (g === DEFAULT_GROUP ? 0 : g === 'Other' ? 2 : 1)
    return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
  }, [boards, extraGroups])

  // ---- drag & drop ----
  async function moveToGroup(boardId: string, group: string) {
    const board = boards.find((b) => b.id === boardId)
    if (!board || groupOf(board) === group) return
    const prev = boards
    setBoards((cur) => cur.map((b) => (b.id === boardId ? { ...b, group } : b))) // optimistic
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      await updateDashboard(t, orgId, boardId, { group })
    } catch (e) {
      setBoards(prev) // roll back
      setError(e instanceof Error ? e.message : 'Failed to move dashboard.')
    }
  }
  function onDrop(group: string) {
    const id = dragId
    setDragId(null); setDropGroup(null)
    if (id) void moveToGroup(id, group)
  }

  // ---- new group ----
  function commitNewGroup() {
    const name = newGroupName.trim()
    setAddingGroup(false); setNewGroupName('')
    if (!name) return
    const exists = grouped.some(([g]) => g.toLowerCase() === name.toLowerCase())
    if (!exists) persistExtra([...extraGroups, name])
  }
  function removeEmptyGroup(group: string) {
    persistExtra(extraGroups.filter((g) => g !== group))
  }

  // ---- new dashboard ----
  function openNew(group = DEFAULT_GROUP) {
    setNewName(''); setNewGroup(group); setShowNew(true)
  }
  async function submitNew(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const board = await createDashboard(t, orgId, { name: newName.trim(), group: newGroup.trim() || undefined })
      navigate(`/app/${orgId}/dashboards/${board.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create dashboard.')
      setCreating(false)
    }
  }

  async function remove(b: DashboardListItem) {
    if (!confirm(`Delete dashboard "${b.name}"${b.widgetCount ? ` and its ${b.widgetCount} Block${b.widgetCount === 1 ? '' : 's'}` : ''}? This cannot be undone.`)) return
    setBusyId(b.id)
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      await deleteDashboard(t, orgId, b.id)
      setBoards((prev) => prev.filter((x) => x.id !== b.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main className="wrap studio">
      <header className="studio-head">
        <div>
          <h1><span className="grad-text">Dashboards</span></h1>
          <p className="studio-lead">
            Organise dashboards into groups — <strong>drag a dashboard onto a group</strong> to move it. Open one to add Blocks.
          </p>
        </div>
        <div className="studio-head-actions">
          {addingGroup ? (
            <input
              className="studio-input dm-newgroup-input"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onBlur={commitNewGroup}
              onKeyDown={(e) => { if (e.key === 'Enter') commitNewGroup(); if (e.key === 'Escape') { setAddingGroup(false); setNewGroupName('') } }}
              placeholder="New group name"
              autoFocus
            />
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setAddingGroup(true)}>+ New group</button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => openNew()}>+ New dashboard</button>
        </div>
      </header>

      {error && <div className="studio-error">{error}</div>}

      {loading ? (
        <div className="studio-empty">Loading dashboards…</div>
      ) : (
        <div className="dm-groups">
          {grouped.map(([group, items]) => {
            const isEmptyExtra = items.length === 0 && extraGroups.includes(group)
            return (
              <section
                className={`dm-group${dropGroup === group ? ' dm-group--drop' : ''}`}
                key={group}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setDropGroup(group) } }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropGroup((g) => (g === group ? null : g)) }}
                onDrop={(e) => { e.preventDefault(); onDrop(group) }}
              >
                <h2 className="dm-group-head">
                  <span className="dm-group-icon" aria-hidden>{groupIcon(group)}</span>
                  {group}
                  <span className="dm-group-count">{items.length}</span>
                  {isEmptyExtra && (
                    <button type="button" className="dm-group-remove" title="Remove empty group" onClick={() => removeEmptyGroup(group)}>✕</button>
                  )}
                </h2>
                <div className="dm-list">
                  {items.map((b) => (
                    <div
                      className={`dm-row${dragId === b.id ? ' dm-row--dragging' : ''}`}
                      key={b.id}
                      draggable
                      onDragStart={(e) => { setDragId(b.id); e.dataTransfer.effectAllowed = 'move' }}
                      onDragEnd={() => { setDragId(null); setDropGroup(null) }}
                    >
                      <span className="dm-grip" aria-hidden title="Drag to another group">⋮⋮</span>
                      <Link className="dm-row-main" draggable={false} to={`/app/${orgId}/dashboards/${b.id}`}>
                        <span className="dm-row-name">{b.name}</span>
                        <span className="dm-row-meta">
                          {b.widgetCount} Block{b.widgetCount === 1 ? '' : 's'} · updated {fmtDate(b.updatedAt)}
                        </span>
                      </Link>
                      <div className="dm-row-actions">
                        <Link className="btn btn-ghost btn-xs" draggable={false} to={`/app/${orgId}/dashboards/${b.id}`}>Open</Link>
                        <button
                          type="button"
                          className="dm-del"
                          title="Delete dashboard"
                          disabled={busyId === b.id}
                          onClick={() => void remove(b)}
                        >
                          {busyId === b.id ? '…' : '✕'}
                        </button>
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && (
                    <div className="dm-group-empty">
                      Drop a dashboard here, or <button type="button" className="dm-linkbtn" onClick={() => openNew(group)}>create one</button>.
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {showNew && (
        <div className="studio-modal-backdrop" onClick={() => !creating && setShowNew(false)}>
          <form className="studio-modal" onClick={(e) => e.stopPropagation()} onSubmit={submitNew}>
            <h2>New dashboard</h2>
            <p className="studio-modal-sub">Name it and choose a group — you can drag it to another group later.</p>

            <label className="studio-field">
              <span>Name</span>
              <input
                className="studio-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={orgName ? `${orgName} overview` : 'Sales overview'}
                autoFocus
              />
            </label>

            <label className="studio-field">
              <span>Group</span>
              <input
                className="studio-input"
                list="dm-group-options"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                placeholder="Company"
              />
              <datalist id="dm-group-options">
                {grouped.map(([g]) => <option key={g} value={g} />)}
              </datalist>
            </label>

            <div className="studio-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowNew(false)} disabled={creating}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={creating || !newName.trim()}>
                {creating ? 'Creating…' : 'Create & open'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}

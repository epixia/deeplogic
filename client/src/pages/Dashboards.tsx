import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  listOrgWidgets,
  listDashboards,
  createDashboard,
  createWidget,
  deleteOrgWidget,
  type Widget,
  type WidgetType,
} from '../lib/api'
import '../components/studio/studio.css'
import './dashboards.css'

const TYPE_ICONS: Record<string, string> = {
  kpi: '📊', chart: '📈', table: '📋', insight: '💡', alert: '🔔', embed: '🔗', news: '📰',
}

const NEW_TYPES: { type: WidgetType; icon: string; label: string; hint: string }[] = [
  { type: 'kpi',     icon: '📊', label: 'KPI',       hint: 'Key metric with trend' },
  { type: 'chart',   icon: '📈', label: 'Chart',     hint: 'SVG bar, line or pie' },
  { type: 'table',   icon: '📋', label: 'Table',     hint: 'Data table, top-N rows' },
  { type: 'insight', icon: '💡', label: 'Insight',   hint: 'AI narrative summary' },
  { type: 'alert',   icon: '🔔', label: 'Alert',     hint: 'Threshold monitor' },
  { type: 'news',    icon: '📰', label: 'News Feed', hint: 'Live news headlines' },
]

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

type Tab = 'mine' | 'shared'

export default function Dashboards() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken, orgs } = useAuth()
  const navigate = useNavigate()
  const orgName = orgs.find((o) => o.id === orgId)?.name ?? ''

  const [widgets, setWidgets] = useState<Widget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('mine')
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<WidgetType>('kpi')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired')
      setWidgets(await listOrgWidgets(token, orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load widgets.')
    } finally {
      setLoading(false)
    }
  }, [getAccessToken, orgId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const mine = useMemo(() => widgets.filter((w) => w.isOwner !== false), [widgets])
  const shared = useMemo(() => widgets.filter((w) => w.isOwner === false), [widgets])

  function openNew() {
    setNewName('')
    setNewType('kpi')
    setShowNew(true)
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired')
      let boards = await listDashboards(token, orgId)
      let board = boards[0]
      if (!board) {
        board = await createDashboard(token, orgId, { name: orgName || 'Main' })
      }
      const w = await createWidget(token, orgId, board.id, {
        name: newName.trim(),
        type: newType,
        gridX: 0,
        gridY: 0,
        gridW: 1,
        gridH: 1,
      })
      navigate(`/app/${orgId}/widgets/${w.id}`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create widget')
      setCreating(false)
    }
  }

  async function remove(w: Widget) {
    setBusyId(w.id)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired')
      await deleteOrgWidget(token, orgId, w.id)
      setWidgets((prev) => prev.filter((x) => x.id !== w.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main className="wrap studio">
      <header className="studio-head">
        <div>
          <h1><span className="grad-text">Widgets</span></h1>
          <p className="studio-lead">
            Chat to vibe-code self-contained HTML widgets with live preview. Add them to your dashboards.
          </p>
        </div>
      </header>

      <div className="studio-tabs">
        <button
          type="button"
          className={`studio-tab ${tab === 'mine' ? 'active' : ''}`}
          onClick={() => setTab('mine')}
        >
          My widgets<span className="count">{mine.length}</span>
        </button>
        <button
          type="button"
          className={`studio-tab ${tab === 'shared' ? 'active' : ''}`}
          onClick={() => setTab('shared')}
        >
          Shared<span className="count">{shared.length}</span>
        </button>
      </div>

      {error && <div className="studio-error">{error}</div>}

      {loading ? (
        <div className="studio-empty">Loading widgets…</div>
      ) : tab === 'mine' ? (
        <div className="studio-grid">
          {mine.map((w) => (
            <WidgetCard
              key={w.id}
              w={w}
              canDelete
              busyId={busyId}
              onOpen={() => navigate(`/app/${orgId}/widgets/${w.id}`)}
              onDelete={() => void remove(w)}
            />
          ))}
          <button type="button" className="studio-card studio-card-new" onClick={openNew}>
            <span className="plus">+</span>
            New widget
          </button>
        </div>
      ) : shared.length === 0 ? (
        <div className="studio-empty">
          No shared widgets yet. When teammates create widgets they appear here.
        </div>
      ) : (
        <div className="studio-grid">
          {shared.map((w) => (
            <WidgetCard
              key={w.id}
              w={w}
              canDelete={false}
              busyId={busyId}
              onOpen={() => navigate(`/app/${orgId}/widgets/${w.id}`)}
              onDelete={() => void remove(w)}
            />
          ))}
        </div>
      )}

      {showNew && (
        <div className="studio-modal-backdrop" onClick={() => !creating && setShowNew(false)}>
          <form className="studio-modal" onClick={(e) => e.stopPropagation()} onSubmit={submitNew}>
            <h2>New widget</h2>
            <p className="studio-modal-sub">Name it and pick a type — you'll vibe-code it in the editor.</p>

            <label className="studio-field">
              <span>Name</span>
              <input
                className="studio-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Monthly Revenue KPI"
                autoFocus
              />
            </label>

            <label className="studio-field">
              <span>Type</span>
              <div className="wb-type-grid" style={{ marginTop: 4 }}>
                {NEW_TYPES.map((t) => (
                  <button
                    key={t.type}
                    type="button"
                    className={`wb-type-btn${newType === t.type ? ' selected' : ''}`}
                    onClick={() => setNewType(t.type)}
                    title={t.hint}
                  >
                    <span className="wb-type-icon">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            </label>

            <div className="studio-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowNew(false)} disabled={creating}>
                Cancel
              </button>
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

function WidgetCard({
  w, canDelete, busyId, onOpen, onDelete,
}: {
  w: Widget
  canDelete: boolean
  busyId: string | null
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <div className="studio-card" style={{ position: 'relative' }}>
      {canDelete && (
        <button
          type="button"
          className="sc-delete-btn"
          disabled={busyId === w.id}
          title="Delete widget"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
        >
          ✕
        </button>
      )}
      <div
        className="studio-card-link"
        style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}
        onClick={onOpen}
      >
        <WidgetThumb html={w.html} type={w.type} />
        <h3>{w.name}</h3>
        <div className="studio-card-meta">
          <span className="studio-pill studio-pill-org">{TYPE_ICONS[w.type] ?? '📊'} {w.type}</span>
          <span>Updated {fmtDate(w.updatedAt)}</span>
        </div>
      </div>
    </div>
  )
}

function WidgetThumb({ html, type }: { html: string | null; type: string }) {
  if (!html) {
    return (
      <div className="studio-thumb studio-thumb-empty">
        <span>{TYPE_ICONS[type] ?? '📊'} No preview yet</span>
      </div>
    )
  }
  return (
    <div className="studio-thumb" style={{ height: 160 }}>
      <iframe
        className="studio-thumb-frame"
        title="widget preview"
        srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#0a1628}</style></head><body>${html}</body></html>`}
        sandbox="allow-scripts allow-popups"
        loading="lazy"
        style={{ width: '100%', height: '100%', transform: 'none', border: 'none' }}
      />
    </div>
  )
}

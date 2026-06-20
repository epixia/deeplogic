import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStickyTab } from '../lib/useStickyTab'
import { useAuth } from '../auth/AuthContext'
import {
  listOrgWidgets,
  listDashboards,
  createDashboard,
  createWidget,
  deleteOrgWidget,
  type Widget,
  type WidgetType,
  type Idea,
} from '../lib/api'
import SuggestIdeasModal from '../components/studio/SuggestIdeasModal'
import DashboardScopeBar, { useDashboardScope, ALL_SCOPE } from '../components/DashboardScope'
import { useAppTheme } from '../components/studio/reportTheme'
import { widgetFrameSrcDoc } from '../lib/genFrame'
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
const TABS: readonly Tab[] = ['mine', 'shared']
type ViewMode = 'cards' | 'list'
const VIEWS: readonly ViewMode[] = ['cards', 'list']

export default function Dashboards() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken, orgs } = useAuth()
  const navigate = useNavigate()
  const orgName = orgs.find((o) => o.id === orgId)?.name ?? ''

  const [widgets, setWidgets] = useState<Widget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useStickyTab<Tab>(`dashboards.tab.${orgId}`, 'mine', TABS)
  const [view, setView] = useStickyTab<ViewMode>(`dashboards.view.${orgId}`, 'cards', VIEWS)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<WidgetType>('kpi')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [scope, setScope] = useDashboardScope(orgId)

  const load = useCallback(async () => {
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired')
      setWidgets(await listOrgWidgets(token, orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Blocks.')
    } finally {
      setLoading(false)
    }
  }, [getAccessToken, orgId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const inScope = useCallback(
    (w: Widget) => scope === ALL_SCOPE || w.dashboardId === scope,
    [scope],
  )
  const mine = useMemo(() => widgets.filter((w) => w.isOwner !== false && inScope(w)), [widgets, inScope])
  const shared = useMemo(() => widgets.filter((w) => w.isOwner === false && inScope(w)), [widgets, inScope])

  function openNew() {
    setNewName('')
    setNewType('kpi')
    setShowNew(true)
  }

  // Resolve which dashboard a new widget belongs to: the scoped one if chosen,
  // otherwise the first dashboard (creating a Company one if none exist).
  async function targetDashboardId(token: string): Promise<string> {
    if (scope !== ALL_SCOPE) return scope
    const boards = await listDashboards(token, orgId)
    const board = boards[0] ?? await createDashboard(token, orgId, { name: orgName || 'Main', group: 'Company' })
    return board.id
  }

  // "⚡ Generate" — suggest a widget from the Data Vault, scaffold it (name +
  // type) and open the editor with the prompt queued to auto-generate.
  const [showGen, setShowGen] = useState(false)
  async function generateFromIdea(idea: Idea) {
    const token = await getAccessToken()
    if (!token) throw new Error('Session expired')
    const dashId = await targetDashboardId(token)
    const w = await createWidget(token, orgId, dashId, {
      name: idea.title,
      type: idea.widgetType ?? 'chart',
      gridX: 0, gridY: 0, gridW: 2, gridH: 2,
    })
    navigate(`/app/${orgId}/widgets/${w.id}`, { state: { autoPrompt: idea.prompt } })
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired')
      const dashId = await targetDashboardId(token)
      const w = await createWidget(token, orgId, dashId, {
        name: newName.trim(),
        type: newType,
        gridX: 0,
        gridY: 0,
        gridW: 2,
        gridH: 2,
      })
      navigate(`/app/${orgId}/widgets/${w.id}`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create Block')
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

  function WidgetCollection({
    items,
    canDelete,
    withNew,
  }: {
    items: Widget[]
    canDelete: boolean
    withNew?: boolean
  }) {
    if (view === 'list') {
      return (
        <div className="studio-list">
          {items.map((w) => (
            <WidgetRow
              key={w.id}
              w={w}
              canDelete={canDelete}
              busyId={busyId}
              onOpen={() => navigate(`/app/${orgId}/widgets/${w.id}`)}
              onDelete={() => void remove(w)}
            />
          ))}
          {withNew && (
            <button type="button" className="studio-row studio-row-new" onClick={openNew}>
              <span className="plus">+</span>
              New Block
            </button>
          )}
        </div>
      )
    }
    return (
      <div className="studio-grid">
        {items.map((w) => (
          <WidgetCard
            key={w.id}
            w={w}
            canDelete={canDelete}
            busyId={busyId}
            onOpen={() => navigate(`/app/${orgId}/widgets/${w.id}`)}
            onDelete={() => void remove(w)}
          />
        ))}
        {withNew && (
          <button type="button" className="studio-card studio-card-new" onClick={openNew}>
            <span className="plus">+</span>
            New Block
          </button>
        )}
      </div>
    )
  }

  return (
    <main className="wrap studio">
      <header className="studio-head">
        <div>
          <h1><span className="grad-text">Blocks</span></h1>
          <p className="studio-lead">
            Blocks are modular intelligence components that monitor KPIs, track competitors, summarize
            news, display live feeds, and trigger agent actions. Chat to vibe-code self-contained Blocks
            and add them to your dashboards.
          </p>
        </div>
        <div className="studio-head-actions">
          <button type="button" className="btn btn-primary" onClick={() => setShowGen(true)}>
            ⚡ Generate
          </button>
          <button type="button" className="btn btn-ghost" onClick={openNew}>
            + New Block
          </button>
        </div>
      </header>

      <DashboardScopeBar orgId={orgId} scope={scope} onChange={setScope} noun="Blocks" />

      <div className="studio-tabs">
        <button
          type="button"
          className={`studio-tab ${tab === 'mine' ? 'active' : ''}`}
          onClick={() => setTab('mine')}
        >
          My Blocks<span className="count">{mine.length}</span>
        </button>
        <button
          type="button"
          className={`studio-tab ${tab === 'shared' ? 'active' : ''}`}
          onClick={() => setTab('shared')}
        >
          Shared<span className="count">{shared.length}</span>
        </button>

        <div className="studio-view-toggle" role="group" aria-label="View mode">
          <button
            type="button"
            className={`studio-view-btn ${view === 'cards' ? 'active' : ''}`}
            aria-pressed={view === 'cards'}
            title="Card view"
            onClick={() => setView('cards')}
          >
            ▦
          </button>
          <button
            type="button"
            className={`studio-view-btn ${view === 'list' ? 'active' : ''}`}
            aria-pressed={view === 'list'}
            title="List view"
            onClick={() => setView('list')}
          >
            ☰
          </button>
        </div>
      </div>

      {error && <div className="studio-error">{error}</div>}

      {loading ? (
        <div className="studio-empty">Loading Blocks…</div>
      ) : tab === 'mine' ? (
        <WidgetCollection items={mine} canDelete withNew />
      ) : shared.length === 0 ? (
        <div className="studio-empty">
          No shared Blocks yet. When teammates create Blocks they appear here.
        </div>
      ) : (
        <WidgetCollection items={shared} canDelete={false} />
      )}

      {showNew && (
        <div className="studio-modal-backdrop" onClick={() => !creating && setShowNew(false)}>
          <form className="studio-modal" onClick={(e) => e.stopPropagation()} onSubmit={submitNew}>
            <h2>New Block</h2>
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

      {showGen && (
        <SuggestIdeasModal
          orgId={orgId}
          target="widget"
          actionLabel="Generate →"
          closeOnPick={false}
          onPick={generateFromIdea}
          onClose={() => setShowGen(false)}
        />
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
          title="Delete Block"
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

function WidgetThumb({
  html,
  type,
  height = 160,
}: {
  html: string | null
  type: string
  height?: number
}) {
  const theme = useAppTheme()
  if (!html) {
    return (
      <div className="studio-thumb studio-thumb-empty" style={{ height }}>
        <span>{TYPE_ICONS[type] ?? '📊'} No preview yet</span>
      </div>
    )
  }
  return (
    <div className="studio-thumb" style={{ height }}>
      <iframe
        className="studio-thumb-frame"
        title="Block preview"
        srcDoc={widgetFrameSrcDoc(html, theme)}
        sandbox="allow-scripts allow-popups"
        loading="lazy"
        style={{ width: '100%', height: '100%', transform: 'none', border: 'none' }}
      />
    </div>
  )
}

function WidgetRow({
  w, canDelete, busyId, onOpen, onDelete,
}: {
  w: Widget
  canDelete: boolean
  busyId: string | null
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <div className="studio-row">
      <div className="studio-row-link" style={{ cursor: 'pointer' }} onClick={onOpen}>
        <div className="studio-row-thumb">
          <WidgetThumb html={w.html} type={w.type} height={74} />
        </div>
        <div className="studio-row-main">
          <h3>{w.name}</h3>
        </div>
        <div className="studio-row-meta">
          <span className="studio-pill studio-pill-org">{TYPE_ICONS[w.type] ?? '📊'} {w.type}</span>
          <span>Updated {fmtDate(w.updatedAt)}</span>
        </div>
      </div>
      {canDelete && (
        <button
          type="button"
          className="studio-row-del"
          disabled={busyId === w.id}
          title="Delete Block"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
        >
          ✕
        </button>
      )}
    </div>
  )
}

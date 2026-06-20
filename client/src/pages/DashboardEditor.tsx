import { useCallback, useEffect, useRef, useState, useMemo, type RefCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  getDashboard,
  createWidget,
  updateWidget,
  deleteWidget,
  generateWidget,
  listContext,
  listOrgWidgets,
  type Dashboard,
  type Widget,
  type WidgetType,
  type WidgetSource,
} from '../lib/api'
import ReactGridLayout, { type Layout, type LayoutItem } from 'react-grid-layout/legacy'
import WidgetBuilder from '../components/dashboard/WidgetBuilder'
import { useAppTheme } from '../components/studio/reportTheme'
import { widgetFrameSrcDoc } from '../lib/genFrame'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import './dashboards.css'

const TYPE_ICONS: Record<string, string> = {
  kpi: '📊', chart: '📈', table: '📋', insight: '💡', alert: '🔔', embed: '🔗',
}


// Half-step grid: 6 columns + half-height rows so widgets resize by halves.
const COLS = 6
const ROW_HEIGHT = 100

interface LibraryItem { id: string; name: string; kind: string }

export default function DashboardEditor() {
  const { orgId, dashboardId } = useParams<{ orgId: string; dashboardId: string }>()
  const navigate = useNavigate()
  const { session, getAccessToken } = useAuth()
  const theme = useAppTheme()
  const token = session?.access_token ?? ''

  const [board, setBoard] = useState<Dashboard | null>(null)
  const boardRef = useRef<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [gridWidth, setGridWidth] = useState(900)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const saveMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  // Callback ref so ResizeObserver fires when the grid mounts (after loading spinner)
  const gridRefCallback = useCallback<RefCallback<HTMLDivElement>>((node) => {
    gridRef.current = node
    if (!node) return
    const measure = () => setGridWidth(node.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
  }, [])

  const [selected, setSelected] = useState<string | null>(null)
  const [generating, setGenerating] = useState<Record<string, boolean>>({})
  const [showBuilder, setShowBuilder] = useState(false)
  const [editWidget, setEditWidget] = useState<Widget | null>(null)
  const [saving, setSaving] = useState(false)
  const [resizing, setResizing] = useState<{ i: string; w: number; h: number } | null>(null)
  const lastResizeLayoutRef = useRef<Layout | null>(null)
  const [library, setLibrary] = useState<LibraryItem[]>([])

  // Existing-widget picker
  const [showPicker, setShowPicker] = useState(false)
  const [pickerWidgets, setPickerWidgets] = useState<Widget[]>([])
  const [pickLoading, setPickLoading] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)

  // Local grid layout — separate from board so drag/resize don't cause re-render loops
  const [localLayout, setLocalLayout] = useState<LayoutItem[]>([])
  const widgetKeyRef = useRef('')

  useEffect(() => {
    if (!orgId || !dashboardId || !token) return
    setLoading(true)
    Promise.all([
      getDashboard(token, orgId, dashboardId),
      listContext(token, orgId).catch(() => []),
    ]).then(([d, items]) => {
      setBoard(d)
      boardRef.current = d
      const initLayout = d.widgets.map((w: Widget) => ({
        i: w.id, x: w.gridX, y: w.gridY, w: w.gridW, h: w.gridH,
        minW: 1, minH: 1, maxW: COLS, maxH: 10,
      }))
      widgetKeyRef.current = d.widgets.map((w: Widget) =>
        `${w.id}:${w.gridX},${w.gridY},${w.gridW},${w.gridH}`
      ).join('|')
      setLocalLayout(initLayout)
      setLibrary((items ?? []).map((i: { id: string; name: string; kind: string }) => ({
        id: i.id, name: i.name, kind: i.kind,
      })))
      setLoading(false)
    }).catch((err) => { console.error(err); setLoading(false) })
  }, [orgId, dashboardId, token])


  // Keep boardRef in sync with board state so callbacks always see the latest board
  useEffect(() => { boardRef.current = board }, [board])

  // Deselect the active widget when clicking anywhere outside a widget card.
  useEffect(() => {
    if (!selected) return
    function onDown(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.wg-cell')) setSelected(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [selected])

  // Sync localLayout when widget set or grid positions change (load, add, remove, server-side edits)
  const widgetKey = useMemo(
    () => (board?.widgets ?? []).map((w) => `${w.id}:${w.gridX},${w.gridY},${w.gridW},${w.gridH}`).join('|'),
    [board?.widgets],
  )
  useEffect(() => {
    if (!board || widgetKey === widgetKeyRef.current) return
    widgetKeyRef.current = widgetKey
    setLocalLayout(
      board.widgets.map((w) => ({
        i: w.id, x: w.gridX, y: w.gridY, w: w.gridW, h: w.gridH,
        minW: 1, minH: 1, maxW: COLS, maxH: 10,
      }))
    )
  }, [board, widgetKey])

  // Track layout locally during drag/resize — no board state update (avoids interrupting drag)
  const showSave = useCallback((ok: boolean, text: string) => {
    if (saveMsgTimer.current) clearTimeout(saveMsgTimer.current)
    setSaveMsg({ ok, text })
    saveMsgTimer.current = setTimeout(() => setSaveMsg(null), 4000)
  }, [])

  const onLayoutChange = useCallback((layout: Layout) => {
    setLocalLayout(layout as unknown as LayoutItem[])
  }, [])

  // Persist final positions to server after drag/resize completes
  const saveLayoutItems = useCallback(async (layout: Layout) => {
    if (!boardRef.current || !orgId || !dashboardId) return
    const items = layout as unknown as LayoutItem[]
    const clamp = (l: LayoutItem) => ({
      x: l.x, y: l.y,
      w: Math.min(COLS, Math.max(1, l.w)),
      h: Math.min(10, Math.max(1, l.h)),
    })
    const snapshot = boardRef.current.widgets.slice()
    setBoard((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        widgets: prev.widgets.map((w) => {
          const l = items.find((li) => li.i === w.id)
          if (!l) return w
          const c = clamp(l)
          return { ...w, gridX: c.x, gridY: c.y, gridW: c.w, gridH: c.h }
        }),
      }
    })
    const tok = await getAccessToken()
    if (!tok) { showSave(false, 'Not logged in'); return }
    let saved = 0
    for (const l of items) {
      const orig = snapshot.find((w) => w.id === l.i)
      if (!orig) continue
      const c = clamp(l)
      const unchanged = orig.gridX === c.x && orig.gridY === c.y && orig.gridW === c.w && orig.gridH === c.h
      if (unchanged) continue
      await updateWidget(tok, orgId, dashboardId, l.i, {
        gridX: c.x, gridY: c.y, gridW: c.w, gridH: c.h,
      }).then(() => { saved++ })
        .catch((err: Error) => { console.error('[save] PATCH err:', err.message); showSave(false, err.message) })
    }
    if (saved > 0) showSave(true, 'Layout saved')
  }, [getAccessToken, orgId, dashboardId, showSave])

  const onDragStop = useCallback((layout: Layout) => { void saveLayoutItems(layout) }, [saveLayoutItems])
  const onResize = useCallback((layout: Layout, _old: LayoutItem | null, newItem: LayoutItem | null) => {
    if (!newItem) return
    setResizing({ i: newItem.i, w: newItem.w, h: newItem.h })
    lastResizeLayoutRef.current = layout
  }, [])
  const onResizeStop = useCallback((_staleLayout: Layout) => {
    setResizing(null)
    const layout = lastResizeLayoutRef.current ?? _staleLayout
    lastResizeLayoutRef.current = null
    setLocalLayout(layout as unknown as LayoutItem[])
    void saveLayoutItems(layout)
  }, [saveLayoutItems])

  async function handleSaveWidget(data: {
    name: string; type: WidgetType; prompt: string;
    sources: WidgetSource[]; gridW: number; gridH: number
  }) {
    if (!orgId || !dashboardId || saving) return
    setSaving(true)
    try {
      if (editWidget) {
        const w = await updateWidget(token, orgId, dashboardId, editWidget.id, {
          name: data.name, prompt: data.prompt,
          gridW: data.gridW, gridH: data.gridH,
          sources: data.sources,
        })
        setBoard((prev) => prev ? {
          ...prev,
          widgets: prev.widgets.map((x) => x.id === w.id ? w : x),
        } : prev)
        setLocalLayout((prev) => prev.map((l) =>
          l.i === w.id ? { ...l, w: w.gridW, h: w.gridH } : l
        ))
      } else {
        const maxY = board?.widgets.reduce((m, w) => Math.max(m, w.gridY + w.gridH - 1), -1) ?? -1
        const w = await createWidget(token, orgId, dashboardId, {
          ...data, gridX: 0, gridY: maxY + 1,
        })
        setBoard((prev) => prev ? { ...prev, widgets: [...prev.widgets, w] } : prev)
        setSelected(w.id)
      }
      setShowBuilder(false)
      setEditWidget(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerate(w: Widget) {
    if (!orgId || !dashboardId) return
    setGenerating((prev) => ({ ...prev, [w.id]: true }))
    try {
      const { widget } = await generateWidget(token, orgId, dashboardId, w.id)
      setBoard((prev) => prev ? {
        ...prev, widgets: prev.widgets.map((x) => x.id === widget.id ? widget : x),
      } : prev)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating((prev) => ({ ...prev, [w.id]: false }))
    }
  }

  async function handleDelete(w: Widget) {
    if (!orgId || !dashboardId) return
    if (!confirm(`Remove widget "${w.name}"?`)) return
    try {
      await deleteWidget(token, orgId, dashboardId, w.id)
      setBoard((prev) => prev ? {
        ...prev, widgets: prev.widgets.filter((x) => x.id !== w.id),
      } : prev)
      if (selected === w.id) setSelected(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function openPicker() {
    setShowPicker(true)
    setPickLoading(true)
    try {
      // Show every existing widget in the org that isn't already on this board.
      const all = await listOrgWidgets(token, orgId!)
      const inBoard = new Set(board?.widgets.map((w) => w.id) ?? [])
      setPickerWidgets(all.filter((w) => !inBoard.has(w.id)))
    } catch { /* silent */ }
    finally { setPickLoading(false) }
  }

  async function addExisting(w: Widget) {
    if (!orgId || !dashboardId || adding) return
    setAdding(w.id)
    try {
      const maxY = board?.widgets.reduce((m, x) => Math.max(m, x.gridY + x.gridH - 1), -1) ?? -1
      const created = await createWidget(token, orgId, dashboardId, {
        name: w.name,
        type: w.type,
        html: w.html ?? undefined,
        prompt: w.prompt ?? undefined,
        gridX: 0,
        gridY: maxY + 1,
        gridW: w.gridW,
        gridH: w.gridH,
      })
      setBoard((prev) => prev ? { ...prev, widgets: [...prev.widgets, created] } : prev)
      setPickerWidgets((prev) => prev.filter((x) => x.id !== w.id))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add widget')
    } finally {
      setAdding(null)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#4d6378' }}>
        Loading dashboard…
      </div>
    )
  }

  if (!board) {
    return <div style={{ padding: 40, color: '#e07a8a' }}>Dashboard not found.</div>
  }

  return (
    <div className="dbe-layout">
      {saveMsg && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
          padding: '8px 16px', borderRadius: 6, fontWeight: 600, fontSize: 13,
          background: saveMsg.ok ? '#1a7f4b' : '#8b1a1a',
          color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}>
          {saveMsg.ok ? '✓' : '✗'} {saveMsg.text}
        </div>
      )}
      <main className="dbe-main">
        <div className="dbe-header">
          <div className="dbe-header-left">
            <h1 className="dbe-title">{board.name}</h1>
            {board.group && <span className="dbe-subtitle">{board.group}</span>}
          </div>
          <div className="dbe-header-actions">
            <button type="button" className="btn btn-primary" onClick={openPicker}>
              + Add widget
            </button>
          </div>
        </div>

        <div className="dbe-grid-wrap" ref={gridRefCallback}>
          <ReactGridLayout
            className="dbe-rgl"
            layout={localLayout}
            width={gridWidth}
            cols={COLS}
            rowHeight={ROW_HEIGHT}
            margin={[12, 12] as [number, number]}
            containerPadding={[0, 0] as [number, number]}
            draggableHandle=".wg-drag-handle"
            isDraggable={true}
            isResizable={true}
            resizeHandles={['se', 'e', 's']}
            onLayoutChange={onLayoutChange}
            onDragStop={onDragStop}
            onResize={onResize}
            onResizeStop={onResizeStop}
          >
            {board.widgets.map((w) => (
              <div
                key={w.id}
                className={`wg-cell${selected === w.id ? ' selected' : ''}`}
                onClick={() => setSelected(w.id)}
              >
                {/* Drag handle bar */}
                <div className="wg-drag-handle">
                  <span className="wg-drag-dots">⋮⋮</span>
                  <span className="wg-drag-name">{w.name}</span>
                  <span className="wg-db-badge" title="Saved in DB">{w.gridW}×{w.gridH}</span>
                  <div className="wg-cell-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="wg-action-btn"
                      onClick={() => navigate(`/app/${orgId}/widgets/${w.id}`)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="wg-action-btn"
                      onClick={() => handleGenerate(w)}
                      disabled={generating[w.id] || !w.prompt}
                      title={!w.prompt ? 'Set a prompt first' : 'Regenerate with AI'}
                    >
                      {generating[w.id] ? '⏳' : '✨'}
                    </button>
                    <button
                      type="button"
                      className="wg-action-btn danger"
                      onClick={() => handleDelete(w)}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Widget content */}
                <div className="wg-content">
                  {resizing?.i === w.id && (
                    <div className="wg-size-badge">{resizing.w}×{resizing.h}</div>
                  )}
                  {generating[w.id] ? (
                    <div className="wg-placeholder">
                      <div className="wg-generating">
                        <span className="wg-spinner" />
                        Generating…
                      </div>
                    </div>
                  ) : w.html ? (
                    <WidgetFrame html={w.html} theme={theme} />
                  ) : (
                    <div className="wg-placeholder">
                      <div className="wg-placeholder-icon">{TYPE_ICONS[w.type] ?? '📊'}</div>
                      <div className="wg-placeholder-name">{w.name}</div>
                      <div className="wg-placeholder-prompt">
                        {w.prompt ? 'Click ✨ to generate' : 'Click Edit to add a prompt'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </ReactGridLayout>

          {board.widgets.length === 0 && (
            <button type="button" className="wg-cell wg-cell-new wg-cell-new--full" onClick={openPicker}>
              <span className="wg-cell-new-plus">+</span>
              Add your first widget
            </button>
          )}
        </div>
      </main>

      {showBuilder && (
        <WidgetBuilder
          initial={editWidget}
          libraryItems={library}
          onSave={handleSaveWidget}
          onClose={() => { setShowBuilder(false); setEditWidget(null) }}
          saving={saving}
        />
      )}

      {showPicker && (
        <div className="dpicker-backdrop" onClick={() => !adding && setShowPicker(false)}>
          <div className="dpicker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dpicker-header">
              <h2 className="dpicker-title">Add widget to dashboard</h2>
              <button type="button" className="dpicker-close" onClick={() => setShowPicker(false)}>✕</button>
            </div>
            {pickLoading ? (
              <div className="dpicker-empty">Loading widgets…</div>
            ) : (
              <div className="dpicker-grid">
                {/* Create-new card always first */}
                <button
                  type="button"
                  className="dpicker-card dpicker-card-new"
                  onClick={() => { setShowPicker(false); setShowBuilder(true) }}
                >
                  <div className="dpicker-thumb dpicker-thumb-new">
                    <span className="dpicker-new-plus">+</span>
                  </div>
                  <div className="dpicker-info">
                    <div className="dpicker-name">Build new widget</div>
                    <div className="dpicker-type">Configure &amp; generate</div>
                  </div>
                </button>

                {pickerWidgets.map((w) => (
                  <div key={w.id} className="dpicker-card">
                    <div className="dpicker-thumb">
                      <span className="dpicker-thumb-icon">{TYPE_ICONS[w.type] ?? '📊'}</span>
                    </div>
                    <div className="dpicker-info">
                      <div className="dpicker-name">{w.name}</div>
                      <div className="dpicker-type">{TYPE_ICONS[w.type]} {w.type}</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-xs"
                      disabled={adding === w.id}
                      onClick={() => void addExisting(w)}
                    >
                      {adding === w.id ? 'Adding…' : '+ Add'}
                    </button>
                  </div>
                ))}

                {pickerWidgets.length === 0 && (
                  <p className="dpicker-hint">
                    No other widgets yet — build a new one above, or create widgets on the Widgets page.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function WidgetFrame({ html, theme }: { html: string; theme: string }) {
  return (
    <iframe
      className="wg-iframe"
      srcDoc={widgetFrameSrcDoc(html, theme)}
      sandbox="allow-scripts allow-popups"
      title="Widget preview"
    />
  )
}

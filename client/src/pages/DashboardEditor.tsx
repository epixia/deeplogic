import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
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
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import './dashboards.css'

const TYPE_ICONS: Record<string, string> = {
  kpi: '📊', chart: '📈', table: '📋', insight: '💡', alert: '🔔', embed: '🔗',
}

const PRESETS = [
  { label: 'S', w: 1, h: 1 },
  { label: 'M', w: 2, h: 1 },
  { label: 'L', w: 3, h: 1 },
  { label: 'T', w: 1, h: 2 },
  { label: 'W', w: 3, h: 2 },
]

const COLS = 3
const ROW_HEIGHT = 200

interface LibraryItem { id: string; name: string; kind: string }

export default function DashboardEditor() {
  const { orgId, dashboardId } = useParams<{ orgId: string; dashboardId: string }>()
  const { session, orgs } = useAuth()
  const token = session?.access_token ?? ''
  const orgName = orgs.find((o) => o.id === orgId)?.name ?? ''

  const [board, setBoard] = useState<Dashboard | null>(null)
  const boardRef = useRef<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [gridWidth, setGridWidth] = useState(900)
  const gridRef = useRef<HTMLDivElement>(null)

  const [selected, setSelected] = useState<string | null>(null)
  const [generating, setGenerating] = useState<Record<string, boolean>>({})
  const [showBuilder, setShowBuilder] = useState(false)
  const [editWidget, setEditWidget] = useState<Widget | null>(null)
  const [saving, setSaving] = useState(false)
  const [resizing, setResizing] = useState<{ i: string; w: number; h: number } | null>(null)
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
      setLibrary((items ?? []).map((i: { id: string; name: string; kind: string }) => ({
        id: i.id, name: i.name, kind: i.kind,
      })))
    }).catch(console.error)
      .finally(() => setLoading(false))
  }, [orgId, dashboardId, token])

  // Keep gridWidth in sync with container for correct ReactGridLayout rendering
  useEffect(() => {
    function measure() {
      if (gridRef.current) setGridWidth(gridRef.current.clientWidth)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (gridRef.current) ro.observe(gridRef.current)
    return () => ro.disconnect()
  }, [])

  // Keep boardRef in sync with board state so callbacks always see the latest board
  useEffect(() => { boardRef.current = board }, [board])

  // Sync localLayout when the widget set changes (load, add, remove) — not on position updates
  const widgetKey = useMemo(() => (board?.widgets ?? []).map((w) => w.id).join(','), [board?.widgets])
  useEffect(() => {
    if (!board || widgetKey === widgetKeyRef.current) return
    widgetKeyRef.current = widgetKey
    setLocalLayout(
      board.widgets.map((w) => ({
        i: w.id, x: w.gridX, y: w.gridY, w: w.gridW, h: w.gridH, minW: 1, minH: 1,
      }))
    )
  }, [board, widgetKey])

  // Track layout locally during drag/resize — no board state update (avoids interrupting drag)
  const onLayoutChange = useCallback((layout: Layout) => {
    setLocalLayout(layout as unknown as LayoutItem[])
  }, [])

  // Persist final positions to server after drag/resize completes
  const saveLayoutItems = useCallback(async (layout: Layout) => {
    if (!boardRef.current || !orgId || !dashboardId) return
    const items = layout as unknown as LayoutItem[]
    setBoard((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        widgets: prev.widgets.map((w) => {
          const l = items.find((li) => li.i === w.id)
          if (!l) return w
          return { ...w, gridX: l.x, gridY: l.y, gridW: l.w, gridH: l.h }
        }),
      }
    })
    for (const l of items) {
      const orig = boardRef.current?.widgets.find((w) => w.id === l.i)
      if (!orig) continue
      if (orig.gridX === l.x && orig.gridY === l.y && orig.gridW === l.w && orig.gridH === l.h) continue
      await updateWidget(token, orgId, dashboardId, l.i, {
        gridX: l.x, gridY: l.y, gridW: l.w, gridH: l.h,
      }).catch(console.error)
    }
  }, [token, orgId, dashboardId])

  const onDragStop = useCallback((layout: Layout) => { void saveLayoutItems(layout) }, [saveLayoutItems])
  const onResize = useCallback((_layout: Layout, _old: LayoutItem | null, newItem: LayoutItem | null) => {
    if (!newItem) return
    setResizing({ i: newItem.i, w: newItem.w, h: newItem.h })
  }, [])
  const onResizeStop = useCallback((layout: Layout) => {
    setResizing(null)
    void saveLayoutItems(layout)
  }, [saveLayoutItems])

  const applyPreset = useCallback(async (widgetId: string, w: number, h: number) => {
    if (!board || !orgId || !dashboardId) return
    const widget = board.widgets.find((x) => x.id === widgetId)
    if (!widget || (widget.gridW === w && widget.gridH === h)) return
    setLocalLayout((prev) => prev.map((l) => l.i === widgetId ? { ...l, w, h } : l))
    setBoard((prev) => {
      if (!prev) return prev
      return { ...prev, widgets: prev.widgets.map((x) => x.id === widgetId ? { ...x, gridW: w, gridH: h } : x) }
    })
    await updateWidget(token, orgId, dashboardId, widgetId, { gridW: w, gridH: h }).catch(console.error)
  }, [board, token, orgId, dashboardId])

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
      const all = await listOrgWidgets(token, orgId!)
      const inBoard = new Set(board?.widgets.map((w) => w.id) ?? [])
      setPickerWidgets(all.filter((w) => !inBoard.has(w.id) && w.html))
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
      <main className="dbe-main">
        <div className="dbe-header">
          <div className="dbe-header-left">
            <h1 className="dbe-title">{orgName || board.name}</h1>
            {orgName && board.name !== orgName && (
              <span className="dbe-subtitle">{board.name}</span>
            )}
          </div>
          <div className="dbe-header-actions">
            <button type="button" className="btn btn-primary" onClick={openPicker}>
              + Add widget
            </button>
          </div>
        </div>

        <div className="dbe-grid-wrap" ref={gridRef}>
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
            resizeHandles={['se', 'sw', 'ne', 'nw', 'e', 'w', 's', 'n']}
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
                  <div className="wg-preset-btns" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                    {PRESETS.map((p) => {
                      const liveW = resizing?.i === w.id ? resizing.w : w.gridW
                      const liveH = resizing?.i === w.id ? resizing.h : w.gridH
                      return (
                        <button
                          key={p.label}
                          type="button"
                          className={`wg-preset-btn${liveW === p.w && liveH === p.h ? ' active' : ''}`}
                          onClick={() => void applyPreset(w.id, p.w, p.h)}
                          title={`${p.label}: ${p.w}×${p.h}`}
                        >
                          {p.label}
                        </button>
                      )
                    })}
                  </div>
                  <div className="wg-cell-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="wg-action-btn"
                      onClick={() => { setEditWidget(w); setShowBuilder(true) }}
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
                    <div className="wg-size-badge">
                      {(() => {
                        const match = PRESETS.find((p) => p.w === resizing.w && p.h === resizing.h)
                        return match
                          ? `${match.label} (${resizing.w}×${resizing.h})`
                          : `${resizing.w}×${resizing.h}`
                      })()}
                    </div>
                  )}
                  {generating[w.id] ? (
                    <div className="wg-placeholder">
                      <div className="wg-generating">
                        <span className="wg-spinner" />
                        Generating…
                      </div>
                    </div>
                  ) : w.html ? (
                    <WidgetFrame html={w.html} />
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
              <h2 className="dpicker-title">Add widget</h2>
              <button type="button" className="dpicker-close" onClick={() => setShowPicker(false)}>✕</button>
            </div>
            <div className="dpicker-tabs">
              <button type="button" className="dpicker-tab active" onClick={() => { setShowPicker(false); setShowBuilder(true) }}>
                ✦ Build new
              </button>
            </div>
            <p className="dpicker-sub">Or pick an existing generated widget:</p>
            {pickLoading ? (
              <div className="dpicker-empty">Loading widgets…</div>
            ) : pickerWidgets.length === 0 ? (
              <div className="dpicker-empty">No generated widgets available. Create one in the Widgets page first.</div>
            ) : (
              <div className="dpicker-grid">
                {pickerWidgets.map((w) => (
                  <div key={w.id} className="dpicker-card">
                    <div className="dpicker-thumb">
                      {w.html ? (
                        <iframe
                          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#0a1628}</style></head><body>${w.html}</body></html>`}
                          sandbox="allow-scripts"
                          title="preview"
                          style={{ width: '100%', height: '100%', border: 'none' }}
                        />
                      ) : (
                        <span style={{ fontSize: 28, opacity: 0.4 }}>{TYPE_ICONS[w.type] ?? '📊'}</span>
                      )}
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
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function WidgetFrame({ html }: { html: string }) {
  return (
    <iframe
      className="wg-iframe"
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent}</style></head><body>${html}</body></html>`}
      sandbox="allow-scripts"
      title="Widget preview"
    />
  )
}

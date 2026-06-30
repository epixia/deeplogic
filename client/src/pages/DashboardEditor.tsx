import { useCallback, useEffect, useRef, useState, useMemo, type RefCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  getDashboard,
  createWidget,
  updateWidget,
  deleteWidget,
  listContext,
  listOrgWidgets,
  listDashboards,
  listGalleryBlocks,
  updateDashboard,
  getPublicCompany,
  type Dashboard,
  type Widget,
  type WidgetType,
  type WidgetSource,
  type ContextItem,
} from '../lib/api'
import { GALLERY_CATEGORIES, encodeBlockConfig, inferBlockConfig, allGalleryBlocks, setDynamicGalleryBlocks, type GalleryBlock } from '../lib/blockGallery'
import ReactGridLayout, { type Layout, type LayoutItem } from 'react-grid-layout/legacy'
import WidgetBuilder from '../components/dashboard/WidgetBuilder'
import GalleryEditModal, { isGalleryWidget } from '../components/dashboard/GalleryEditModal'
import BlockAlertModal from '../components/dashboard/BlockAlertModal'
import { useAppTheme } from '../components/studio/reportTheme'
import { widgetFrameSrcDoc } from '../lib/genFrame'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import './dashboards.css'

const TYPE_ICONS: Record<string, string> = {
  kpi: '📊', chart: '📈', table: '📋', insight: '💡', alert: '🔔', embed: '🔗',
}


// Half-step grid: 6 columns + half-height rows so widgets resize by halves.
// The grid runs at 2× resolution (FINE units) so blocks can resize in 0.5 steps.
// Stored values are COARSE (fine / 2) and may be fractional (e.g. 2.5).
const COARSE_COLS = 6
const SCALE = 2
const COLS = COARSE_COLS * SCALE       // 12 fine columns
const ROW_HEIGHT = 50                   // 50px fine row = 100px coarse row

interface LibraryItem { id: string; name: string; kind: string }

export default function DashboardEditor() {
  const { orgId, dashboardId } = useParams<{ orgId: string; dashboardId: string }>()
  const navigate = useNavigate()
  const { session, getAccessToken, orgs } = useAuth()
  const theme = useAppTheme()
  const token = session?.access_token ?? ''
  const orgName = orgs.find((o) => o.id === orgId)?.name ?? ''

  const [board, setBoard] = useState<Dashboard | null>(null)
  const boardRef = useRef<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [gridWidth, setGridWidth] = useState(900)
  // Suppress react-grid-layout's mount animation so the board appears solid (no
  // cards "expanding" into place); re-enable after first paint for drag/resize.
  const [gridAnim, setGridAnim] = useState(false)
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
  const [showBuilder, setShowBuilder] = useState(false)
  const [editWidget, setEditWidget] = useState<Widget | null>(null)
  const [editGallery, setEditGallery] = useState<Widget | null>(null)
  const [alertWidget, setAlertWidget] = useState<Widget | null>(null)
  const [saving, setSaving] = useState(false)
  const [resizing, setResizing] = useState<{ i: string; w: number; h: number } | null>(null)
  const lastResizeLayoutRef = useRef<Layout | null>(null)
  const [library, setLibrary] = useState<LibraryItem[]>([])

  // Existing-widget picker
  const [showPicker, setShowPicker] = useState(false)
  const [pickerTab, setPickerTab] = useState<'mine' | 'gallery'>('gallery')
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerWidgets, setPickerWidgets] = useState<Widget[]>([])
  const [pickLoading, setPickLoading] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  // Gallery (predefined Smart Blocks) within the picker
  const [galleryPick, setGalleryPick] = useState<GalleryBlock | null>(null)
  const [galleryCfg, setGalleryCfg] = useState<Record<string, string>>({})
  const [addingGallery, setAddingGallery] = useState(false)

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
        i: w.id, x: w.gridX * SCALE, y: w.gridY * SCALE, w: w.gridW * SCALE, h: w.gridH * SCALE,
        minW: 1, minH: 1, maxW: COLS, maxH: 20,
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

  // Once the board has loaded, enable grid animations after first paint.
  useEffect(() => {
    if (loading) { setGridAnim(false); return }
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setGridAnim(true)))
    return () => cancelAnimationFrame(id)
  }, [loading, dashboardId])

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
        i: w.id, x: w.gridX * SCALE, y: w.gridY * SCALE, w: w.gridW * SCALE, h: w.gridH * SCALE,
        minW: 1, minH: 1, maxW: COLS, maxH: 20,
      }))
    )
  }, [board, widgetKey])

  // Always give RGL a layout entry for every child in the SAME render. A freshly
  // added widget is a child before the localLayout effect syncs; without its own
  // entry RGL auto-places the orphan and oscillates ("dances") until a resize.
  const rglLayout = useMemo<LayoutItem[]>(() => {
    if (!board) return localLayout
    const byId = new Map(localLayout.map((l) => [l.i, l]))
    return board.widgets.map((w) =>
      byId.get(w.id) ?? { i: w.id, x: w.gridX * SCALE, y: w.gridY * SCALE, w: w.gridW * SCALE, h: w.gridH * SCALE, minW: 1, minH: 1, maxW: COLS, maxH: 20 },
    )
  }, [board, localLayout])

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
    // Convert fine RGL units back to coarse stored units (halves allowed).
    const clamp = (l: LayoutItem) => ({
      x: l.x / SCALE, y: l.y / SCALE,
      w: Math.min(COARSE_COLS, Math.max(1, l.w / SCALE)),
      h: Math.min(20, Math.max(1, l.h / SCALE)),
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

  async function renameBoard(raw: string) {
    const name = raw.trim()
    if (!name || !board || name === board.name || !orgId || !dashboardId) return
    setBoard((prev) => prev ? { ...prev, name } : prev)
    try { await updateDashboard(token, orgId, dashboardId, { name }) }
    catch (err) { console.error('[rename dashboard] failed', err) }
  }

  async function renameWidget(w: Widget, raw: string) {
    const name = raw.trim()
    if (!name || name === w.name || !orgId || !dashboardId) return
    setBoard((prev) => prev ? { ...prev, widgets: prev.widgets.map((x) => x.id === w.id ? { ...x, name } : x) } : prev)
    try { await updateWidget(token, orgId, dashboardId, w.id, { name }) }
    catch (err) { console.error('[rename] failed', err) }
  }

  // Clone a Block — drops an identical copy directly under the original.
  async function cloneWidget(w: Widget) {
    if (!orgId || !dashboardId || adding) return
    setAdding(w.id)
    try {
      const created = await createWidget(token, orgId, dashboardId, {
        name: `${w.name} (copy)`,
        type: w.type,
        html: w.html ?? undefined,
        prompt: w.prompt ?? undefined,
        gridX: w.gridX,
        gridY: w.gridY + w.gridH, // right under the original (RGL resolves collisions)
        gridW: w.gridW,
        gridH: w.gridH,
      })
      setBoard((prev) => prev ? { ...prev, widgets: [...prev.widgets, created] } : prev)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to copy Block')
    } finally { setAdding(null) }
  }

  async function handleDelete(w: Widget) {
    if (!orgId || !dashboardId) return
    if (!confirm(`Remove Block "${w.name}"?`)) return
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
    setPickerTab('gallery')
    setPickerQuery('')
    setGalleryPick(null)
    setPickLoading(true)
    // Load admin-built gallery Blocks alongside the built-ins.
    try { if (token) { const r = await listGalleryBlocks(token, orgId!); setDynamicGalleryBlocks(r.blocks) } } catch { /* built-ins still show */ }
    try {
      // Show every existing widget in the org that isn't already on this board,
      // excluding competitor-dashboard Blocks (those live on the Competitors page).
      const [all, boards] = await Promise.all([listOrgWidgets(token, orgId!), listDashboards(token, orgId!)])
      const competitorBoards = new Set(
        boards.filter((b) => (b.group ?? '').toLowerCase().startsWith('competitor')).map((b) => b.id),
      )
      const inBoard = new Set(board?.widgets.map((w) => w.id) ?? [])
      setPickerWidgets(all.filter((w) => !inBoard.has(w.id) && !(w.dashboardId && competitorBoards.has(w.dashboardId))))
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
      alert(err instanceof Error ? err.message : 'Failed to add Block')
    } finally {
      setAdding(null)
    }
  }

  // Resolve this company's stock symbol (from gathered Company profile) so
  // market Blocks pre-fill with the company's own ticker.
  async function companySymbolFor(): Promise<string | null> {
    try {
      const items = await listContext(token, orgId!)
      const profile = items.find((i: ContextItem) => (i.meta as Record<string, unknown> | undefined)?.companyProfile === true)
      const name = ((profile?.meta as Record<string, unknown> | undefined)?.name as string) || orgName
      if (!name) return null
      const r = await getPublicCompany(token, orgId!, '', name)
      return r.company?.tradingViewSymbol ?? null
    } catch {
      return null
    }
  }

  function openGalleryBlock(b: GalleryBlock) {
    const init: Record<string, string> = {}
    for (const f of b.fields) init[f.key] = f.default ?? ''
    setGalleryCfg(init)
    setGalleryPick(b)
    const symField = b.fields.find((f) => f.key === 'symbol' || f.key === 'symbols')
    if (symField) {
      void companySymbolFor().then((sym) => {
        if (sym) setGalleryCfg((c) => ({ ...c, [symField.key]: sym }))
      })
    }
  }

  async function addGalleryToBoard(e: React.FormEvent) {
    e.preventDefault()
    if (!galleryPick || !orgId || !dashboardId || addingGallery) return
    setAddingGallery(true)
    try {
      const built = galleryPick.build(galleryCfg)
      const maxY = board?.widgets.reduce((m, x) => Math.max(m, x.gridY + x.gridH - 1), -1) ?? -1
      const created = await createWidget(token, orgId, dashboardId, {
        name: built.name,
        type: built.type,
        html: built.html,
        prompt: encodeBlockConfig(galleryPick.id, galleryCfg),
        gridX: 0,
        gridY: maxY + 1,
        gridW: galleryPick.size?.w ?? 2,
        gridH: galleryPick.size?.h ?? 2,
      })
      setBoard((prev) => prev ? { ...prev, widgets: [...prev.widgets, created] } : prev)
      setGalleryPick(null)
      setShowPicker(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add Block')
    } finally {
      setAddingGallery(false)
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
            <input
              className="dbe-title dbe-title-input"
              defaultValue={board.name}
              key={board.id + ':' + board.name}
              title="Click to rename this dashboard"
              aria-label="Dashboard name"
              onBlur={(e) => void renameBoard(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { (e.target as HTMLInputElement).value = board.name; (e.target as HTMLInputElement).blur() } }}
            />
            {board.group && <span className="dbe-subtitle">{board.group}</span>}
          </div>
          <div className="dbe-header-actions">
            <button type="button" className="btn btn-primary" onClick={openPicker}>
              + Add Block
            </button>
          </div>
        </div>

        <div className="dbe-grid-wrap" ref={gridRefCallback}>
          <ReactGridLayout
            className={`dbe-rgl${gridAnim ? '' : ' dbe-rgl--noanim'}`}
            layout={rglLayout}
            width={gridWidth}
            cols={COLS}
            rowHeight={ROW_HEIGHT}
            margin={[12, 12] as [number, number]}
            containerPadding={[0, 0] as [number, number]}
            draggableHandle=".wg-drag-handle"
            draggableCancel=".wg-name-input"
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
                  <input
                    className="wg-name-input"
                    defaultValue={w.name}
                    key={w.id + ':' + w.name}
                    title="Click to rename"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => void renameWidget(w, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { (e.target as HTMLInputElement).value = w.name; (e.target as HTMLInputElement).blur() } }}
                  />
                  <span className="wg-db-badge" title="Saved in DB">{w.gridW}×{w.gridH}</span>
                  <div className="wg-cell-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="wg-action-btn"
                      title="Alerts — get notified about this Block"
                      onClick={() => setAlertWidget(w)}
                    >
                      Alerts
                    </button>
                    <button
                      type="button"
                      className="wg-action-btn"
                      title="Duplicate this Block below"
                      disabled={adding === w.id}
                      onClick={() => void cloneWidget(w)}
                    >
                      {adding === w.id ? '…' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      className="wg-action-btn"
                      onClick={() => isGalleryWidget(w) ? setEditGallery(w) : navigate(`/app/${orgId}/widgets/${w.id}`)}
                    >
                      Edit
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
                    <div className="wg-size-badge">{resizing.w / SCALE}×{resizing.h / SCALE}</div>
                  )}
                  {w.html ? (
                    <WidgetFrame html={w.html} theme={theme} />
                  ) : (
                    <div className="wg-placeholder">
                      <div className="wg-placeholder-icon">{TYPE_ICONS[w.type] ?? '📊'}</div>
                      <div className="wg-placeholder-name">{w.name}</div>
                      <div className="wg-placeholder-prompt">Click Edit to configure this Block</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </ReactGridLayout>

          {board.widgets.length === 0 && (
            <button type="button" className="wg-cell wg-cell-new wg-cell-new--full" onClick={openPicker}>
              <span className="wg-cell-new-plus">+</span>
              Add your first Block
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

      {editGallery && (
        <GalleryEditModal
          orgId={orgId!}
          widget={editGallery}
          onClose={() => setEditGallery(null)}
          onSaved={(updated) => {
            setEditGallery(null)
            setBoard((prev) => prev ? { ...prev, widgets: prev.widgets.map((x) => x.id === updated.id ? updated : x) } : prev)
          }}
        />
      )}

      {alertWidget && (
        <BlockAlertModal orgId={orgId!} widget={alertWidget} onClose={() => setAlertWidget(null)} />
      )}

      {showPicker && (
        <div className="dpicker-backdrop" onClick={() => !adding && setShowPicker(false)}>
          <div className="dpicker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dpicker-header">
              <h2 className="dpicker-title">{galleryPick ? `${galleryPick.icon} ${galleryPick.name}` : `Add Block to ${board.name}`}</h2>
              <button type="button" className="dpicker-close" onClick={() => setShowPicker(false)}>✕</button>
            </div>

            {!galleryPick && (
              <>
                <div className="dpicker-tabs">
                  <button type="button" className={`dpicker-tab ${pickerTab === 'gallery' ? 'active' : ''}`} onClick={() => setPickerTab('gallery')}>✨ Gallery</button>
                  <button type="button" className={`dpicker-tab ${pickerTab === 'mine' ? 'active' : ''}`} onClick={() => setPickerTab('mine')}>My Blocks</button>
                </div>
                <input
                  className="studio-input dpicker-search"
                  placeholder={pickerTab === 'gallery' ? 'Search gallery blocks…' : 'Search my blocks…'}
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                />
              </>
            )}

            {galleryPick ? (
              // ---- gallery block config ----
              <form className="dpicker-config" onSubmit={addGalleryToBoard}>
                <p className="dpicker-hint" style={{ marginTop: 0 }}>{galleryPick.description}</p>
                <label className="studio-field">
                  <span>Block name (optional)</span>
                  <input className="studio-input" value={galleryCfg.name ?? ''} onChange={(e) => setGalleryCfg((c) => ({ ...c, name: e.target.value }))} placeholder="Leave blank to auto-name" />
                </label>
                {galleryPick.fields.map((f) => (
                  <label className="studio-field" key={f.key}>
                    <span>{f.label}</span>
                    {f.type === 'select' ? (
                      <select className="studio-select" value={galleryCfg[f.key] ?? f.default ?? ''} onChange={(e) => setGalleryCfg((c) => ({ ...c, [f.key]: e.target.value }))}>
                        {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input className="studio-input" type={f.type === 'number' ? 'number' : 'text'} value={galleryCfg[f.key] ?? ''} onChange={(e) => setGalleryCfg((c) => ({ ...c, [f.key]: e.target.value }))} placeholder={f.placeholder} />
                    )}
                    {(f.help || f.helpUrl) && <small className="blk-gal-help">{f.help} {f.helpUrl && <a href={f.helpUrl} target="_blank" rel="noopener noreferrer" className="blk-gal-link">{f.helpLabel ?? 'Get a key →'}</a>}</small>}
                  </label>
                ))}
                <div className="studio-modal-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setGalleryPick(null)} disabled={addingGallery}>← Back</button>
                  <button type="submit" className="btn btn-primary" disabled={addingGallery}>{addingGallery ? 'Adding…' : '+ Add to dashboard'}</button>
                </div>
              </form>
            ) : pickerTab === 'gallery' ? (
              // ---- gallery grid ----
              <div className="dpicker-gallery">
                {GALLERY_CATEGORIES.map((cat) => {
                  const q = pickerQuery.trim().toLowerCase()
                  const items = allGalleryBlocks().filter((b) => b.category === cat.key && (
                    !q || b.name.toLowerCase().includes(q) || b.tagline.toLowerCase().includes(q) || b.description.toLowerCase().includes(q)
                  ))
                  if (!items.length) return null
                  return (
                    <div key={cat.key} className="dpicker-gal-sec">
                      <div className="dpicker-gal-cat">{cat.label}</div>
                      <div className="dpicker-grid">
                        {items.map((b) => (
                          <button key={b.id} type="button" className="dpicker-card dpicker-card-btn" onClick={() => openGalleryBlock(b)}>
                            <div className="dpicker-thumb"><span className="dpicker-thumb-icon">{b.icon}</span></div>
                            <div className="dpicker-info">
                              <div className="dpicker-name">{b.name}</div>
                              <div className="dpicker-type">{b.tagline}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : pickLoading ? (
              <div className="dpicker-empty">Loading Blocks…</div>
            ) : (
              // ---- my blocks ----
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
                    <div className="dpicker-name">Build new Block</div>
                    <div className="dpicker-type">Configure &amp; generate</div>
                  </div>
                </button>

                {pickerWidgets.filter((w) => {
                  const q = pickerQuery.trim().toLowerCase()
                  return !q || w.name.toLowerCase().includes(q) || w.type.toLowerCase().includes(q)
                }).map((w) => (
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
                    No other Blocks yet — build a new one above, browse the Gallery, or create Blocks on the Blocks page.
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
  // Trusted predefined Blocks (TradingView, embeds…) need allow-same-origin to
  // load external scripts / nested iframes; AI-generated widgets stay locked down.
  const trusted = !!inferBlockConfig(html)
  return (
    <iframe
      className="wg-iframe"
      srcDoc={widgetFrameSrcDoc(html, theme)}
      sandbox={trusted ? 'allow-scripts allow-popups allow-same-origin' : 'allow-scripts allow-popups'}
      title="Block preview"
    />
  )
}

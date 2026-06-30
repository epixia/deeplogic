// Memory — an Obsidian-style knowledge base over the org's markdown notes
// (the .md docs agents save to the vault). Three panes: searchable note list,
// markdown editor/preview with [[wikilinks]] + #tags, and a backlinks/links/tags
// rail. Plus a graph view of how the notes interconnect.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  listContext,
  createContext,
  updateContext,
  deleteContext,
  getMemoryGraph,
  rebuildMemory,
  mergeMemoryEntities,
  updateMemoryEntity,
  deleteMemoryEntity,
  deleteMemoryFact,
  type ContextItem,
  type MemoryGraphData,
} from '../lib/api'
import { renderMarkdown, extractWikiLinks, extractTags } from '../lib/markdown'
import './memory.css'

interface Note { id: string; title: string; content: string }

const titleOf = (name: string) => name.replace(/\.md$/i, '')
const isMd = (i: ContextItem) => i.kind === 'doc' && (/\.md$/i.test(i.name) || (i.meta as Record<string, unknown> | undefined)?.format === 'md')

export default function Memory() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const [searchParams] = useSearchParams()
  const wantedNote = searchParams.get('note')
  const { getAccessToken } = useAuth()

  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [view, setView] = useState<'notes' | 'graph' | 'knowledge'>('notes')
  const [saving, setSaving] = useState(false)
  const [kg, setKg] = useState<MemoryGraphData | null>(null)
  const [kgLoading, setKgLoading] = useState(false)
  const [kgBuilding, setKgBuilding] = useState(false)
  const [includeStale, setIncludeStale] = useState(false)
  const [kgNote, setKgNote] = useState<string | null>(null)

  const token = useCallback(async () => {
    const t = await getAccessToken()
    if (!t) throw new Error('Session expired')
    return t
  }, [getAccessToken])

  const load = useCallback(async () => {
    try {
      const items = await listContext(await token(), orgId)
      const md = items.filter(isMd).map((i) => ({ id: i.id, title: titleOf(i.name), content: i.content ?? '' }))
      setNotes(md)
      setActiveId((cur) => {
        if (cur && md.some((n) => n.id === cur)) return cur
        if (wantedNote && md.some((n) => n.id === wantedNote)) return wantedNote
        return md[0]?.id ?? null
      })
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [token, orgId, wantedNote])

  useEffect(() => { void load() }, [load])

  const active = notes.find((n) => n.id === activeId) ?? null
  const byTitle = (t: string) => notes.find((n) => n.title.toLowerCase() === t.trim().toLowerCase())

  const allTags = useMemo(() => {
    const s = new Set<string>()
    notes.forEach((n) => extractTags(n.content).forEach((t) => s.add(t)))
    return [...s].sort()
  }, [notes])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return notes.filter((n) =>
      (!q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)) &&
      (!tagFilter || extractTags(n.content).includes(tagFilter)),
    )
  }, [notes, search, tagFilter])

  // Paginate the sidebar list so long note sets stay scannable.
  const PAGE_SIZE = 20
  const [notePage, setNotePage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const page = Math.min(notePage, pageCount - 1)
  const pagedNotes = useMemo(() => filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), [filtered, page])
  useEffect(() => { setNotePage(0) }, [search, tagFilter])

  function select(id: string) { setActiveId(id); setEditing(false); setView('notes') }

  const loadKg = useCallback(async (stale: boolean) => {
    setKgLoading(true)
    try {
      setKg(await getMemoryGraph(await token(), orgId, stale))
    } catch { /* ignore */ } finally { setKgLoading(false) }
  }, [token, orgId])

  async function openKnowledge() {
    setView('knowledge')
    if (!kg) await loadKg(includeStale)
  }

  async function buildMemory() {
    if (kgBuilding) return
    setKgBuilding(true); setKgNote('Reading your vault and extracting entities & facts… this can take a minute.')
    try {
      const r = await rebuildMemory(await token(), orgId, true)
      setKgNote(`Built from ${r.processed} items — ${r.entities} entities, ${r.facts} facts${r.superseded ? `, ${r.superseded} superseded` : ''}.`)
      await loadKg(includeStale)
    } catch (e) {
      setKgNote(e instanceof Error ? e.message : 'Build failed.')
    } finally { setKgBuilding(false) }
  }

  async function toggleStale() {
    const next = !includeStale
    setIncludeStale(next)
    await loadKg(next)
  }

  async function openWiki(target: string) {
    const found = byTitle(target)
    if (found) { select(found.id); return }
    // create the missing note on click (Obsidian behaviour)
    try {
      const item = await createContext(await token(), orgId, {
        kind: 'doc', name: `${target.trim()}.md`, content: `# ${target.trim()}\n\n`, meta: { format: 'md', source: 'memory' }, scope: 'org',
      })
      await load()
      setActiveId(item.id)
      setEditing(true)
      setDraft(`# ${target.trim()}\n\n`)
      setDraftTitle(target.trim())
    } catch { /* ignore */ }
  }

  function startEdit() {
    if (!active) return
    setDraft(active.content)
    setDraftTitle(active.title)
    setEditing(true)
  }

  async function save() {
    if (!active || saving) return
    setSaving(true)
    try {
      const name = (draftTitle.trim() || active.title).replace(/[\\/:*?"<>|]+/g, '').trim()
      await updateContext(await token(), orgId, active.id, { name: `${name}.md`, content: draft })
      setEditing(false)
      await load()
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  async function newNote() {
    try {
      const item = await createContext(await token(), orgId, {
        kind: 'doc', name: `Untitled ${notes.length + 1}.md`, content: '# Untitled\n\n', meta: { format: 'md', source: 'memory' }, scope: 'org',
      })
      await load()
      setActiveId(item.id)
      startEditFor(item.id, '# Untitled\n\n', `Untitled ${notes.length + 1}`)
    } catch { /* ignore */ }
  }
  function startEditFor(_id: string, content: string, title: string) {
    setDraft(content); setDraftTitle(title); setEditing(true)
  }

  async function remove(id: string, title: string) {
    if (!confirm(`Delete note "${title}"?`)) return
    try {
      await deleteContext(await token(), orgId, id)
      setNotes((prev) => prev.filter((n) => n.id !== id))
      if (activeId === id) setActiveId(null)
    } catch { /* ignore */ }
  }

  function onPreviewClick(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest('[data-wikilink],[data-tag]') as HTMLElement | null
    if (!el) return
    e.preventDefault()
    const wl = el.getAttribute('data-wikilink')
    if (wl) { void openWiki(wl); return }
    const tg = el.getAttribute('data-tag')
    if (tg) { setTagFilter(tg); setView('notes') }
  }

  return (
    <main className="wrap mem">
      <header className="studio-head">
        <div>
          <h1><span className="grad-text">Memory</span></h1>
          <p className="studio-lead">Your agents' research, organized — linked markdown notes with backlinks, tags and a graph.</p>
        </div>
        <div className="studio-head-actions">
          <button type="button" className={`btn btn-ghost${view === 'knowledge' ? ' mem-on' : ''}`} onClick={() => void openKnowledge()}>
            🧠 Knowledge graph
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void newNote()}>+ New note</button>
        </div>
      </header>

      {view === 'knowledge' ? (
        <div className="mem-kg-wrap">
          <div className="mem-kg-bar">
            <div className="mem-kg-stats">
              {kg ? <><strong>{kg.entities.length}</strong> entities · <strong>{kg.facts.length}</strong> facts</> : 'No memory graph built yet.'}
            </div>
            <label className="mem-kg-toggle">
              <input type="checkbox" checked={includeStale} onChange={() => void toggleStale()} /> Show superseded
            </label>
            <button className="btn btn-ghost btn-xs" onClick={() => void loadKg(includeStale)} disabled={kgLoading || kgBuilding}>↻ Refresh</button>
            <button className="btn btn-primary btn-xs" onClick={() => void buildMemory()} disabled={kgBuilding}>
              {kgBuilding ? 'Building…' : '⚙ Build from vault'}
            </button>
          </div>
          {kgNote && <div className="mem-kg-note">{kgNote}</div>}
          {kgLoading && !kg ? (
            <div className="studio-empty">Loading knowledge graph…</div>
          ) : kg && kg.entities.length > 0 ? (
            <KnowledgeGraph data={kg} orgId={orgId} token={token} onMutated={() => void loadKg(includeStale)} />
          ) : (
            <div className="studio-empty">
              No knowledge graph yet — click <strong>⚙ Build from vault</strong> to extract entities &amp; facts from your Data Vault (company profile, competitors, notes).
            </div>
          )}
        </div>
      ) : loading ? (
        <div className="studio-empty">Loading notes…</div>
      ) : notes.length === 0 ? (
        <div className="studio-empty">
          No notes yet — use <strong>＋ Add to Vault as .md</strong> in the ✦ assistant chat, or click <strong>+ New note</strong>.
        </div>
      ) : view === 'graph' ? (
        <MemoryGraph notes={notes} activeId={activeId} onSelect={select} byTitle={byTitle} />
      ) : (
        <div className="mem-grid">
          {/* note list */}
          <aside className="mem-list">
            <input className="mem-search" placeholder="Search notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
            {tagFilter && (
              <button className="mem-tagclear" onClick={() => setTagFilter(null)}>#{tagFilter} ✕</button>
            )}
            <div className="mem-list-items">
              {pagedNotes.map((n) => (
                <button key={n.id} className={`mem-list-item${n.id === activeId ? ' active' : ''}`} onClick={() => select(n.id)}>
                  📝 {n.title}
                </button>
              ))}
              {filtered.length === 0 && <div className="mem-empty">No matches.</div>}
            </div>
            {pageCount > 1 && (
              <div className="mem-pager">
                <button className="mem-pager-btn" disabled={page === 0} onClick={() => setNotePage((p) => Math.max(0, p - 1))}>‹</button>
                <span className="mem-pager-info">{page + 1} / {pageCount}</span>
                <button className="mem-pager-btn" disabled={page >= pageCount - 1} onClick={() => setNotePage((p) => Math.min(pageCount - 1, p + 1))}>›</button>
              </div>
            )}
          </aside>

          {/* editor / preview */}
          <section className="mem-main">
            {active ? (
              <>
                <div className="mem-main-head">
                  {editing ? (
                    <input className="mem-title-input" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
                  ) : (
                    <h2 className="mem-title">{active.title}</h2>
                  )}
                  <div className="mem-main-actions">
                    {editing ? (
                      <>
                        <button className="btn btn-ghost btn-xs" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
                        <button className="btn btn-primary btn-xs" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-ghost btn-xs" onClick={startEdit}>✎ Edit</button>
                        <button className="btn btn-ghost btn-xs mem-del" onClick={() => void remove(active.id, active.title)}>Delete</button>
                      </>
                    )}
                  </div>
                </div>
                {editing ? (
                  <textarea className="mem-editor" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
                ) : (
                  <div className="mem-preview" onClick={onPreviewClick} dangerouslySetInnerHTML={{ __html: renderMarkdown(active.content.replace(/^\s*#\s+.*\r?\n+/, '')) }} />
                )}
              </>
            ) : (
              <div className="mem-empty">Select a note.</div>
            )}
          </section>

          {/* rail: tags */}
          <aside className="mem-rail">
            {allTags.length > 0 && (
              <div className="mem-rail-sec">
                <h4>Tags</h4>
                <div className="mem-tags">
                  {allTags.map((t) => (
                    <button key={t} className={`mem-tag${tagFilter === t ? ' active' : ''}`} onClick={() => setTagFilter(tagFilter === t ? null : t)}>#{t}</button>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  )
}

// ---------------------------------------------------------------------------
// Graph view — force-directed (Obsidian-style): nodes repel, links pull, it
// settles into clusters; hovering a node highlights its neighbours.
// ---------------------------------------------------------------------------
interface SimNode { id: string; x: number; y: number; vx: number; vy: number; fixed?: boolean }

function MemoryGraph({ notes, activeId, onSelect, byTitle }: {
  notes: Note[]
  activeId: string | null
  onSelect: (id: string) => void
  byTitle: (t: string) => Note | undefined
}) {
  const W = 860, H = 560
  const simRef = useRef<{ nodes: SimNode[]; edges: [number, number][]; deg: number[] } | null>(null)
  const rafRef = useRef(0)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ id: string; moved: boolean } | null>(null)
  const [pts, setPts] = useState<SimNode[]>([])
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    const idx = new Map(notes.map((n, i) => [n.id, i]))
    const nodes: SimNode[] = notes.map((n, i) => ({
      id: n.id,
      x: W / 2 + Math.cos(i * 2.4) * (60 + i * 4),
      y: H / 2 + Math.sin(i * 2.4) * (60 + i * 4),
      vx: 0, vy: 0,
    }))
    const edges: [number, number][] = []
    notes.forEach((n, i) => {
      for (const l of extractWikiLinks(n.content)) {
        const t = byTitle(l)
        const j = t ? idx.get(t.id) : undefined
        if (j != null && j !== i) edges.push([i, j])
      }
    })
    const deg = nodes.map((_, i) => edges.filter(([a, b]) => a === i || b === i).length)
    simRef.current = { nodes, edges, deg }

    // Continuous simulation (runs only while the graph view is mounted).
    const tick = () => {
      const sim = simRef.current!
      const ns = sim.nodes
      for (let a = 0; a < ns.length; a++) {
        for (let b = a + 1; b < ns.length; b++) {
          let dx = ns[a].x - ns[b].x, dy = ns[a].y - ns[b].y
          const d2 = dx * dx + dy * dy + 0.01
          const d = Math.sqrt(d2)
          const f = 2800 / d2
          dx /= d; dy /= d
          ns[a].vx += dx * f; ns[a].vy += dy * f
          ns[b].vx -= dx * f; ns[b].vy -= dy * f
        }
      }
      for (const [a, b] of sim.edges) {
        let dx = ns[b].x - ns[a].x, dy = ns[b].y - ns[a].y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const f = (d - 104) * 0.016
        dx /= d; dy /= d
        ns[a].vx += dx * f; ns[a].vy += dy * f
        ns[b].vx -= dx * f; ns[b].vy -= dy * f
      }
      for (const n of ns) {
        if (n.fixed) { n.vx = 0; n.vy = 0; continue } // pinned (being dragged)
        n.vx += (W / 2 - n.x) * 0.012
        n.vy += (H / 2 - n.y) * 0.012
        n.vx *= 0.86; n.vy *= 0.86
        n.x += n.vx; n.y += n.vy
      }
      setPts(ns.map((n) => ({ ...n })))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [notes, byTitle])

  // ---- drag ----
  const toSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const r = svg.getBoundingClientRect()
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H }
  }
  function onPointerDownNode(e: React.PointerEvent, id: string) {
    e.preventDefault()
    drag.current = { id, moved: false }
    const n = simRef.current?.nodes.find((x) => x.id === id)
    if (n) n.fixed = true
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || !simRef.current) return
    drag.current.moved = true
    const p = toSvg(e.clientX, e.clientY)
    const n = simRef.current.nodes.find((x) => x.id === drag.current!.id)
    if (n) { n.x = p.x; n.y = p.y; n.vx = 0; n.vy = 0 }
  }
  function endDrag() {
    if (!drag.current) return
    const { id, moved } = drag.current
    const n = simRef.current?.nodes.find((x) => x.id === id)
    if (n) n.fixed = false
    if (!moved) onSelect(id) // a click (no drag) opens the note
    drag.current = null
  }

  const sim = simRef.current
  const pos = new Map(pts.map((p) => [p.id, p]))
  const titleById = new Map(notes.map((n) => [n.id, n.title]))
  const neighbours = new Set<string>()
  if (hover && sim) {
    sim.edges.forEach(([a, b]) => {
      if (sim.nodes[a].id === hover) neighbours.add(sim.nodes[b].id)
      if (sim.nodes[b].id === hover) neighbours.add(sim.nodes[a].id)
    })
  }
  const dim = (id: string) => hover && id !== hover && !neighbours.has(id)

  // Curved "tentacle" link between two points (quadratic bezier, bowed).
  const edgePath = (p: SimNode, q: SimNode) => {
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2
    const dx = q.x - p.x, dy = q.y - p.y
    const d = Math.hypot(dx, dy) || 1
    const cx = mx + (-dy / d) * d * 0.14, cy = my + (dx / d) * d * 0.14
    return `M ${p.x} ${p.y} Q ${cx} ${cy} ${q.x} ${q.y}`
  }

  return (
    <div className="mem-graph">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="mem-graph-svg"
        style={{ touchAction: 'none' }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        {sim?.edges.map(([a, b], i) => {
          const p = pos.get(sim.nodes[a].id), q = pos.get(sim.nodes[b].id)
          if (!p || !q) return null
          const lit = hover && (sim.nodes[a].id === hover || sim.nodes[b].id === hover)
          return <path key={i} d={edgePath(p, q)} fill="none" className={`mem-edge${lit ? ' lit' : ''}`} opacity={hover && !lit ? 0.12 : undefined} />
        })}
        {pts.map((p, i) => {
          const r = Math.min(22, 7 + (sim?.deg[i] ?? 0) * 2.5)
          const isActive = p.id === activeId
          return (
            <g
              key={p.id}
              className={`mem-node${isActive ? ' active' : ''}${p.id === hover ? ' hover' : ''}`}
              opacity={dim(p.id) ? 0.25 : 1}
              onPointerDown={(e) => onPointerDownNode(e, p.id)}
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover(null)}
            >
              <circle cx={p.x} cy={p.y} r={r} />
              <text x={p.x} y={p.y + r + 13} textAnchor="middle">{(titleById.get(p.id) ?? '').slice(0, 22)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Knowledge graph — the native memory engine's entities (nodes, coloured by
// type) + facts (edges, labelled by predicate). Same force layout as the notes
// graph. Selecting an entity lists all its facts (incl. literal-valued ones).
// ---------------------------------------------------------------------------
const TYPE_COLOR: Record<string, string> = {
  company: '#22d3ee', person: '#a78bfa', product: '#f472b6', place: '#4ade80',
  event: '#facc15', metric: '#fb923c', concept: '#94a3b8',
}

const ENTITY_TYPES = ['person', 'company', 'product', 'place', 'concept', 'event', 'metric']

function KnowledgeGraph({ data, orgId, token, onMutated }: {
  data: MemoryGraphData
  orgId: string
  token: () => Promise<string>
  onMutated: () => void
}) {
  const W = 860, H = 560
  const simRef = useRef<{ nodes: SimNode[]; edges: [number, number, string][]; deg: number[] } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ id: string; moved: boolean } | null>(null)
  const [pts, setPts] = useState<SimNode[]>([])
  const [hover, setHover] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  // View controls: search, type filters, focus (ego-network) mode, edge hover
  const [search, setSearch] = useState('')
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())
  const [focusRoot, setFocusRoot] = useState<string | null>(null)
  const [hoverEdge, setHoverEdge] = useState<number | null>(null)

  // Curation state
  const [editing, setEditing] = useState(false)
  const [eName, setEName] = useState('')
  const [eType, setEType] = useState('concept')
  const [eSummary, setESummary] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = async (fn: (t: string) => Promise<unknown>, keepSelection = false) => {
    setBusy(true); setErr(null)
    try {
      await fn(await token())
      setEditing(false); setMergeTarget('')
      if (!keepSelection) setSelected(null)
      onMutated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed.')
    } finally { setBusy(false) }
  }
  useEffect(() => { setEditing(false); setErr(null); setMergeTarget('') }, [selected])
  // Zoom/pan via the SVG viewBox. Smaller w/h = zoomed in.
  const [view, setView] = useState({ x: 0, y: 0, w: W, h: H })
  const pan = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const entityById = useMemo(() => new Map(data.entities.map((e) => [e.id, e])), [data.entities])

  // Drop focus/selection if the entity was deleted/merged away on reload.
  useEffect(() => {
    if (focusRoot && !entityById.has(focusRoot)) setFocusRoot(null)
    if (selected && !entityById.has(selected)) setSelected(null)
  }, [entityById, focusRoot, selected])

  function zoomAround(factor: number, fx = 0.5, fy = 0.5) {
    setView((v) => {
      const nw = Math.min(W * 3, Math.max(W * 0.12, v.w * factor))
      const nh = nw * (H / W)
      return { x: v.x + fx * v.w - fx * nw, y: v.y + fy * v.h - fy * nh, w: nw, h: nh }
    })
  }
  const resetView = () => setView({ x: 0, y: 0, w: W, h: H })

  // Native non-passive wheel listener so we can zoom toward the cursor.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = svg.getBoundingClientRect()
      zoomAround(e.deltaY < 0 ? 0.85 : 1 / 0.85, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const idx = new Map(data.entities.map((e, i) => [e.id, i]))
    const nodes: SimNode[] = data.entities.map((e, i) => ({
      id: e.id,
      x: W / 2 + Math.cos(i * 2.4) * (60 + i * 3),
      y: H / 2 + Math.sin(i * 2.4) * (60 + i * 3),
      vx: 0, vy: 0,
    }))
    const edges: [number, number, string][] = []
    for (const f of data.facts) {
      if (!f.objectId) continue
      const a = idx.get(f.subjectId), b = idx.get(f.objectId)
      if (a != null && b != null && a !== b) edges.push([a, b, f.predicate])
    }
    const deg = nodes.map((_, i) => edges.filter(([a, b]) => a === i || b === i).length)

    // Settle the layout synchronously (no on-screen "dancing"): run the force
    // simulation to convergence in one pass, then render the final positions.
    const N = nodes.length
    const iters = Math.min(700, 300 + N * 6)
    for (let it = 0; it < iters; it++) {
      const cool = 1 - it / iters
      for (let a = 0; a < N; a++) {
        for (let b = a + 1; b < N; b++) {
          let dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y
          const d2 = dx * dx + dy * dy + 0.01
          const d = Math.sqrt(d2)
          const f = 2600 / d2
          dx /= d; dy /= d
          nodes[a].vx += dx * f; nodes[a].vy += dy * f
          nodes[b].vx -= dx * f; nodes[b].vy -= dy * f
        }
      }
      for (const [a, b] of edges) {
        let dx = nodes[b].x - nodes[a].x, dy = nodes[b].y - nodes[a].y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const f = (d - 110) * 0.016
        dx /= d; dy /= d
        nodes[a].vx += dx * f; nodes[a].vy += dy * f
        nodes[b].vx -= dx * f; nodes[b].vy -= dy * f
      }
      for (const n of nodes) {
        n.vx += (W / 2 - n.x) * 0.012
        n.vy += (H / 2 - n.y) * 0.012
        n.vx *= 0.82; n.vy *= 0.82
        n.x += n.vx * cool; n.y += n.vy * cool
      }
    }
    for (const n of nodes) { n.vx = 0; n.vy = 0 }
    simRef.current = { nodes, edges, deg }
    setPts(nodes.map((n) => ({ ...n })))
    setView({ x: 0, y: 0, w: W, h: H })
  }, [data])

  const toSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const r = svg.getBoundingClientRect()
    return { x: view.x + ((clientX - r.left) / r.width) * view.w, y: view.y + ((clientY - r.top) / r.height) * view.h }
  }
  function onDown(e: React.PointerEvent, id: string) {
    e.preventDefault(); e.stopPropagation() // don't also start a background pan
    drag.current = { id, moved: false }
    const n = simRef.current?.nodes.find((x) => x.id === id)
    if (n) n.fixed = true
  }
  function onBgDown(e: React.PointerEvent) {
    pan.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }
  }
  function onMove(e: React.PointerEvent) {
    if (pan.current) {
      const svg = svgRef.current; if (!svg) return
      const r = svg.getBoundingClientRect()
      const dx = ((e.clientX - pan.current.sx) / r.width) * view.w
      const dy = ((e.clientY - pan.current.sy) / r.height) * view.h
      setView((v) => ({ ...v, x: pan.current!.ox - dx, y: pan.current!.oy - dy }))
      return
    }
    if (!drag.current || !simRef.current) return
    drag.current.moved = true
    const p = toSvg(e.clientX, e.clientY)
    const n = simRef.current.nodes.find((x) => x.id === drag.current!.id)
    if (n) { n.x = p.x; n.y = p.y; n.vx = 0; n.vy = 0 }
    setPts(simRef.current.nodes.map((x) => ({ ...x }))) // no rAF loop — repaint on drag
  }
  function onUp() {
    pan.current = null
    if (!drag.current) return
    const { id, moved } = drag.current
    const n = simRef.current?.nodes.find((x) => x.id === id)
    if (n) n.fixed = false
    if (!moved) setSelected((s) => (s === id ? null : id))
    drag.current = null
  }

  const sim = simRef.current
  const pos = new Map(pts.map((p) => [p.id, p]))
  const focus = hover ?? selected
  const q = search.trim().toLowerCase()
  const matchIds = q ? new Set(data.entities.filter((e) => e.name.toLowerCase().includes(q)).map((e) => e.id)) : null

  const neighborIdsOf = (id: string): string[] => {
    const out: string[] = []
    if (!sim) return out
    sim.edges.forEach(([a, b]) => {
      if (sim.nodes[a].id === id) out.push(sim.nodes[b].id)
      else if (sim.nodes[b].id === id) out.push(sim.nodes[a].id)
    })
    return out
  }

  // Focus mode isolates a node's 1-hop ego-network; type filters hide whole types.
  const focusSet = focusRoot ? new Set([focusRoot, ...neighborIdsOf(focusRoot)]) : null
  const isVisible = (id: string): boolean => {
    const e = entityById.get(id)
    if (!e) return false
    if (hiddenTypes.has(e.type)) return false
    if (focusSet && !focusSet.has(id)) return false
    return true
  }

  const neighbours = new Set<string>()
  if (focus && sim) {
    sim.edges.forEach(([a, b]) => {
      if (sim.nodes[a].id === focus) neighbours.add(sim.nodes[b].id)
      if (sim.nodes[b].id === focus) neighbours.add(sim.nodes[a].id)
    })
  }
  const dim = (id: string): boolean => {
    if (matchIds && !matchIds.has(id)) return true
    if (!focusRoot && focus && id !== focus && !neighbours.has(id)) return true
    return false
  }

  // Node radius blends graph connectivity (degree) and importance (mentions).
  const nodeRadius = (i: number): number => {
    const id = sim?.nodes[i]?.id
    const e = id ? entityById.get(id) : undefined
    const deg = sim?.deg[i] ?? 0
    return Math.max(6, Math.min(26, 6 + deg * 1.7 + Math.sqrt(e?.mentionCount ?? 1) * 2))
  }

  // Declutter: only label hovered/selected/matched/big nodes unless zoomed in.
  const zoomK = W / view.w
  const showLabel = (id: string, r: number): boolean =>
    id === hover || id === selected || !!matchIds?.has(id) || zoomK >= 1.1 || r >= 12

  const fitTo = (ids: string[]) => {
    const ps = ids.map((id) => pos.get(id)).filter(Boolean) as SimNode[]
    if (!ps.length) { resetView(); return }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of ps) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y) }
    const pad = 70
    let w = Math.max(maxX - minX + pad * 2, W * 0.18)
    let h = Math.max(maxY - minY + pad * 2, H * 0.18)
    if (w / h < W / H) w = h * (W / H); else h = w * (H / W)
    setView({ x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h })
  }
  const fitAll = () => fitTo(data.entities.filter((e) => isVisible(e.id)).map((e) => e.id))
  const enterFocus = (id: string) => { setFocusRoot(id); fitTo([id, ...neighborIdsOf(id)]) }
  const exitFocus = () => { setFocusRoot(null); resetView() }
  const toggleType = (t: string) => setHiddenTypes((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n })

  const edgePath = (p: { x: number; y: number }, qn: { x: number; y: number }) => {
    const mx = (p.x + qn.x) / 2, my = (p.y + qn.y) / 2
    const dx = qn.x - p.x, dy = qn.y - p.y
    const d = Math.hypot(dx, dy) || 1
    const cx = mx + (-dy / d) * d * 0.14, cy = my + (dx / d) * d * 0.14
    return `M ${p.x} ${p.y} Q ${cx} ${cy} ${qn.x} ${qn.y}`
  }

  // Facts to list for the selected entity (entity-edges + literal-valued).
  const selEntity = selected ? entityById.get(selected) : null
  const selFacts = selected ? data.facts.filter((f) => f.subjectId === selected || f.objectId === selected) : []

  return (
    <div className="mem-kg">
      <div className="mem-kg-controls">
        <div className="mem-kg-searchbox">
          <span className="mem-kg-search-ic">⌕</span>
          <input
            className="mem-kg-search"
            placeholder="Search entities…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && matchIds?.size) fitTo([...matchIds]) }}
          />
          {search && <button type="button" className="mem-kg-search-clear" onClick={() => setSearch('')}>✕</button>}
        </div>
        <div className="mem-kg-legend">
          {Object.entries(TYPE_COLOR).map(([t, c]) => {
            const off = hiddenTypes.has(t)
            return (
              <button key={t} type="button" className={`mem-kg-leg${off ? ' is-off' : ''}`}
                onClick={() => toggleType(t)} title={off ? `Show ${t}` : `Hide ${t}`}>
                <span className="mem-kg-dot" style={{ background: c }} />{t}
              </button>
            )
          })}
        </div>
        {focusRoot && (
          <button type="button" className="mem-kg-focus-exit" onClick={exitFocus} title="Exit focus mode">
            ⊙ {entityById.get(focusRoot)?.name?.slice(0, 22) ?? 'focus'} ✕
          </button>
        )}
      </div>
      <div className="mem-kg-stage">
        <div className="mem-kg-zoom">
          <button type="button" title="Zoom in" onClick={() => zoomAround(0.8)}>+</button>
          <button type="button" title="Zoom out" onClick={() => zoomAround(1.25)}>−</button>
          <button type="button" title="Fit to view" onClick={fitAll}>⤢</button>
        </div>
        <svg
          ref={svgRef} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className="mem-graph-svg"
          style={{ touchAction: 'none', cursor: pan.current ? 'grabbing' : 'grab' }}
          onPointerDown={onBgDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
        >
          <defs>
            <marker id="kg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" className="mem-arrow" />
            </marker>
            <marker id="kg-arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" className="mem-arrow-lit" />
            </marker>
          </defs>
          {sim?.edges.map(([a, b, label], i) => {
            const aId = sim.nodes[a].id, bId = sim.nodes[b].id
            if (!isVisible(aId) || !isVisible(bId)) return null
            const p = pos.get(aId), qn = pos.get(bId)
            if (!p || !qn) return null
            const lit = (!!focus && (aId === focus || bId === focus)) || hoverEdge === i
            const ra = nodeRadius(a), rb = nodeRadius(b)
            const dx = qn.x - p.x, dy = qn.y - p.y, d = Math.hypot(dx, dy) || 1
            const ux = dx / d, uy = dy / d
            const p2 = { x: p.x + ux * ra, y: p.y + uy * ra }
            const q2 = { x: qn.x - ux * (rb + 5), y: qn.y - uy * (rb + 5) }
            const faded = !focusRoot && focus && !lit
            return (
              <g key={i} opacity={faded ? 0.12 : 1}>
                <path d={edgePath(p2, q2)} fill="none" className="mem-edge-hit"
                  onMouseEnter={() => setHoverEdge(i)} onMouseLeave={() => setHoverEdge((h) => (h === i ? null : h))} />
                <path d={edgePath(p2, q2)} fill="none" className={`mem-edge${lit ? ' lit' : ''}`}
                  markerEnd={`url(#${lit ? 'kg-arrow-lit' : 'kg-arrow'})`} />
                {lit && <text className="mem-kg-edgelabel" x={(p2.x + q2.x) / 2} y={(p2.y + q2.y) / 2}>{label}</text>}
              </g>
            )
          })}
          {pts.map((p, i) => {
            if (!isVisible(p.id)) return null
            const e = entityById.get(p.id)
            const r = nodeRadius(i)
            const color = TYPE_COLOR[e?.type ?? 'concept'] ?? TYPE_COLOR.concept
            return (
              <g
                key={p.id}
                className={`mem-node${p.id === selected ? ' active' : ''}${p.id === hover ? ' hover' : ''}${matchIds?.has(p.id) ? ' match' : ''}`}
                opacity={dim(p.id) ? 0.18 : 1}
                onPointerDown={(ev) => onDown(ev, p.id)}
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover(null)}
              >
                <circle cx={p.x} cy={p.y} r={r} style={{ fill: color }} />
                {showLabel(p.id, r) && <text x={p.x} y={p.y + r + 13} textAnchor="middle">{(e?.name ?? '').slice(0, 24)}</text>}
              </g>
            )
          })}
        </svg>

        {selEntity && (
          <aside className="mem-kg-panel">
            <div className="mem-kg-panel-head">
              <span className="mem-kg-dot" style={{ background: TYPE_COLOR[selEntity.type] ?? TYPE_COLOR.concept }} />
              <strong>{selEntity.name}</strong>
              <span className="mem-kg-type">{selEntity.type}</span>
              <button className="mem-kg-close" onClick={() => setSelected(null)}>✕</button>
            </div>

            {!editing ? (<>
              {selEntity.summary && <p className="mem-kg-summary">{selEntity.summary}</p>}

              {/* curation toolbar */}
              <div className="mem-kg-tools">
                <button type="button" className="btn btn-ghost btn-xs"
                  onClick={() => (focusRoot === selEntity.id ? exitFocus() : enterFocus(selEntity.id))}>
                  {focusRoot === selEntity.id ? '⊙ Unfocus' : '⊙ Focus'}
                </button>
                <button type="button" className="btn btn-ghost btn-xs" disabled={busy}
                  onClick={() => { setEName(selEntity.name); setEType(selEntity.type); setESummary(selEntity.summary ?? ''); setEditing(true) }}>✎ Edit</button>
                <button type="button" className="btn btn-ghost btn-xs mem-kg-danger" disabled={busy}
                  onClick={() => { if (confirm(`Delete "${selEntity.name}" and its ${selFacts.length} fact(s)? This cannot be undone.`)) void run((t) => deleteMemoryEntity(t, orgId, selEntity.id)) }}>🗑 Delete</button>
              </div>

              {/* merge into another entity */}
              <div className="mem-kg-merge">
                <label>Merge into</label>
                <div className="mem-kg-merge-row">
                  <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} disabled={busy}>
                    <option value="">Choose entity…</option>
                    {data.entities.filter((e) => e.id !== selEntity.id).map((e) => (
                      <option key={e.id} value={e.id}>{e.name} ({e.type})</option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-primary btn-xs" disabled={busy || !mergeTarget}
                    onClick={() => {
                      const tgt = data.entities.find((e) => e.id === mergeTarget)
                      if (tgt && confirm(`Merge "${selEntity.name}" into "${tgt.name}"? All facts move to "${tgt.name}" and "${selEntity.name}" is removed.`)) {
                        void run((t) => mergeMemoryEntities(t, orgId, selEntity.id, mergeTarget))
                      }
                    }}>Merge</button>
                </div>
              </div>
            </>) : (
              <div className="mem-kg-edit">
                <label>Name<input value={eName} onChange={(e) => setEName(e.target.value)} disabled={busy} /></label>
                <label>Type
                  <select value={eType} onChange={(e) => setEType(e.target.value)} disabled={busy}>
                    {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label>Summary<textarea rows={3} value={eSummary} onChange={(e) => setESummary(e.target.value)} disabled={busy} /></label>
                <div className="mem-kg-edit-actions">
                  <button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
                  <button type="button" className="btn btn-primary btn-xs" disabled={busy || !eName.trim()}
                    onClick={() => void run((t) => updateMemoryEntity(t, orgId, selEntity.id, { name: eName.trim(), type: eType, summary: eSummary }), true)}>
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}

            {err && <div className="mem-kg-err">{err}</div>}

            <h5>Facts ({selFacts.length})</h5>
            <ul className="mem-kg-facts">
              {selFacts.map((f) => (
                <li key={f.id} className={f.validTo ? 'is-stale' : ''}>
                  <span className="mem-kg-fact-txt">{f.statement}{f.validTo && <em> (superseded)</em>}</span>
                  <button type="button" className="mem-kg-fact-del" title="Delete this fact" disabled={busy}
                    onClick={() => void run((t) => deleteMemoryFact(t, orgId, f.id), true)}>✕</button>
                </li>
              ))}
              {selFacts.length === 0 && <li className="mem-kg-empty">No facts recorded.</li>}
            </ul>
          </aside>
        )}
      </div>
    </div>
  )
}

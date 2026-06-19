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

  const backlinks = useMemo(() => {
    if (!active) return []
    return notes.filter((n) => n.id !== active.id && extractWikiLinks(n.content).some((l) => l.toLowerCase() === active.title.toLowerCase()))
  }, [notes, active])

  const outgoing = useMemo(() => (active ? extractWikiLinks(active.content) : []), [active])

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
            <KnowledgeGraph data={kg} />
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
              {filtered.map((n) => (
                <button key={n.id} className={`mem-list-item${n.id === activeId ? ' active' : ''}`} onClick={() => select(n.id)}>
                  📝 {n.title}
                </button>
              ))}
              {filtered.length === 0 && <div className="mem-empty">No matches.</div>}
            </div>
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
                  <div className="mem-preview" onClick={onPreviewClick} dangerouslySetInnerHTML={{ __html: renderMarkdown(active.content) }} />
                )}
              </>
            ) : (
              <div className="mem-empty">Select a note.</div>
            )}
          </section>

          {/* rail: links + backlinks + tags */}
          <aside className="mem-rail">
            <div className="mem-rail-sec">
              <h4>Links</h4>
              {outgoing.length === 0 ? <p className="mem-rail-empty">No links. Use [[Note name]].</p> : outgoing.map((t) => (
                <button key={t} className="mem-rail-link" onClick={() => void openWiki(t)}>{t}{byTitle(t) ? '' : ' (new)'}</button>
              ))}
            </div>
            <div className="mem-rail-sec">
              <h4>Backlinks</h4>
              {backlinks.length === 0 ? <p className="mem-rail-empty">Nothing links here yet.</p> : backlinks.map((n) => (
                <button key={n.id} className="mem-rail-link" onClick={() => select(n.id)}>{n.title}</button>
              ))}
            </div>
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

function KnowledgeGraph({ data }: { data: MemoryGraphData }) {
  const W = 860, H = 560
  const simRef = useRef<{ nodes: SimNode[]; edges: [number, number, string][]; deg: number[] } | null>(null)
  const rafRef = useRef(0)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ id: string; moved: boolean } | null>(null)
  const [pts, setPts] = useState<SimNode[]>([])
  const [hover, setHover] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const entityById = useMemo(() => new Map(data.entities.map((e) => [e.id, e])), [data.entities])

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
    simRef.current = { nodes, edges, deg }

    const tick = () => {
      const sim = simRef.current!
      const ns = sim.nodes
      for (let a = 0; a < ns.length; a++) {
        for (let b = a + 1; b < ns.length; b++) {
          let dx = ns[a].x - ns[b].x, dy = ns[a].y - ns[b].y
          const d2 = dx * dx + dy * dy + 0.01
          const d = Math.sqrt(d2)
          const f = 2600 / d2
          dx /= d; dy /= d
          ns[a].vx += dx * f; ns[a].vy += dy * f
          ns[b].vx -= dx * f; ns[b].vy -= dy * f
        }
      }
      for (const [a, b] of sim.edges) {
        let dx = ns[b].x - ns[a].x, dy = ns[b].y - ns[a].y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const f = (d - 110) * 0.016
        dx /= d; dy /= d
        ns[a].vx += dx * f; ns[a].vy += dy * f
        ns[b].vx -= dx * f; ns[b].vy -= dy * f
      }
      for (const n of ns) {
        if (n.fixed) { n.vx = 0; n.vy = 0; continue }
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
  }, [data])

  const toSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const r = svg.getBoundingClientRect()
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H }
  }
  function onDown(e: React.PointerEvent, id: string) {
    e.preventDefault()
    drag.current = { id, moved: false }
    const n = simRef.current?.nodes.find((x) => x.id === id)
    if (n) n.fixed = true
  }
  function onMove(e: React.PointerEvent) {
    if (!drag.current || !simRef.current) return
    drag.current.moved = true
    const p = toSvg(e.clientX, e.clientY)
    const n = simRef.current.nodes.find((x) => x.id === drag.current!.id)
    if (n) { n.x = p.x; n.y = p.y; n.vx = 0; n.vy = 0 }
  }
  function onUp() {
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
  const neighbours = new Set<string>()
  if (focus && sim) {
    sim.edges.forEach(([a, b]) => {
      if (sim.nodes[a].id === focus) neighbours.add(sim.nodes[b].id)
      if (sim.nodes[b].id === focus) neighbours.add(sim.nodes[a].id)
    })
  }
  const dim = (id: string) => focus && id !== focus && !neighbours.has(id)

  const edgePath = (p: SimNode, q: SimNode) => {
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2
    const dx = q.x - p.x, dy = q.y - p.y
    const d = Math.hypot(dx, dy) || 1
    const cx = mx + (-dy / d) * d * 0.14, cy = my + (dx / d) * d * 0.14
    return `M ${p.x} ${p.y} Q ${cx} ${cy} ${q.x} ${q.y}`
  }

  // Facts to list for the selected entity (entity-edges + literal-valued).
  const selEntity = selected ? entityById.get(selected) : null
  const selFacts = selected ? data.facts.filter((f) => f.subjectId === selected || f.objectId === selected) : []

  return (
    <div className="mem-kg">
      <div className="mem-kg-legend">
        {Object.entries(TYPE_COLOR).map(([t, c]) => (
          <span key={t} className="mem-kg-leg"><span className="mem-kg-dot" style={{ background: c }} />{t}</span>
        ))}
      </div>
      <div className="mem-kg-stage">
        <svg
          ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="mem-graph-svg" style={{ touchAction: 'none' }}
          onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
        >
          {sim?.edges.map(([a, b, label], i) => {
            const p = pos.get(sim.nodes[a].id), q = pos.get(sim.nodes[b].id)
            if (!p || !q) return null
            const lit = !!focus && (sim.nodes[a].id === focus || sim.nodes[b].id === focus)
            return (
              <g key={i}>
                <path d={edgePath(p, q)} fill="none" className={`mem-edge${lit ? ' lit' : ''}`} opacity={focus && !lit ? 0.1 : undefined} />
                {lit && <text className="mem-kg-edgelabel" x={(p.x + q.x) / 2} y={(p.y + q.y) / 2}>{label}</text>}
              </g>
            )
          })}
          {pts.map((p, i) => {
            const e = entityById.get(p.id)
            const r = Math.min(20, 7 + (sim?.deg[i] ?? 0) * 2.4)
            const color = TYPE_COLOR[e?.type ?? 'concept'] ?? TYPE_COLOR.concept
            return (
              <g
                key={p.id}
                className={`mem-node${p.id === selected ? ' active' : ''}${p.id === hover ? ' hover' : ''}`}
                opacity={dim(p.id) ? 0.2 : 1}
                onPointerDown={(ev) => onDown(ev, p.id)}
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover(null)}
              >
                <circle cx={p.x} cy={p.y} r={r} style={{ fill: color }} />
                <text x={p.x} y={p.y + r + 13} textAnchor="middle">{(e?.name ?? '').slice(0, 24)}</text>
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
            {selEntity.summary && <p className="mem-kg-summary">{selEntity.summary}</p>}
            <h5>Facts ({selFacts.length})</h5>
            <ul className="mem-kg-facts">
              {selFacts.map((f) => (
                <li key={f.id} className={f.validTo ? 'is-stale' : ''}>
                  {f.statement}{f.validTo && <em> (superseded)</em>}
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

// Innovation — the org's innovation garden.
//   Build  — vibecode a tool in an isolated e2b sandbox with a coding agent,
//            then watch it run in a live preview (the "Lab").
//   Garden — a walled, org-only wall of published tools.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  listInnovationProjects,
  createInnovationProject,
  chatInnovation,
  resumeInnovationSandbox,
  publishInnovation,
  deleteInnovationProject,
  setInnovationSources,
  listContext,
  createContext,
  getOrgVault,
  type InnovationProject,
  type ContextItem,
  type VaultConnector,
  type AgentStep,
} from '../lib/api'
import './innovation.css'

type Engine = 'claude' | 'gemini' | 'codex' | 'openrouter'
const ENGINES: { id: Engine; label: string; vendor: string }[] = [
  { id: 'claude',     label: 'Claude',     vendor: 'Anthropic' },
  { id: 'gemini',     label: 'Gemini',     vendor: 'Google' },
  { id: 'codex',      label: 'Codex',      vendor: 'OpenAI' },
  { id: 'openrouter', label: 'OpenRouter', vendor: 'Any model' },
]
const engineLabel = (e: string) => ENGINES.find((x) => x.id === e)?.label ?? e
// Friendly labels for Data Vault item kinds (context_items.kind).
const KIND_LABEL: Record<string, string> = {
  doc: 'Document', note: 'Note', mcp: 'MCP', website: 'Website', data: 'Dataset', html: 'HTML', image: 'Image',
}
// Connector kinds that are databases (mirrors the Vault's Databases tab).
const DB_KINDS = new Set(['snowflake', 'sqlserver', 'sap', 'postgres', 'postgresql', 'mysql', 'mariadb', 'supabase', 'redshift', 'bigquery', 'oracle', 'databricks', 'mongodb', 'mssql', 'db2'])
// Map any source kind to a friendly TYPE label used by the dropdown.
function srcTypeLabel(kind: string): string {
  if (DB_KINDS.has(kind)) return 'Database'
  if (kind === 'rest' || kind === 'api' || kind === 'http') return 'API'
  return KIND_LABEL[kind] ?? kind
}
function srcIcon(kind: string): string {
  if (DB_KINDS.has(kind)) return '🗄️'
  if (kind === 'rest' || kind === 'api' || kind === 'http') return '⚡'
  if (kind === 'mcp') return '🔌'
  if (kind === 'note') return '✎'
  if (kind === 'website') return '🌐'
  return '📄'
}

export default function Innovation() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()
  const token = useCallback(async () => {
    const t = await getAccessToken()
    if (!t) throw new Error('Session expired — please sign in again.')
    return t
  }, [getAccessToken])

  const [tab, setTab] = useState<'build' | 'garden'>('build')
  const [mine, setMine] = useState<InnovationProject[]>([])
  const [garden, setGarden] = useState<InnovationProject[]>([])
  const [active, setActive] = useState<{ project: InnovationProject; autostart: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Build composer
  const [brief, setBrief] = useState('')
  const [engine, setEngine] = useState<Engine>('claude')
  const [building, setBuilding] = useState(false)
  // Remember the chosen model: default to the engine of your most recent project
  // (persisted on innovation_projects.engine) until you pick a different one.
  const userPickedEngine = useRef(false)
  useEffect(() => {
    if (userPickedEngine.current) return
    const last = mine[0]?.engine
    if (last && ENGINES.some((e) => e.id === last)) setEngine(last as Engine)
  }, [mine])
  const [deleting, setDeleting] = useState<string | null>(null)

  async function removeProject(p: InnovationProject) {
    if (!confirm(`Delete “${p.name}”? This permanently removes the project and its sandbox.`)) return
    setDeleting(p.id); setError(null)
    try {
      await deleteInnovationProject(await token(), orgId, p.id)
      setMine((prev) => prev.filter((x) => x.id !== p.id))
      setGarden((prev) => prev.filter((x) => x.id !== p.id))
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the project.') }
    finally { setDeleting(null) }
  }

  const load = useCallback(async () => {
    try {
      const t = await token()
      const [m, g] = await Promise.all([
        listInnovationProjects(t, orgId, 'mine'),
        listInnovationProjects(t, orgId, 'garden'),
      ])
      setMine(m.projects); setGarden(g.projects)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load projects.') }
  }, [token, orgId])
  useEffect(() => { void load() }, [load])

  async function build() {
    if (!brief.trim() || building) return
    setBuilding(true); setError(null)
    try {
      const p = await createInnovationProject(await token(), orgId, { brief: brief.trim(), engine })
      setBrief('')
      setActive({ project: p, autostart: true })
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start the build.') }
    finally { setBuilding(false) }
  }

  // Open a published tool as a standalone app — just the running app, full window,
  // no DeepLogic chrome. Resume the sandbox first so the URL is guaranteed live.
  const [launching, setLaunching] = useState<string | null>(null)
  async function openLive(t: InnovationProject) {
    // Open the tab synchronously (inside the click gesture) to dodge popup blockers.
    const w = window.open('', '_blank')
    if (w) w.document.write(`<!doctype html><meta charset="utf8"><title>${(t.name || 'App').replace(/[<>]/g, '')}</title><body style="margin:0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0b0f14;color:#9fb0c0">Starting ${(t.name || 'app').replace(/[<>]/g, '')}…</body>`)
    setLaunching(t.id); setError(null)
    try {
      const r = await resumeInnovationSandbox(await token(), orgId, t.id)
      const url = r.previewUrl
      if (!url) throw new Error('This app has no running preview.')
      if (w) w.location.replace(url)
      else window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      if (w) w.close()
      setError(e instanceof Error ? e.message : 'Could not launch the app.')
    } finally { setLaunching(null) }
  }

  if (active) {
    return (
      <Workspace
        key={active.project.id}
        initial={active.project}
        autostart={active.autostart}
        orgId={orgId}
        token={token}
        onBack={() => { setActive(null); void load() }}
      />
    )
  }

  return (
    <main className="wrap inv">
      <header className="inv-head">
        <div>
          <h1><span className="grad-text">Innovation Garden</span></h1>
          <p className="inv-lead">Vibecode internal tools in a sandbox — then share them on your team’s walled wall.</p>
        </div>
        <div className="inv-tabs" role="tablist">
          <button type="button" className={`inv-tab${tab === 'build' ? ' is-on' : ''}`} onClick={() => setTab('build')}>⚒ Build</button>
          <button type="button" className={`inv-tab${tab === 'garden' ? ' is-on' : ''}`} onClick={() => setTab('garden')}>🌱 Garden</button>
        </div>
      </header>

      {error && <div className="inv-error">{error}</div>}

      {tab === 'build' ? (
        <section className="inv-build">
          <div className="inv-composer">
            <textarea
              className="inv-brief"
              rows={4}
              placeholder="Describe the tool you want to build — e.g. “a tic-tac-toe game”, or “an internal app so ops can re-grade leads”. It’s grounded in your Data Vault."
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void build() }}
            />
            <div className="inv-composer-row">
              <div className="inv-engine" role="radiogroup" aria-label="Model">
                {ENGINES.map((e) => (
                  <button key={e.id} type="button" role="radio" aria-checked={engine === e.id}
                    className={`inv-engine-opt${engine === e.id ? ' is-on' : ''}`}
                    onClick={() => { setEngine(e.id); userPickedEngine.current = true }} title={e.vendor}>
                    {e.label}
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-primary" onClick={() => void build()} disabled={!brief.trim() || building}>
                {building ? 'Starting…' : 'Build it →'}
              </button>
            </div>
          </div>

          <div className="inv-section-head">
            <h2>Your projects</h2>
            <span className="inv-count">{mine.length}</span>
          </div>
          {mine.length === 0 ? (
            <div className="inv-empty">No projects yet — describe a tool above and hit <strong>Build it</strong>.</div>
          ) : (
            <div className="inv-grid">
              {mine.map((p) => (
                <article key={p.id} className="inv-card inv-card--clickable" role="button" tabIndex={0}
                  onClick={() => setActive({ project: p, autostart: false })}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive({ project: p, autostart: false }) } }}>
                  <div className="inv-card-top">
                    <span className={`inv-status inv-status--${p.status}`}>{p.status}</span>
                    <span className="inv-engine-badge">{engineLabel(p.engine)}</span>
                  </div>
                  <h3>{p.name}</h3>
                  <p className="inv-card-sub">{p.brief}</p>
                  <div className="inv-card-foot">
                    <span className="inv-meta">{p.published ? '🌱 published' : 'draft'}</span>
                    <div className="inv-card-actions">
                      <button type="button" className="inv-card-del" title="Delete project" disabled={deleting === p.id}
                        onClick={(e) => { e.stopPropagation(); void removeProject(p) }}>{deleting === p.id ? '…' : '🗑'}</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="inv-garden">
          {garden.length === 0 ? (
            <div className="inv-empty">The garden is empty — publish a tool from one of your projects to share it with the team.</div>
          ) : (
            <div className="inv-grid">
              {garden.map((t) => (
                <article key={t.id} className={`inv-card inv-tool${t.featured ? ' is-featured' : ''}`}>
                  {t.featured && <span className="inv-featured">★ Featured</span>}
                  <div className="inv-card-top">
                    <span className="inv-engine-badge">{engineLabel(t.engine)}</span>
                  </div>
                  <h3>{t.name}</h3>
                  <p className="inv-card-sub">{t.tagline || t.brief}</p>
                  <div className="inv-tool-tags">{t.tags.map((x) => <span key={x} className="inv-tool-tag">#{x}</span>)}</div>
                  <div className="inv-card-foot">
                    <span className="inv-meta">★ {t.stars}</span>
                    <div className="inv-card-actions">
                      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setActive({ project: t, autostart: false })}>Details</button>
                      <button type="button" className="btn btn-primary btn-xs" disabled={launching === t.id} onClick={() => void openLive(t)}>
                        {launching === t.id ? 'Starting…' : 'Open app ↗'}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="inv-foot-note">
        Walled garden · org-only ({orgId.slice(0, 8)}…) · published tools run in isolated sandboxes and declare their data access.
      </div>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Workspace — chat (build) on the left, live preview on the right.
// ---------------------------------------------------------------------------
function Workspace({ initial, autostart, orgId, token, onBack }: {
  initial: InnovationProject
  autostart: boolean
  orgId: string
  token: () => Promise<string>
  onBack: () => void
}) {
  const [proj, setProj] = useState<InnovationProject>(initial)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [view, setView] = useState<'preview' | 'code' | 'data'>('preview')
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [previewKey, setPreviewKey] = useState(0)
  const [resuming, setResuming] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const started = useRef(false)

  // Data Vault sources that ground this project's builds
  const [vault, setVault] = useState<ContextItem[]>([])
  const [conns, setConns] = useState<VaultConnector[]>([])
  const [sources, setSources] = useState<Set<string>>(new Set(initial.dataSources))
  const [addOpen, setAddOpen] = useState(false)
  const [dataQ, setDataQ] = useState('')
  const [dataKind, setDataKind] = useState('')
  const [addKind, setAddKind] = useState<'doc' | 'note' | 'mcp'>('doc')
  const [addName, setAddName] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [addBody, setAddBody] = useState('')

  const loadVault = useCallback(async () => {
    try {
      const t = await token()
      const [items, vault] = await Promise.all([
        listContext(t, orgId),
        getOrgVault(t, orgId).then((r) => r.connectors).catch(() => [] as VaultConnector[]),
      ])
      setVault(items)
      // Databases + APIs aren't context items — add them from the vault connectors.
      setConns(vault.filter((c) => DB_KINDS.has(c.kind) || c.kind === 'rest' || c.kind === 'api' || c.kind === 'http'))
    } catch { /* ignore */ }
  }, [token, orgId])
  useEffect(() => { void loadVault() }, [loadVault])

  async function toggleSource(id: string) {
    const next = new Set(sources)
    next.has(id) ? next.delete(id) : next.add(id)
    setSources(next)
    try { setProj(await setInnovationSources(await token(), orgId, proj.id, [...next])) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not update sources.') }
  }

  async function addSource() {
    if (!addName.trim()) return
    try {
      const meta = addKind === 'mcp' ? { url: addUrl.trim(), description: addBody.trim() } : undefined
      const item = await createContext(await token(), orgId, {
        kind: addKind, name: addName.trim(),
        content: addKind === 'mcp' ? '' : addBody.trim(),
        meta, scope: 'org',
      })
      setAddName(''); setAddUrl(''); setAddBody(''); setAddOpen(false)
      await loadVault()
      await toggleSource(item.id) // auto-include the new one
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not add source.') }
  }

  // Resolve a selected source key (context-item id or `conn:<json>`) to a label.
  function sourceLabel(key: string): { name: string; kind: string } {
    if (key.startsWith('conn:')) {
      try { const d = JSON.parse(key.slice(5)) as { name?: string; kind?: string }; return { name: d.name || 'connector', kind: d.kind || '' } }
      catch { return { name: 'connector', kind: '' } }
    }
    const v = vault.find((x) => x.id === key)
    return { name: v?.name || 'source', kind: v?.kind || 'doc' }
  }

  const fileNames = useMemo(() => Object.keys(proj.files), [proj.files])
  const canEdit = proj.isOwner

  const send = useCallback(async (message: string) => {
    if (!message.trim() || busy) return
    setBusy(true); setErr(null); setSteps([])
    try {
      const r = await chatInnovation(await token(), orgId, proj.id, message.trim())
      setProj(r.project)
      setSteps(r.steps)
      setPreviewKey((k) => k + 1)
      setView('preview')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Build failed.') }
    finally { setBusy(false) }
  }, [busy, token, orgId, proj.id])

  // Kick off the first build from the brief, or resume the sandbox for a live preview.
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (autostart && proj.messages.length === 0) {
      void send(proj.brief)
    } else if (Object.keys(proj.files).length > 0) {
      // Existing project: the stored previewUrl points at a sandbox that has
      // likely expired (showing e2b's "Sandbox Not Found"). Hide it and resume to
      // a fresh sandbox before showing the iframe — avoids the error flash.
      void (async () => {
        setResuming(true)
        setProj((p) => ({ ...p, previewUrl: null }))
        try {
          const r = await resumeInnovationSandbox(await token(), orgId, proj.id)
          setProj((p) => ({ ...p, previewUrl: r.previewUrl }))
          setPreviewKey((k) => k + 1)
        } catch { /* preview unavailable until next build */ }
        finally { setResuming(false) }
      })()
    }
  }, [autostart, proj.brief, proj.messages.length, proj.files, proj.id, orgId, token, send])

  async function publish() {
    const tagline = prompt('One-line description for the garden:', proj.tagline || proj.brief.slice(0, 80))
    if (tagline === null) return
    const tags = (prompt('Tags (comma separated):', proj.tags.join(', ')) ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean)
    try {
      const updated = await publishInnovation(await token(), orgId, proj.id, { tagline: tagline.trim(), tags })
      setProj(updated)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Publish failed.') }
  }

  async function remove() {
    if (!confirm(`Delete “${proj.name}”? This cannot be undone.`)) return
    try { await deleteInnovationProject(await token(), orgId, proj.id); onBack() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Delete failed.') }
  }

  return (
    <main className="wrap inv inv-ws">
      <header className="inv-ws-head">
        <button type="button" className="inv-ws-back" onClick={onBack}>← Projects</button>
        <div className="inv-ws-title">
          <strong>{proj.name}</strong>
          <span className={`inv-status inv-status--${proj.status}`}>{proj.status}</span>
          <span className="inv-engine-badge">{engineLabel(proj.engine)}</span>
        </div>
        {canEdit && (
          <div className="inv-ws-actions">
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => void publish()}>{proj.published ? '🌱 Published' : 'Publish ▸'}</button>
            <button type="button" className="btn btn-ghost btn-xs inv-ws-del" onClick={() => void remove()}>Delete</button>
          </div>
        )}
      </header>

      <div className="inv-ws-body">
        {/* chat / build column */}
        <aside className="inv-chat">
          <div className="inv-chat-log">
            {proj.messages.length === 0 && !busy && (
              <div className="inv-chat-hint">Describe what to build or change. The agent writes files into a sandbox and the preview updates.</div>
            )}
            {proj.messages.map((m, i) => (
              <div key={i} className={`inv-msg inv-msg--${m.role}`}>{m.content}</div>
            ))}
            {busy && (
              <div className="inv-msg inv-msg--assistant inv-building">
                <span className="inv-spinner" /> Building…
                {steps.length > 0 && <ul className="inv-steps">{steps.map((s, i) => <li key={i}>{s.icon} {s.text}</li>)}</ul>}
              </div>
            )}
            {!busy && steps.length > 0 && (
              <details className="inv-steps-done"><summary>{steps.length} build step{steps.length === 1 ? '' : 's'}</summary>
                <ul className="inv-steps">{steps.map((s, i) => <li key={i}>{s.icon} {s.text}</li>)}</ul>
              </details>
            )}
          </div>
          {err && <div className="inv-error">{err}</div>}
          {sources.size > 0 && (
            <button type="button" className="inv-data-used" onClick={() => setView('data')} title="Data sources the agent builds against — click to manage">
              <span className="inv-data-used-label">📊 Data used ({sources.size})</span>
              <span className="inv-data-used-chips">
                {[...sources].slice(0, 5).map((k) => { const s = sourceLabel(k); return <span key={k} className="inv-data-used-chip">{srcIcon(s.kind)} {s.name}</span> })}
                {sources.size > 5 && <span className="inv-data-used-chip inv-data-used-more">+{sources.size - 5}</span>}
              </span>
            </button>
          )}
          {canEdit && (
            <form className="inv-chat-input" onSubmit={(e) => { e.preventDefault(); void send(input); setInput('') }}>
              <textarea rows={2} placeholder="Make a change… (⌘/Ctrl+Enter)" value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(input); setInput('') } }}
                disabled={busy} />
              <button type="submit" className="btn btn-primary btn-xs" disabled={busy || !input.trim()}>Send</button>
            </form>
          )}
        </aside>

        {/* preview / code column */}
        <section className="inv-preview">
          <div className="inv-preview-bar">
            <div className="inv-seg">
              <button type="button" className={view === 'preview' ? 'is-on' : ''} onClick={() => setView('preview')}>Preview</button>
              <button type="button" className={view === 'code' ? 'is-on' : ''} onClick={() => setView('code')}>Code{fileNames.length ? ` (${fileNames.length})` : ''}</button>
              <button type="button" className={view === 'data' ? 'is-on' : ''} onClick={() => setView('data')}>Data{sources.size ? ` (${sources.size})` : ''}</button>
            </div>
            {view === 'preview' && proj.previewUrl && (
              <div className="inv-preview-tools">
                <button type="button" title="Reload" onClick={() => setPreviewKey((k) => k + 1)}>↻</button>
                <a href={proj.previewUrl} target="_blank" rel="noreferrer" title="Open in new tab">↗</a>
              </div>
            )}
          </div>
          {view === 'preview' ? (
            resuming ? (
              <div className="inv-preview-empty"><span className="inv-spinner" /> Starting preview…</div>
            ) : proj.previewUrl ? (
              <iframe key={previewKey} className="inv-frame" src={proj.previewUrl} title="preview"
                sandbox="allow-scripts allow-forms allow-popups allow-same-origin" />
            ) : (
              <div className="inv-preview-empty">{busy ? 'Building your tool…' : 'No preview yet — send a build instruction to generate it.'}</div>
            )
          ) : view === 'code' ? (
            <div className="inv-code">
              <div className="inv-code-files">
                {fileNames.length === 0 && <div className="inv-code-empty">No files yet.</div>}
                {fileNames.map((f) => (
                  <button key={f} type="button" className={`inv-code-file${(activeFile ?? fileNames[0]) === f ? ' is-on' : ''}`} onClick={() => setActiveFile(f)}>{f}</button>
                ))}
              </div>
              <pre className="inv-code-view">{proj.files[activeFile ?? fileNames[0]] ?? ''}</pre>
            </div>
          ) : (
            <div className="inv-data">
              <div className="inv-data-hint">Pick Data Vault items to build against — docs, datasets, connected databases &amp; APIs. The agent reads the selected sources. Toggle on/off, or add a new one.</div>
              {(() => {
                // Merge context-library items + connected databases/APIs into one list.
                const all = [
                  ...vault.map((v) => ({ key: v.id, name: v.name, kind: v.kind, sub: '' })),
                  ...conns.map((c) => ({
                    key: 'conn:' + JSON.stringify({ name: c.name, kind: c.kind, url: c.url ?? '', sourceName: c.sourceName }),
                    name: c.name, kind: c.kind, sub: c.sourceName,
                  })),
                ]
                if (all.length === 0) return <div className="inv-code-empty">Your Data Vault is empty. Connect a database in the Vault, or add a document / MCP below.</div>
                const q = dataQ.trim().toLowerCase()
                const types = Array.from(new Set(all.map((s) => srcTypeLabel(s.kind))))
                const shown = all.filter((s) =>
                  (!dataKind || srcTypeLabel(s.kind) === dataKind) &&
                  (!q || s.name.toLowerCase().includes(q) || srcTypeLabel(s.kind).toLowerCase().includes(q)))
                return (
                  <>
                    <div className="inv-data-filters">
                      <div className="inv-data-search">
                        <input className="inv-data-input" placeholder="🔎 Search sources…" value={dataQ} onChange={(e) => setDataQ(e.target.value)} />
                        {dataQ && <button type="button" className="inv-data-search-x" title="Clear" onClick={() => setDataQ('')}>×</button>}
                      </div>
                      <select className="inv-data-select" value={dataKind} onChange={(e) => setDataKind(e.target.value)}>
                        <option value="">All types</option>
                        {types.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                    {shown.length === 0 ? (
                      <div className="inv-code-empty">No sources match{dataKind ? ` ${dataKind}` : ''}{dataQ ? ` “${dataQ}”` : ''}.</div>
                    ) : (
                      <div className="inv-data-list">
                        {shown.map((s) => (
                          <label key={s.key} className={`inv-data-item${sources.has(s.key) ? ' is-on' : ''}`}>
                            <input type="checkbox" checked={sources.has(s.key)} onChange={() => void toggleSource(s.key)} />
                            <span className="inv-data-ic">{srcIcon(s.kind)}</span>
                            <span className="inv-data-main"><span className="inv-data-name">{s.name}</span><span className="inv-data-kind">{srcTypeLabel(s.kind)}{s.sub ? ` · ${s.sub}` : ''}</span></span>
                          </label>
                        ))}
                      </div>
                    )}
                  </>
                )
              })()}

              {!addOpen ? (
                <button type="button" className="inv-data-add-btn" onClick={() => setAddOpen(true)}>+ Add document / MCP / API</button>
              ) : (
                <div className="inv-data-add">
                  <div className="inv-data-kinds">
                    {(['doc', 'note', 'mcp'] as const).map((k) => (
                      <button key={k} type="button" className={`inv-data-kind-opt${addKind === k ? ' is-on' : ''}`} onClick={() => setAddKind(k)}>
                        {k === 'doc' ? '📄 Document' : k === 'note' ? '✎ Note' : '🔌 MCP / API'}
                      </button>
                    ))}
                  </div>
                  <input className="inv-data-input" placeholder="Name" value={addName} onChange={(e) => setAddName(e.target.value)} />
                  {addKind === 'mcp' && (
                    <input className="inv-data-input" placeholder="MCP server URL / API endpoint" value={addUrl} onChange={(e) => setAddUrl(e.target.value)} />
                  )}
                  <textarea className="inv-data-input" rows={3}
                    placeholder={addKind === 'mcp' ? 'What it provides (description)' : 'Paste the content the agent should use…'}
                    value={addBody} onChange={(e) => setAddBody(e.target.value)} />
                  <div className="inv-data-add-actions">
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAddOpen(false)}>Cancel</button>
                    <button type="button" className="btn btn-primary btn-xs" onClick={() => void addSource()} disabled={!addName.trim()}>Add &amp; include</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

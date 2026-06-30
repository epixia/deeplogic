// DataVault — per-report data vault. Items are compiled into the AI's RAG
// context when vibe-coding. Supports manual add (File/MCP/API/Note tabs) and
// a Library tab that lets the user pick from the workspace context library.

import { useEffect, useRef, useState } from 'react'
import {
  addVaultItem,
  importPbix,
  listContext,
  removeVaultItem,
  updateVaultProj,
  type ContextItem,
  type StudioProject,
  type VaultItem,
  type VaultKind,
} from '../../lib/api'
import {
  classifyFile,
  mdHeading,
  CATEGORY_LABEL,
  VAULT_CATEGORIES,
  type VaultCategory,
} from '../../lib/vaultClassify'

const FILE_ACCEPT =
  '.pbix,.pbit,.md,.txt,.csv,.tsv,.json,.html,.htm,.xml,.yaml,.yml,.log,.sql'
const MAX_FILE_CHARS = 60000

const isPbix = (name: string) => /\.(pbix|pbit)$/i.test(name)

type Tab = VaultKind | 'library' | 'interview'

type IngestStatus = 'pending' | 'busy' | 'done' | 'error'
type IngestRow = { name: string; status: IngestStatus; error?: string }

type QA = { q: string; a: string }

const TAB_META: Record<Tab, { label: string; icon: string }> = {
  file:      { label: 'File',      icon: '⤓'  },
  mcp:       { label: 'MCP',       icon: '🔌' },
  api:       { label: 'API',       icon: '⚡' },
  note:      { label: 'Note',      icon: '✎'  },
  interview: { label: 'Interview', icon: '🎙️' },
  library:   { label: 'Library',   icon: '📚' },
}

export default function DataVault({
  orgId,
  projectId,
  vault,
  getToken,
  onChange,
}: {
  orgId: string
  projectId: string
  vault: VaultItem[]
  getToken: () => Promise<string>
  onChange: (p: StudioProject) => void
}) {
  const [tab, setTab] = useState<Tab>('file')
  const [busy, setBusy] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [localEnabled, setLocalEnabled] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<IngestRow[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // per-item editor — name, content, category, tags. PATCH returns the updated
  // project, so onChange keeps everything in sync (no optimistic shadow state).
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editCat, setEditCat] = useState<VaultCategory>('other')
  const [editTags, setEditTags] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // form fields
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [desc, setDesc] = useState('')
  const [auth, setAuth] = useState('')
  const [noteBody, setNoteBody] = useState('')

  // Interview capture form
  const [ivName, setIvName] = useState('')
  const [ivRole, setIvRole] = useState('')
  const [ivDate, setIvDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [ivTopics, setIvTopics] = useState('')
  const [ivQA, setIvQA] = useState<QA[]>([{ q: '', a: '' }])

  // Library tab
  const [libItems, setLibItems] = useState<ContextItem[]>([])
  const [libLoading, setLibLoading] = useState(false)
  const [libAdding, setLibAdding] = useState<string | null>(null)

  useEffect(() => {
    if (tab !== 'library') return
    setLibLoading(true)
    getToken().then((t) =>
      listContext(t, orgId)
        .then(setLibItems)
        .catch(() => {})
        .finally(() => setLibLoading(false))
    )
  }, [tab, orgId, getToken])

  function reset() {
    setName(''); setUrl(''); setDesc(''); setAuth(''); setNoteBody('')
    setIvName(''); setIvRole(''); setIvTopics(''); setIvQA([{ q: '', a: '' }])
    setIvDate(new Date().toISOString().slice(0, 10))
  }

  // Compile a guided interview into a clean markdown note + attribution meta so
  // the AI gets structured knowledge it can attribute to a named source.
  async function submitInterview() {
    if (busy) return
    const who = ivName.trim()
    const pairs = ivQA.filter((p) => p.q.trim() || p.a.trim())
    if (!who || pairs.length === 0) {
      setError('Add the interviewee and at least one question or answer.')
      return
    }
    const role = ivRole.trim()
    const topics = Array.from(
      new Set(ivTopics.split(',').map((s) => s.trim()).filter(Boolean))
    ).slice(0, 12)
    const heading = `Interview: ${who}${role ? ` — ${role}` : ''}`
    const lines = [`# ${heading}`, `_Captured ${ivDate}${role ? ` · ${role}` : ''}_`, '']
    for (const p of pairs) {
      if (p.q.trim()) lines.push(`**Q:** ${p.q.trim()}`)
      if (p.a.trim()) lines.push(`**A:** ${p.a.trim()}`)
      lines.push('')
    }
    await add({
      kind: 'note',
      name: heading,
      content: lines.join('\n').trim(),
      meta: {
        category: 'knowledge',
        categorySource: 'auto',
        tags: topics,
        interviewee: who,
        role,
        date: ivDate,
      },
    })
  }

  function updateQA(i: number, patch: Partial<QA>) {
    setIvQA((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  }

  async function add(item: { kind: VaultKind; name: string; content?: string; meta?: Record<string, unknown> }) {
    setBusy(true); setError(null)
    try {
      const t = await getToken()
      onChange(await addVaultItem(t, orgId, projectId, item))
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add to the vault.')
    } finally { setBusy(false) }
  }

  async function addFromLibrary(item: ContextItem) {
    setLibAdding(item.id); setError(null)
    try {
      const t = await getToken()
      const kind: VaultKind = item.kind === 'mcp' ? 'mcp'
        : item.kind === 'html' ? 'file'
        : item.kind === 'note' ? 'note'
        : 'file'
      const meta: Record<string, unknown> = item.kind === 'mcp'
        ? { url: (item.meta?.url as string) ?? '', description: item.content ?? '' }
        : { fromLibrary: item.id }
      onChange(await addVaultItem(t, orgId, projectId, {
        kind,
        name: item.name,
        content: item.content ?? '',
        meta,
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add item.')
    } finally { setLibAdding(null) }
  }

  // Add a single file to the vault. Returns the updated project so the caller
  // can keep state in sync across a batch. Does not touch busy/input state —
  // that's owned by onFiles so a multi-file upload stays atomic in the UI.
  async function addFile(file: File): Promise<StudioProject> {
    const t = await getToken()
    if (isPbix(file.name)) {
      return importPbix(t, orgId, projectId, file)
    }
    let text = ''
    try { text = await file.text() } catch { text = '' }
    return addVaultItem(t, orgId, projectId, {
      kind: 'file',
      name: file.name,
      content: text.slice(0, MAX_FILE_CHARS),
      meta: {
        filename: file.name,
        size: file.size,
        category: classifyFile(file.name, text),
        categorySource: 'auto',
        tags: [],
      },
    })
  }

  // Upload one or more files sequentially — each add returns the next project
  // snapshot, so they can't run in parallel without clobbering each other.
  // Progress is published per-file so the user sees ingestion happen live.
  async function onFiles(files: File[]) {
    if (files.length === 0) return
    setBusy(true); setError(null)
    setProgress(files.map((f) => ({ name: f.name, status: 'pending' as IngestStatus })))
    const mark = (i: number, status: IngestStatus, err?: string) =>
      setProgress((prev) => prev.map((r, j) => (j === i ? { ...r, status, error: err } : r)))

    for (let i = 0; i < files.length; i++) {
      mark(i, 'busy')
      try {
        onChange(await addFile(files[i]))
        mark(i, 'done')
      } catch (e) {
        const msg = e instanceof Error ? e.message
          : isPbix(files[i].name) ? 'Could not import the Power BI file.'
          : 'Could not add to the vault.'
        mark(i, 'error', msg)
      }
    }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onRemove(id: string) {
    setBusy(true)
    try {
      const t = await getToken()
      onChange(await removeVaultItem(t, orgId, projectId, id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove item.')
    } finally { setBusy(false) }
  }

  function isEnabled(item: VaultItem): boolean {
    return item.id in localEnabled ? localEnabled[item.id] : item.enabled !== false
  }

  async function onToggle(item: VaultItem) {
    const current = isEnabled(item)
    const next = !current
    setLocalEnabled((prev) => ({ ...prev, [item.id]: next }))
    setToggling(item.id)
    try {
      const t = await getToken()
      await updateVaultProj(t, orgId, projectId, item.id, { enabled: next })
    } catch (e) {
      setLocalEnabled((prev) => ({ ...prev, [item.id]: current }))
      setError(e instanceof Error ? e.message : 'Could not update item.')
    } finally { setToggling(null) }
  }

  // Effective category: a stored value wins; otherwise classify on the fly so
  // items added before this feature still get a sensible badge.
  function itemCategory(v: VaultItem): VaultCategory {
    const m = (v.meta ?? {}) as Record<string, unknown>
    if (typeof m.category === 'string') return m.category as VaultCategory
    if (v.kind === 'note') return 'note'
    return classifyFile(v.name, v.content)
  }

  function itemTags(v: VaultItem): string[] {
    const t = (v.meta as Record<string, unknown>)?.tags
    return Array.isArray(t) ? (t as string[]) : []
  }

  // Text content is editable for notes and any non-binary file (not Power BI).
  function canEditContent(v: VaultItem): boolean {
    return v.kind === 'note' || (v.kind === 'file' && !isPbix(v.name))
  }

  function openEdit(v: VaultItem) {
    setError(null)
    setEditingId(v.id)
    setEditName(v.name)
    setEditContent(v.content ?? '')
    setEditCat(itemCategory(v))
    setEditTags(itemTags(v).join(', '))
  }

  async function saveEdit(v: VaultItem) {
    const tags = Array.from(
      new Set(editTags.split(',').map((s) => s.trim()).filter(Boolean))
    ).slice(0, 12)
    const name = editName.trim()
    setSavingEdit(true)
    try {
      const t = await getToken()
      const patch: { name?: string; content?: string; meta?: Record<string, unknown> } = {
        meta: { category: editCat, categorySource: 'manual', tags },
      }
      if (name && name !== v.name) patch.name = name
      if (canEditContent(v) && editContent !== (v.content ?? '')) patch.content = editContent
      onChange(await updateVaultProj(t, orgId, projectId, v.id, patch))
      setEditingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update item.')
    } finally {
      setSavingEdit(false)
    }
  }

  function submitForm(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (tab === 'mcp') {
      if (!name.trim() || !url.trim()) return
      void add({ kind: 'mcp', name: name.trim(), meta: { url: url.trim(), description: desc.trim() } })
    } else if (tab === 'api') {
      if (!name.trim() || !url.trim()) return
      void add({ kind: 'api', name: name.trim(), meta: { url: url.trim(), description: desc.trim(), auth: auth.trim() } })
    } else if (tab === 'note') {
      if (!name.trim() || !noteBody.trim()) return
      void add({ kind: 'note', name: name.trim(), content: noteBody.trim() })
    }
  }

  // ids already added to vault (from library)
  const addedLibIds = new Set(
    vault.map((v) => (v.meta as Record<string, unknown>)?.fromLibrary as string).filter(Boolean)
  )

  const connectors = vault.filter((v) => v.kind === 'mcp' || v.kind === 'api')
  const content    = vault.filter((v) => v.kind === 'file' || v.kind === 'note')
  const activeCount = vault.filter((v) => isEnabled(v)).length

  const renderVaultItem = (v: VaultItem) => {
    const meta = (v.meta ?? {}) as Record<string, unknown>
    const isContent = v.kind === 'file' || v.kind === 'note'
    const heading = /\.(md|markdown)$/i.test(v.name) ? mdHeading(v.content) : ''
    const sub = typeof meta.url === 'string' ? meta.url
      : typeof meta.description === 'string' ? meta.description
      : heading ? heading
      : v.content ? `${v.content.length.toLocaleString()} chars`
      : ''
    const enabled = isEnabled(v)
    const cat = itemCategory(v)
    const tags = itemTags(v)
    const editing = editingId === v.id
    return (
      <div key={v.id} className="dv-item-wrap">
        <label className={`dv-item${enabled ? '' : ' dv-item--off'}`}>
          <input
            type="checkbox"
            className="dv-checkbox"
            checked={enabled}
            disabled={toggling === v.id}
            onChange={() => void onToggle(v)}
            aria-label={`Include "${v.name}" in AI context`}
          />
          <span className="dv-item-ic">
            {v.kind === 'mcp' ? '🔌' : v.kind === 'api' ? '⚡' : v.kind === 'note' ? '✎' : '⤓'}
          </span>
          <div className="dv-item-body">
            <div className="dv-item-name">{v.name}</div>
            <div className="dv-item-meta">
              {isContent && <span className={`dv-cat dv-cat--${cat}`}>{CATEGORY_LABEL[cat]}</span>}
              {sub && <span className="dv-item-sub">{sub}</span>}
              {tags.map((t) => <span key={t} className="dv-tag">{t}</span>)}
            </div>
          </div>
          <span className={`dv-item-badge${enabled ? ' active' : ''}`}>
            {enabled ? 'In AI' : 'Off'}
          </span>
          {isContent && (
            <button
              type="button"
              className={`dv-edit-btn${editing ? ' is-on' : ''}`}
              onClick={(e) => { e.preventDefault(); editing ? setEditingId(null) : openEdit(v) }}
              disabled={busy}
              aria-label={`Edit category and tags for ${v.name}`}
              title="Category & tags"
            >✎</button>
          )}
          <button
            type="button"
            className="dv-remove"
            onClick={(e) => { e.preventDefault(); void onRemove(v.id) }}
            disabled={busy}
            aria-label={`Remove ${v.name}`}
          >✕</button>
        </label>

        {editing && (
          <div className="dv-edit">
            <div className="dv-edit-row">
              <label className="dv-edit-field">
                <span className="dv-edit-label">{v.kind === 'note' ? 'Title' : 'Name'}</span>
                <input
                  className="dv-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={savingEdit}
                />
              </label>
              <label className="dv-edit-field">
                <span className="dv-edit-label">Category</span>
                <select
                  className="dv-input dv-edit-select"
                  value={editCat}
                  onChange={(e) => setEditCat(e.target.value as VaultCategory)}
                  disabled={savingEdit}
                >
                  {VAULT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="dv-edit-field">
              <span className="dv-edit-label">Tags</span>
              <input
                className="dv-input"
                placeholder="comma, separated, tags"
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                disabled={savingEdit}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveEdit(v) } }}
              />
            </label>
            {canEditContent(v) && (
              <label className="dv-edit-field dv-edit-field--full">
                <span className="dv-edit-label">
                  Content
                  <span className="dv-edit-count">{editContent.length.toLocaleString()} chars</span>
                </span>
                <textarea
                  className="dv-input dv-edit-textarea"
                  rows={10}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  disabled={savingEdit}
                  spellCheck={false}
                />
              </label>
            )}
            <div className="dv-edit-actions">
              <button type="button" className="btn btn-ghost btn-xs"
                onClick={() => setEditingId(null)} disabled={savingEdit}>Cancel</button>
              <button type="button" className="btn btn-primary btn-xs"
                onClick={() => void saveEdit(v)} disabled={savingEdit}>
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="dv">
      <style>{styles}</style>

      {/* tabs */}
      <div className="dv-tabs" role="tablist">
        {(Object.keys(TAB_META) as Tab[]).map((k) => (
          <button
            key={k}
            type="button"
            className={`dv-tab${tab === k ? ' is-on' : ''}`}
            onClick={() => { setTab(k); setError(null) }}
          >
            <span className="dv-tab-ic">{TAB_META[k].icon}</span>
            {TAB_META[k].label}
          </button>
        ))}
      </div>

      {/* add form */}
      {tab !== 'library' && (
        <div className="dv-add">
          {tab === 'file' ? (
            <div className="dv-file">
              <input ref={fileRef} type="file" accept={FILE_ACCEPT} multiple disabled={busy}
                onChange={(e) => { const fs = e.target.files; if (fs?.length) void onFiles(Array.from(fs)) }} />
              <p className="dv-hint">{busy ? 'Ingesting…' : 'Power BI, CSV, JSON, Markdown, HTML — pick one or more; text fed to AI'}</p>
              {progress.length > 0 && (() => {
                const total = progress.length
                const finished = progress.filter((r) => r.status === 'done' || r.status === 'error').length
                const failed = progress.filter((r) => r.status === 'error').length
                const allDone = finished === total
                const pct = Math.round((finished / total) * 100)
                return (
                <div className="dv-prog-wrap">
                  <div className="dv-prog-head">
                    <span>
                      {allDone
                        ? failed ? `Added ${total - failed} of ${total} · ${failed} failed` : `Added ${total} file${total > 1 ? 's' : ''}`
                        : `Ingesting ${finished} of ${total}…`}
                    </span>
                    <span className="dv-prog-pct">{pct}%</span>
                  </div>
                  <div className="dv-prog-bar">
                    <div className={`dv-prog-fill${allDone && !failed ? ' is-done' : ''}${failed ? ' has-err' : ''}`}
                      style={{ width: `${pct}%` }} />
                  </div>
                  <ul className="dv-prog">
                  {progress.map((r, i) => (
                    <li key={`${r.name}-${i}`} className={`dv-prog-row dv-prog-row--${r.status}`}>
                      <span className="dv-prog-ic" aria-hidden>
                        {r.status === 'done' ? '✓' : r.status === 'error' ? '✕' : r.status === 'busy' ? '◐' : '○'}
                      </span>
                      <span className="dv-prog-name" title={r.error || r.name}>{r.name}</span>
                      <span className="dv-prog-state">
                        {r.status === 'done' ? 'Added'
                          : r.status === 'error' ? (r.error || 'Failed')
                          : r.status === 'busy' ? 'Ingesting…'
                          : 'Queued'}
                      </span>
                    </li>
                  ))}
                  </ul>
                </div>
                )
              })()}
            </div>
          ) : tab === 'interview' ? (
            <form className="dv-form" onSubmit={(e) => { e.preventDefault(); void submitInterview() }}>
              <div className="dv-iv-grid">
                <input className="dv-input" placeholder="Interviewee name"
                  value={ivName} onChange={(e) => setIvName(e.target.value)} disabled={busy} />
                <input className="dv-input" placeholder="Role / title — optional"
                  value={ivRole} onChange={(e) => setIvRole(e.target.value)} disabled={busy} />
              </div>
              <div className="dv-iv-grid">
                <input className="dv-input" type="date"
                  value={ivDate} onChange={(e) => setIvDate(e.target.value)} disabled={busy} />
                <input className="dv-input" placeholder="Topics — comma separated"
                  value={ivTopics} onChange={(e) => setIvTopics(e.target.value)} disabled={busy} />
              </div>
              <div className="dv-iv-qa">
                {ivQA.map((p, i) => (
                  <div key={i} className="dv-iv-pair">
                    <div className="dv-iv-pair-head">
                      <span className="dv-iv-num">Q{i + 1}</span>
                      {ivQA.length > 1 && (
                        <button type="button" className="dv-iv-del" disabled={busy}
                          onClick={() => setIvQA((prev) => prev.filter((_, j) => j !== i))}
                          aria-label={`Remove question ${i + 1}`}>✕</button>
                      )}
                    </div>
                    <input className="dv-input" placeholder="Question"
                      value={p.q} onChange={(e) => updateQA(i, { q: e.target.value })} disabled={busy} />
                    <textarea className="dv-input dv-textarea" rows={3} placeholder="Answer / what they said…"
                      value={p.a} onChange={(e) => updateQA(i, { a: e.target.value })} disabled={busy} />
                  </div>
                ))}
              </div>
              <button type="button" className="dv-iv-add" disabled={busy}
                onClick={() => setIvQA((prev) => [...prev, { q: '', a: '' }])}>+ Add question</button>
              <button className="btn btn-primary btn-xs" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save interview'}
              </button>
            </form>
          ) : (
            <form className="dv-form" onSubmit={submitForm}>
              <input className="dv-input" placeholder={tab === 'note' ? 'Note title' : 'Name'}
                value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
              {(tab === 'mcp' || tab === 'api') && (<>
                <input className="dv-input"
                  placeholder={tab === 'mcp' ? 'MCP server URL' : 'Base URL / endpoint'}
                  value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} />
                <input className="dv-input" placeholder="What it provides (description)"
                  value={desc} onChange={(e) => setDesc(e.target.value)} disabled={busy} />
              </>)}
              {tab === 'api' && (
                <input className="dv-input" placeholder="Auth note — optional"
                  value={auth} onChange={(e) => setAuth(e.target.value)} disabled={busy} />
              )}
              {tab === 'note' && (
                <textarea className="dv-input dv-textarea" rows={4}
                  placeholder="Context the AI should use for this report…"
                  value={noteBody} onChange={(e) => setNoteBody(e.target.value)} disabled={busy} />
              )}
              <button className="btn btn-primary btn-xs" type="submit" disabled={busy}>
                {busy ? 'Adding…' : `Add ${TAB_META[tab].label}`}
              </button>
            </form>
          )}
        </div>
      )}

      {/* library picker */}
      {tab === 'library' && (
        <div className="dv-lib">
          <div className="dv-lib-hint">Select items from your workspace library to include in this report's AI context.</div>
          {libLoading ? (
            <div className="dv-empty">Loading library…</div>
          ) : libItems.length === 0 ? (
            <div className="dv-empty">No library items yet — add docs, notes, or MCP descriptors in the Library panel.</div>
          ) : (
            libItems.map((li) => {
              const already = addedLibIds.has(li.id)
              return (
                <div key={li.id} className={`dv-lib-row${already ? ' dv-lib-row--added' : ''}`}>
                  <span className="dv-lib-ic">
                    {li.kind === 'mcp' ? '🔌' : li.kind === 'html' ? '◳' : li.kind === 'note' ? '✎' : '📄'}
                  </span>
                  <div className="dv-item-body">
                    <div className="dv-item-name">{li.name}</div>
                    <div className="dv-item-sub">{li.kind}{li.scope === 'org' ? ' · org' : ' · private'}</div>
                  </div>
                  <button
                    type="button"
                    className={`btn btn-xs${already ? ' btn-ghost' : ' btn-primary'}`}
                    disabled={libAdding === li.id || already}
                    onClick={() => void addFromLibrary(li)}
                  >
                    {libAdding === li.id ? '…' : already ? '✓ Added' : '+ Add'}
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}

      {error && <div className="dv-error">{error}</div>}

      {/* vault item list with checkboxes */}
      <div className="dv-list">
        <div className="dv-list-head">
          AI context
          <span>{activeCount}/{vault.length} active</span>
        </div>
        {vault.length === 0 ? (
          <div className="dv-empty">
            Nothing added yet — use the tabs above to attach files, connectors, or notes, or pick from your Library.
          </div>
        ) : (<>
          {connectors.length > 0 && (<>
            <div className="dv-group-head">Connectors</div>
            {connectors.map(renderVaultItem)}
          </>)}
          {content.length > 0 && (<>
            <div className="dv-group-head">Content</div>
            {content.map(renderVaultItem)}
          </>)}
        </>)}
      </div>
    </div>
  )
}

const styles = `
.dv { display: flex; flex-direction: column; gap: 14px; }

.dv-tabs { display: flex; gap: 5px; flex-wrap: wrap; }
.dv-tab {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--line); background: var(--card2); color: var(--mut);
  font: inherit; font-size: 12px; font-weight: 600; padding: 6px 10px;
  border-radius: 9px; cursor: pointer; transition: .15s; white-space: nowrap;
}
.dv-tab.is-on { color: #04121b; background: var(--grad); border-color: transparent; }
[data-theme='light'] .dv-tab.is-on { color: #fff; }
.dv-tab-ic { font-size: 13px; }

.dv-add { border: 1px solid var(--line); border-radius: 12px; background: var(--card2); padding: 14px; }
.dv-form { display: flex; flex-direction: column; gap: 8px; }
.dv-input {
  width: 100%; height: 36px; padding: 0 12px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--card); color: var(--ink);
  font: inherit; font-size: 13.5px; outline: none;
}
.dv-input:focus { border-color: var(--cyan); box-shadow: 0 0 0 3px rgba(111,227,240,.14); }
.dv-textarea { height: auto; padding: 10px 12px; resize: vertical; line-height: 1.5; }
.dv-file input { font-size: 13px; color: var(--mut); }
.dv-hint { color: var(--mut2); font-size: 12px; margin-top: 8px; }

/* live ingestion progress */
.dv-prog-wrap { margin-top: 10px; }
.dv-prog-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; font-weight: 600; color: var(--ink); margin-bottom: 5px;
}
.dv-prog-pct { color: var(--mut2); font-variant-numeric: tabular-nums; }
.dv-prog-bar { height: 5px; border-radius: 999px; background: var(--card); overflow: hidden; border: 1px solid var(--line); }
.dv-prog-fill {
  height: 100%; background: var(--grad); border-radius: 999px;
  transition: width .35s ease;
}
.dv-prog-fill.is-done { background: var(--cyan); }
.dv-prog-fill.has-err { background: var(--bad); }
.dv-prog { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.dv-prog-row {
  display: flex; align-items: center; gap: 8px; font-size: 12.5px;
  padding: 5px 8px; border-radius: 7px; background: var(--card);
  border: 1px solid var(--line);
}
.dv-prog-ic { flex: none; width: 14px; text-align: center; font-size: 12px; color: var(--mut2); }
.dv-prog-row--busy .dv-prog-ic { color: var(--cyan); display: inline-block; animation: dv-spin 0.8s linear infinite; }
.dv-prog-row--done .dv-prog-ic { color: var(--cyan); }
.dv-prog-row--error .dv-prog-ic { color: var(--bad); }
.dv-prog-name { flex: 1; min-width: 0; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv-prog-state { flex: none; font-size: 11px; color: var(--mut2); }
.dv-prog-row--done .dv-prog-state { color: var(--cyan); }
.dv-prog-row--error .dv-prog-state { color: var(--bad); max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@keyframes dv-spin { to { transform: rotate(360deg); } }

/* interview capture */
.dv-iv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.dv-iv-qa { display: flex; flex-direction: column; gap: 8px; }
.dv-iv-pair {
  display: flex; flex-direction: column; gap: 6px; padding: 10px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--card);
}
.dv-iv-pair-head { display: flex; align-items: center; justify-content: space-between; }
.dv-iv-num { font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--cyan); }
.dv-iv-del { border: 0; background: transparent; color: var(--mut2); cursor: pointer; font-size: 12px; padding: 2px 5px; border-radius: 5px; }
.dv-iv-del:hover:not(:disabled) { color: var(--bad); background: rgba(255,255,255,.05); }
.dv-iv-add {
  align-self: flex-start; border: 1px dashed var(--line); background: transparent;
  color: var(--mut); font: inherit; font-size: 12px; font-weight: 600;
  padding: 6px 12px; border-radius: 8px; cursor: pointer;
}
.dv-iv-add:hover:not(:disabled) { border-color: var(--cyan); color: var(--cyan); }

.dv-lib { display: flex; flex-direction: column; gap: 6px; }
.dv-lib-hint { font-size: 12px; color: var(--mut2); padding: 2px 0 4px; }
.dv-lib-row {
  display: flex; align-items: center; gap: 10px; padding: 9px 12px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--card2);
}
.dv-lib-row--added { opacity: .55; }
.dv-lib-ic { font-size: 15px; flex: none; }

.dv-error {
  color: var(--bad); font-size: 12.5px; border: 1px solid var(--line);
  background: var(--card2); border-radius: 8px; padding: 8px 10px;
}

.dv-list-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; letter-spacing: .04em; color: var(--mut2);
  text-transform: uppercase; font-weight: 700; margin-bottom: 6px;
}
.dv-list-head span {
  font-size: 11px; font-weight: 700; color: var(--cyan);
  background: rgba(111,227,240,.1); padding: 2px 8px; border-radius: 999px;
}
.dv-group-head {
  font-size: 10.5px; letter-spacing: .06em; color: var(--mut2); text-transform: uppercase;
  font-weight: 700; margin: 8px 0 4px; padding-left: 2px;
}
.dv-empty { color: var(--mut); font-size: 13px; line-height: 1.5; }

/* item row — label wraps the whole row so the checkbox is always clickable */
.dv-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--card2);
  margin-bottom: 6px; cursor: pointer; transition: opacity .15s, border-color .15s;
  user-select: none;
}
.dv-item:hover { border-color: var(--cyan); }
.dv-item--off { opacity: .5; }
.dv-item--off:hover { opacity: .7; }

/* prominent checkbox */
.dv-checkbox {
  flex: none; width: 18px; height: 18px; border-radius: 5px;
  accent-color: var(--cyan); cursor: pointer;
}

.dv-item-ic { font-size: 15px; flex: none; }
.dv-item-body { min-width: 0; flex: 1; }
.dv-item-name { color: var(--ink); font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv-item-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 3px; }
.dv-item-sub { color: var(--mut2); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }

/* category badge — neutral base, accented for a few salient kinds */
.dv-cat {
  flex: none; font-size: 10px; font-weight: 700; letter-spacing: .03em;
  text-transform: uppercase; padding: 2px 7px; border-radius: 999px;
  background: var(--card); color: var(--mut2); border: 1px solid var(--line);
}
.dv-cat--powerbi { color: #e8a13a; border-color: rgba(232,161,58,.4); background: rgba(232,161,58,.1); }
.dv-cat--data    { color: var(--cyan); border-color: rgba(111,227,240,.35); background: rgba(111,227,240,.1); }
.dv-cat--schema  { color: #9b8cff; border-color: rgba(155,140,255,.4); background: rgba(155,140,255,.12); }
.dv-cat--query   { color: #6fe0a8; border-color: rgba(111,224,168,.4); background: rgba(111,224,168,.1); }
.dv-cat--knowledge { color: #f0a6c8; border-color: rgba(240,166,200,.4); background: rgba(240,166,200,.12); }

/* user tag chips */
.dv-tag {
  flex: none; font-size: 10.5px; font-weight: 600; padding: 2px 7px;
  border-radius: 999px; background: rgba(255,255,255,.05);
  color: var(--mut); border: 1px solid var(--line);
}
.dv-tag::before { content: '#'; opacity: .5; }

/* per-item edit (category + tags) */
.dv-item-wrap { margin-bottom: 6px; }
.dv-item-wrap > .dv-item { margin-bottom: 0; }
.dv-edit-btn {
  border: 0; background: transparent; color: var(--mut2); cursor: pointer;
  font-size: 13px; padding: 4px 6px; border-radius: 6px; flex: none;
}
.dv-edit-btn:hover:not(:disabled), .dv-edit-btn.is-on { color: var(--cyan); background: rgba(111,227,240,.1); }
.dv-edit {
  display: flex; flex-direction: column; gap: 10px;
  border: 1px solid var(--line); border-top: 0; background: var(--card);
  border-radius: 0 0 10px 10px; padding: 10px 12px; margin-top: -1px;
}
.dv-edit-row { display: flex; gap: 10px; flex-wrap: wrap; }
.dv-edit-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 130px; }
.dv-edit-field--full { flex-basis: 100%; }
.dv-edit-label {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--mut2);
}
.dv-edit-count { font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--mut2); }
.dv-edit-select { height: 36px; }
.dv-edit-textarea {
  height: auto; padding: 10px 12px; resize: vertical; line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px;
}
.dv-edit-actions { display: flex; gap: 6px; justify-content: flex-end; }

/* "In AI" / "Off" badge */
.dv-item-badge {
  flex: none; font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
  font-weight: 700; padding: 3px 7px; border-radius: 999px;
  background: var(--card); color: var(--mut2); border: 1px solid var(--line);
}
.dv-item-badge.active {
  color: var(--cyan); background: rgba(111,227,240,.12);
  border-color: rgba(111,227,240,.3);
}

.dv-remove {
  border: 0; background: transparent; color: var(--mut2); cursor: pointer;
  font-size: 13px; padding: 4px 6px; border-radius: 6px; flex: none;
}
.dv-remove:hover:not(:disabled) { color: var(--bad); background: rgba(255,255,255,.05); }
`

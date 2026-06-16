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

const FILE_ACCEPT =
  '.pbix,.pbit,.md,.txt,.csv,.tsv,.json,.html,.htm,.xml,.yaml,.yml,.log,.sql'
const MAX_FILE_CHARS = 60000

const isPbix = (name: string) => /\.(pbix|pbit)$/i.test(name)

type Tab = VaultKind | 'library'

const TAB_META: Record<Tab, { label: string; icon: string }> = {
  file:    { label: 'File',    icon: '⤓'  },
  mcp:     { label: 'MCP',     icon: '🔌' },
  api:     { label: 'API',     icon: '⚡' },
  note:    { label: 'Note',    icon: '✎'  },
  library: { label: 'Library', icon: '📚' },
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
  const fileRef = useRef<HTMLInputElement>(null)

  // form fields
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [desc, setDesc] = useState('')
  const [auth, setAuth] = useState('')
  const [noteBody, setNoteBody] = useState('')

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

  async function onFile(file: File) {
    if (isPbix(file.name)) {
      setBusy(true); setError(null)
      try {
        const t = await getToken()
        onChange(await importPbix(t, orgId, projectId, file))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not import the Power BI file.')
      } finally {
        setBusy(false)
        if (fileRef.current) fileRef.current.value = ''
      }
      return
    }
    let text = ''
    try { text = await file.text() } catch { text = '' }
    await add({ kind: 'file', name: file.name, content: text.slice(0, MAX_FILE_CHARS), meta: { filename: file.name, size: file.size } })
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
    const sub = typeof meta.url === 'string' ? meta.url
      : typeof meta.description === 'string' ? meta.description
      : v.content ? `${v.content.length.toLocaleString()} chars`
      : ''
    const enabled = isEnabled(v)
    return (
      <label key={v.id} className={`dv-item${enabled ? '' : ' dv-item--off'}`}>
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
          {sub && <div className="dv-item-sub">{sub}</div>}
        </div>
        <span className={`dv-item-badge${enabled ? ' active' : ''}`}>
          {enabled ? 'In AI' : 'Off'}
        </span>
        <button
          type="button"
          className="dv-remove"
          onClick={(e) => { e.preventDefault(); void onRemove(v.id) }}
          disabled={busy}
          aria-label={`Remove ${v.name}`}
        >✕</button>
      </label>
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
              <input ref={fileRef} type="file" accept={FILE_ACCEPT} disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f) }} />
              <p className="dv-hint">{busy ? 'Uploading…' : 'Power BI, CSV, JSON, Markdown, HTML — text fed to AI'}</p>
            </div>
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
.dv-item-sub { color: var(--mut2); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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

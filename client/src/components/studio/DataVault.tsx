// DataVault — the per-report "data vault": attach files, MCP servers, APIs, and
// notes to THIS report. Everything added here is compiled into the AI's context
// when vibecoding the report. Self-contained; calls api.addVaultItem/removeVaultItem
// and reports the updated project back via onChange.

import { useRef, useState } from 'react'
import {
  addVaultItem,
  importPbix,
  removeVaultItem,
  type StudioProject,
  type VaultItem,
  type VaultKind,
} from '../../lib/api'

const FILE_ACCEPT =
  '.pbix,.pbit,.md,.txt,.csv,.tsv,.json,.html,.htm,.xml,.yaml,.yml,.log,.sql'
const MAX_FILE_CHARS = 60000

const isPbix = (name: string) => /\.(pbix|pbit)$/i.test(name)

const KIND_META: Record<VaultKind, { label: string; icon: string; blurb: string }> = {
  file: { label: 'File', icon: '⤓', blurb: 'Power BI (.pbix/.pbit), CSV, JSON, Markdown, HTML…' },
  mcp: { label: 'MCP', icon: '🔌', blurb: 'A Model Context Protocol server' },
  api: { label: 'API', icon: '⚡', blurb: 'A REST/HTTP endpoint' },
  note: { label: 'Note', icon: '✎', blurb: 'Freeform context for the AI' },
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
  const [tab, setTab] = useState<VaultKind>('file')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // form fields
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [desc, setDesc] = useState('')
  const [auth, setAuth] = useState('')
  const [body, setBody] = useState('')

  function reset() {
    setName('')
    setUrl('')
    setDesc('')
    setAuth('')
    setBody('')
  }

  async function add(item: {
    kind: VaultKind
    name: string
    content?: string
    meta?: Record<string, unknown>
  }) {
    setBusy(true)
    setError(null)
    try {
      const t = await getToken()
      const updated = await addVaultItem(t, orgId, projectId, item)
      onChange(updated)
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add to the vault.')
    } finally {
      setBusy(false)
    }
  }

  async function onFile(file: File) {
    // Power BI files are binary — send them to the server-side parser, which
    // extracts connectors/visuals/measures and seeds a starter scaffold.
    if (isPbix(file.name)) {
      setBusy(true)
      setError(null)
      try {
        const t = await getToken()
        const updated = await importPbix(t, orgId, projectId, file)
        onChange(updated)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not import the Power BI file.')
      } finally {
        setBusy(false)
        if (fileRef.current) fileRef.current.value = ''
      }
      return
    }
    let text = ''
    try {
      text = await file.text()
    } catch {
      text = ''
    }
    await add({
      kind: 'file',
      name: file.name,
      content: text.slice(0, MAX_FILE_CHARS),
      meta: { filename: file.name, size: file.size },
    })
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onRemove(id: string) {
    setBusy(true)
    try {
      const t = await getToken()
      const updated = await removeVaultItem(t, orgId, projectId, id)
      onChange(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove item.')
    } finally {
      setBusy(false)
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
      void add({
        kind: 'api',
        name: name.trim(),
        meta: { url: url.trim(), description: desc.trim(), auth: auth.trim() },
      })
    } else if (tab === 'note') {
      if (!name.trim() || !body.trim()) return
      void add({ kind: 'note', name: name.trim(), content: body.trim() })
    }
  }

  return (
    <div className="dv">
      <style>{styles}</style>

      <div className="dv-tabs" role="tablist">
        {(Object.keys(KIND_META) as VaultKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className={`dv-tab ${tab === k ? 'is-on' : ''}`}
            onClick={() => {
              setTab(k)
              setError(null)
            }}
          >
            <span className="dv-tab-ic">{KIND_META[k].icon}</span>
            {KIND_META[k].label}
          </button>
        ))}
      </div>

      {/* add form */}
      <div className="dv-add">
        {tab === 'file' ? (
          <div className="dv-file">
            <input
              ref={fileRef}
              type="file"
              accept={FILE_ACCEPT}
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
              }}
            />
            <p className="dv-hint">
              {busy ? 'Uploading…' : `Attach ${KIND_META.file.blurb} — its text feeds the AI.`}
            </p>
          </div>
        ) : (
          <form className="dv-form" onSubmit={submitForm}>
            <input
              className="dv-input"
              placeholder={tab === 'note' ? 'Note title' : 'Name'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
            {(tab === 'mcp' || tab === 'api') && (
              <>
                <input
                  className="dv-input"
                  placeholder={tab === 'mcp' ? 'MCP server URL' : 'Base URL / endpoint'}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={busy}
                />
                <input
                  className="dv-input"
                  placeholder="What it provides (description)"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  disabled={busy}
                />
              </>
            )}
            {tab === 'api' && (
              <input
                className="dv-input"
                placeholder="Auth note (e.g. Bearer token in header) — optional"
                value={auth}
                onChange={(e) => setAuth(e.target.value)}
                disabled={busy}
              />
            )}
            {tab === 'note' && (
              <textarea
                className="dv-input dv-textarea"
                placeholder="Context the AI should use for this report…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={busy}
                rows={4}
              />
            )}
            <button className="btn btn-primary btn-xs" type="submit" disabled={busy}>
              {busy ? 'Adding…' : `Add ${KIND_META[tab].label}`}
            </button>
          </form>
        )}
      </div>

      {error && <div className="dv-error">{error}</div>}

      {/* current vault */}
      <div className="dv-list">
        <div className="dv-list-head">
          In this report's vault <span>({vault.length})</span>
        </div>
        {vault.length === 0 ? (
          <div className="dv-empty">
            Nothing yet. Add files, MCP servers, APIs, or notes — they become the
            AI's context for this report.
          </div>
        ) : (
          vault.map((v) => {
            const meta = (v.meta ?? {}) as Record<string, unknown>
            const sub =
              typeof meta.url === 'string'
                ? (meta.url as string)
                : typeof meta.description === 'string'
                  ? (meta.description as string)
                  : v.content
                    ? `${v.content.length.toLocaleString()} chars`
                    : ''
            return (
              <div className="dv-item" key={v.id}>
                <span className="dv-item-ic">{KIND_META[v.kind].icon}</span>
                <div className="dv-item-body">
                  <div className="dv-item-name">{v.name}</div>
                  {sub && <div className="dv-item-sub">{sub}</div>}
                </div>
                <span className="dv-item-kind">{v.kind}</span>
                <button
                  type="button"
                  className="dv-remove"
                  onClick={() => void onRemove(v.id)}
                  disabled={busy}
                  aria-label={`Remove ${v.name}`}
                >
                  ✕
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

const styles = `
.dv { display: flex; flex-direction: column; gap: 14px; }
.dv-tabs { display: flex; gap: 6px; }
.dv-tab {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: 1px solid var(--line); background: var(--card2); color: var(--mut);
  font: inherit; font-size: 13px; font-weight: 600; padding: 8px 6px;
  border-radius: 9px; cursor: pointer; transition: .15s;
}
.dv-tab.is-on { color: #04121b; background: var(--grad); border-color: transparent; }
[data-theme='light'] .dv-tab.is-on { color: #fff; }
.dv-tab-ic { font-size: 14px; }

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

.dv-error {
  color: var(--bad); font-size: 12.5px; border: 1px solid var(--line);
  background: var(--card2); border-radius: 8px; padding: 8px 10px;
}

.dv-list-head { font-size: 12px; letter-spacing: .04em; color: var(--mut2); text-transform: uppercase; font-weight: 700; margin-bottom: 8px; }
.dv-list-head span { color: var(--cyan); }
.dv-empty { color: var(--mut); font-size: 13px; line-height: 1.5; }
.dv-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--card2); margin-bottom: 8px;
}
.dv-item-ic { font-size: 15px; flex: none; }
.dv-item-body { min-width: 0; flex: 1; }
.dv-item-name { color: var(--ink); font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv-item-sub { color: var(--mut2); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv-item-kind {
  font-size: 10px; letter-spacing: .08em; text-transform: uppercase; font-weight: 700;
  color: var(--cyan); background: rgba(111,227,240,.1); padding: 3px 7px; border-radius: 999px; flex: none;
}
.dv-remove {
  border: 0; background: transparent; color: var(--mut2); cursor: pointer;
  font-size: 13px; padding: 4px 6px; border-radius: 6px; flex: none;
}
.dv-remove:hover:not(:disabled) { color: var(--bad); background: rgba(255,255,255,.05); }
`

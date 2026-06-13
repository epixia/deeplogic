// ContextLibrary — manage the per-user / per-org Context Library that compiles
// into the augmented CONTEXT.md the AI reads. Lists items (mine + org), supports
// adding doc/note (paste or upload .md/.txt/.html), html (upload .html), and mcp
// descriptors (name + url + description). Toggle enabled, toggle scope, delete.

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthContext'
import {
  createContext,
  deleteContext,
  listContext,
  updateContext,
  type ContextItem,
  type ContextKind,
  type ContextScope,
} from '../../lib/api'

interface Props {
  orgId: string
}

const KIND_LABEL: Record<ContextKind, string> = {
  doc: 'Doc',
  note: 'Note',
  html: 'HTML',
  mcp: 'MCP',
}

type AddKind = ContextKind | null

export default function ContextLibrary({ orgId }: Props) {
  const { getAccessToken } = useAuth()
  const [items, setItems] = useState<ContextItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // add form
  const [addKind, setAddKind] = useState<AddKind>(null)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<ContextScope>('user')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired — please sign in again.')
      setItems(await listContext(token, orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load context.')
    } finally {
      setLoading(false)
    }
  }, [getAccessToken, orgId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  function resetForm() {
    setAddKind(null)
    setName('')
    setContent('')
    setUrl('')
    setDescription('')
    setScope('user')
    setFormError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onUploadFile(file: File, asHtml: boolean) {
    try {
      const text = await file.text()
      setContent(text)
      if (!name) setName(file.name.replace(/\.(md|txt|html?)$/i, ''))
      if (asHtml && addKind !== 'html') setAddKind('html')
    } catch {
      setFormError('Could not read that file.')
    }
  }

  async function submitAdd(e: FormEvent) {
    e.preventDefault()
    if (!addKind) return
    setFormError(null)
    if (!name.trim()) {
      setFormError('A name is required.')
      return
    }
    setSaving(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired — please sign in again.')

      let body: Parameters<typeof createContext>[2]
      if (addKind === 'mcp') {
        if (!url.trim()) throw new Error('An MCP server URL is required.')
        body = {
          kind: 'mcp',
          name: name.trim(),
          content: description.trim(),
          meta: { url: url.trim(), description: description.trim() },
          scope,
        }
      } else {
        body = {
          kind: addKind,
          name: name.trim(),
          content,
          scope,
        }
      }
      const created = await createContext(token, orgId, body)
      setItems((prev) => [created, ...prev])
      resetForm()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not add item.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(item: ContextItem) {
    if (!item.isOwner) return
    setBusyId(item.id)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired.')
      const updated = await updateContext(token, orgId, item.id, {
        enabled: !item.enabled,
      })
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed.')
    } finally {
      setBusyId(null)
    }
  }

  async function toggleScope(item: ContextItem) {
    if (!item.isOwner) return
    setBusyId(item.id)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired.')
      const updated = await updateContext(token, orgId, item.id, {
        scope: item.scope === 'org' ? 'user' : 'org',
      })
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed.')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(item: ContextItem) {
    if (!item.isOwner) return
    setBusyId(item.id)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired.')
      await deleteContext(token, orgId, item.id)
      setItems((prev) => prev.filter((i) => i.id !== item.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="ctx-section">
      <div className="ctx-toolbar">
        <h2>Context Library</h2>
        <div className="studio-seg" style={{ flex: '0 0 auto' }}>
          <button
            type="button"
            className={`studio-seg-btn ${addKind === 'doc' ? 'active' : ''}`}
            onClick={() => setAddKind(addKind === 'doc' ? null : 'doc')}
          >
            + Doc
          </button>
          <button
            type="button"
            className={`studio-seg-btn ${addKind === 'note' ? 'active' : ''}`}
            onClick={() => setAddKind(addKind === 'note' ? null : 'note')}
          >
            + Note
          </button>
          <button
            type="button"
            className={`studio-seg-btn ${addKind === 'html' ? 'active' : ''}`}
            onClick={() => setAddKind(addKind === 'html' ? null : 'html')}
          >
            + HTML
          </button>
          <button
            type="button"
            className={`studio-seg-btn ${addKind === 'mcp' ? 'active' : ''}`}
            onClick={() => setAddKind(addKind === 'mcp' ? null : 'mcp')}
          >
            + MCP
          </button>
        </div>
      </div>

      {addKind && (
        <form
          className="studio-card"
          style={{ marginBottom: 18 }}
          onSubmit={submitAdd}
        >
          <label className="studio-field">
            <span>Name</span>
            <input
              className="studio-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                addKind === 'mcp' ? 'e.g. Acme Metrics MCP' : 'A short title'
              }
            />
          </label>

          {addKind === 'mcp' ? (
            <>
              <label className="studio-field">
                <span>Server URL</span>
                <input
                  className="studio-input"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://mcp.example.com"
                />
              </label>
              <label className="studio-field">
                <span>Description</span>
                <textarea
                  className="studio-textarea"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What tools/data this MCP server exposes (descriptor only — no live execution)."
                />
              </label>
            </>
          ) : (
            <>
              <label className="studio-field" style={{ marginBottom: 8 }}>
                <span>
                  {addKind === 'html'
                    ? 'Upload .html'
                    : 'Paste content or upload .md / .txt / .html'}
                </span>
                <input
                  ref={fileRef}
                  className="studio-file"
                  type="file"
                  accept={addKind === 'html' ? '.html,.htm' : '.md,.txt,.html,.htm'}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void onUploadFile(f, addKind === 'html')
                  }}
                />
              </label>
              {addKind !== 'html' && (
                <label className="studio-field">
                  <span>Content</span>
                  <textarea
                    className="studio-textarea"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Paste notes, documentation, or reference text…"
                  />
                </label>
              )}
              {addKind === 'html' && content && (
                <p className="studio-file">
                  Loaded {content.length.toLocaleString()} characters of HTML.
                </p>
              )}
            </>
          )}

          <label className="studio-field">
            <span>Scope</span>
            <div className="studio-seg">
              <button
                type="button"
                className={`studio-seg-btn ${scope === 'user' ? 'active' : ''}`}
                onClick={() => setScope('user')}
              >
                Just me
              </button>
              <button
                type="button"
                className={`studio-seg-btn ${scope === 'org' ? 'active' : ''}`}
                onClick={() => setScope('org')}
              >
                Whole org
              </button>
            </div>
          </label>

          {formError && <div className="studio-error">{formError}</div>}

          <div className="studio-modal-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={resetForm}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Adding…' : 'Add to library'}
            </button>
          </div>
        </form>
      )}

      {error && <div className="studio-error">{error}</div>}

      {loading ? (
        <div className="studio-empty">Loading context…</div>
      ) : items.length === 0 ? (
        <div className="studio-empty">
          No context yet. Add docs, notes, existing HTML reports, or MCP
          descriptors — enabled items compile into the CONTEXT.md the AI reads.
        </div>
      ) : (
        <div className="ctx-list">
          {items.map((item) => {
            const metaUrl =
              typeof item.meta?.url === 'string' ? item.meta.url : null
            return (
              <div
                key={item.id}
                className={`ctx-item ${item.enabled ? '' : 'disabled'}`}
              >
                <div className="ctx-item-main">
                  <div className="ctx-name">{item.name}</div>
                  <div className="ctx-item-meta">
                    <span className="studio-pill studio-pill-kind">
                      {KIND_LABEL[item.kind]}
                    </span>
                    <span
                      className={`studio-pill ${
                        item.scope === 'org'
                          ? 'studio-pill-org'
                          : 'studio-pill-private'
                      }`}
                    >
                      {item.scope === 'org' ? 'Org' : 'Private'}
                    </span>
                    {!item.isOwner && (
                      <span className="studio-pill">Shared</span>
                    )}
                    {metaUrl && <span title={metaUrl}>{metaUrl}</span>}
                  </div>
                </div>

                <div className="ctx-item-actions">
                  {item.isOwner ? (
                    <>
                      <button
                        type="button"
                        className={`ctx-switch ${item.enabled ? 'on' : ''}`}
                        title={item.enabled ? 'Enabled' : 'Disabled'}
                        aria-label="Toggle enabled"
                        disabled={busyId === item.id}
                        onClick={() => void toggleEnabled(item)}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        disabled={busyId === item.id}
                        onClick={() => void toggleScope(item)}
                      >
                        {item.scope === 'org' ? 'Make private' : 'Share to org'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-xs"
                        disabled={busyId === item.id}
                        onClick={() => void remove(item)}
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <span className="studio-pill">
                      {item.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

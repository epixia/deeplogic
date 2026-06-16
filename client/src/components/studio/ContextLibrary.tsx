// ContextLibrary — manage the per-user / per-org Context Library that compiles
// into the augmented CONTEXT.md the AI reads. Lists items (mine + org), supports
// adding doc/note (paste or upload .md/.txt/.html), html, and mcp descriptors.
// Drop zone auto-populates name + content from any dropped file.

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthContext'
import {
  createContext,
  deleteContext,
  listContext,
  summarizeDocument,
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
  image: 'Image',
}

const ACCEPT = '.md,.txt,.html,.htm,.csv,.json,.xml,.yaml,.yml,.pdf'

function kindFromFile(file: File): ContextKind {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'html' || ext === 'htm') return 'html'
  return 'doc'
}

function nameFromFile(file: File): string {
  return file.name.replace(/\.(md|txt|html?|csv|json|xml|ya?ml|pdf)$/i, '')
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

type AddKind = ContextKind | null

export default function ContextLibrary({ orgId }: Props) {
  const { getAccessToken } = useAuth()
  const [items, setItems]   = useState<ContextItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // add form
  const [addKind, setAddKind]         = useState<AddKind>(null)
  const [name, setName]               = useState('')
  const [description, setDescription] = useState('')
  const [url, setUrl]                 = useState('')
  const [mcpDescription, setMcpDescription] = useState('')
  const [scope, setScope]             = useState<ContextScope>('user')
  const [saving, setSaving]           = useState(false)
  const [formError, setFormError]     = useState<string | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [pdfDataUri, setPdfDataUri]   = useState<string | null>(null)

  // drop zone
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

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
    setDescription('')
    setUrl('')
    setMcpDescription('')
    setScope('user')
    setFormError(null)
    setSummarizing(false)
    setPdfDataUri(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function loadFile(file: File) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    setAddKind(kindFromFile(file))
    setName(nameFromFile(file))
    setDescription('')
    setFormError(null)

    if (isPdf) {
      // Binary stored in meta.pdf for preview; description stays as AI-readable text
      try {
        const dataUri = await readAsDataUrl(file)
        setPdfDataUri(dataUri)
      } catch {
        setFormError('Could not read the PDF file.')
      }
      return
    }

    try {
      const text = await file.text()
      // Ask AI to describe the document
      setSummarizing(true)
      try {
        const token = await getAccessToken()
        if (token) {
          const { description: desc } = await summarizeDocument(token, orgId, file.name, text)
          setDescription(desc)
        }
      } catch {
        // Non-fatal — user can type description manually
      } finally {
        setSummarizing(false)
      }
    } catch {
      setFormError('Could not read that file.')
    }
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }
  function onDragLeave(e: DragEvent) {
    if (dropRef.current && !dropRef.current.contains(e.relatedTarget as Node)) {
      setDragOver(false)
    }
  }
  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void loadFile(file)
  }
  function onFileInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void loadFile(file)
    e.target.value = ''
  }

  async function submitAdd(e: FormEvent) {
    e.preventDefault()
    if (!addKind) return
    setFormError(null)
    if (!name.trim()) { setFormError('A name is required.'); return }
    setSaving(true)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Session expired — please sign in again.')
      let body: Parameters<typeof createContext>[2]
      if (addKind === 'mcp') {
        if (!url.trim()) throw new Error('An MCP server URL is required.')
        body = { kind: 'mcp', name: name.trim(), content: mcpDescription.trim(), meta: { url: url.trim(), description: mcpDescription.trim() }, scope }
      } else {
        const meta: Record<string, unknown> = pdfDataUri ? { pdf: pdfDataUri } : {}
        body = { kind: addKind, name: name.trim(), content: description, meta: Object.keys(meta).length ? meta : undefined, scope }
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
      const updated = await updateContext(token, orgId, item.id, { enabled: !item.enabled })
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
      const updated = await updateContext(token, orgId, item.id, { scope: item.scope === 'org' ? 'user' : 'org' })
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
        <h2>Library</h2>
        <div className="studio-seg" style={{ flex: '0 0 auto' }}>
          <button type="button" className={`studio-seg-btn ${addKind === 'note' ? 'active' : ''}`}
            onClick={() => { resetForm(); setAddKind(addKind === 'note' ? null : 'note') }}>
            + Note
          </button>
          <button type="button" className={`studio-seg-btn ${addKind === 'mcp' ? 'active' : ''}`}
            onClick={() => { resetForm(); setAddKind(addKind === 'mcp' ? null : 'mcp') }}>
            + MCP
          </button>
        </div>
      </div>

      {/* Drop zone — always visible when no form is open */}
      {!addKind && (
        <div
          ref={dropRef}
          className={`ctx-dropzone${dragOver ? ' ctx-dropzone--over' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            style={{ display: 'none' }}
            onChange={onFileInput}
          />
          <span className="ctx-dropzone-icon">⤓</span>
          <span className="ctx-dropzone-label">
            Drop a file here, or <span className="ctx-dropzone-link">browse</span>
          </span>
          <span className="ctx-dropzone-hint">
            .md · .txt · .html · .csv · .json · .xml · .pdf — title and content auto-filled
          </span>
        </div>
      )}

      {/* Add form */}
      {addKind && (
        <form className="studio-card" style={{ marginBottom: 18 }} onSubmit={submitAdd}>
          {/* File drop zone inside form — only for doc/html, not note/mcp */}
          {addKind !== 'mcp' && addKind !== 'note' && (
            <div
              className={`ctx-dropzone ctx-dropzone--compact${dragOver ? ' ctx-dropzone--over' : ''}`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                style={{ display: 'none' }}
                onChange={onFileInput}
              />
              <span className="ctx-dropzone-icon">⤓</span>
              <span className="ctx-dropzone-label">
                {description ? 'Replace file — drop or ' : 'Drop a file or '}
                <span className="ctx-dropzone-link">browse</span>
              </span>
            </div>
          )}

          <label className="studio-field">
            <span>Title</span>
            <input
              className="studio-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={addKind === 'mcp' ? 'e.g. Acme Metrics MCP' : 'A short title'}
              autoFocus
            />
          </label>

          {addKind === 'mcp' ? (
            <>
              <label className="studio-field">
                <span>Server URL</span>
                <input className="studio-input" value={url} onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://mcp.example.com" />
              </label>
              <label className="studio-field">
                <span>Description</span>
                <textarea className="studio-textarea" value={mcpDescription} onChange={(e) => setMcpDescription(e.target.value)}
                  placeholder="What tools/data this MCP server exposes." />
              </label>
            </>
          ) : (
            <label className="studio-field">
              <span>
                Description
                {summarizing && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--cyan)' }}>AI is reading the document…</span>}
                {pdfDataUri && !summarizing && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--cyan)' }}>PDF ready — describe it for the AI</span>}
              </span>
              <textarea
                className="studio-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={summarizing ? 'Generating description…' : pdfDataUri ? 'Briefly describe what this PDF contains and how the AI should use it…' : 'A brief description of what this document contains and how it should inform the AI…'}
                rows={6}
                disabled={summarizing}
              />
            </label>
          )}

          <label className="studio-field">
            <span>Scope</span>
            <div className="studio-seg">
              <button type="button" className={`studio-seg-btn ${scope === 'user' ? 'active' : ''}`}
                onClick={() => setScope('user')}>Just me</button>
              <button type="button" className={`studio-seg-btn ${scope === 'org' ? 'active' : ''}`}
                onClick={() => setScope('org')}>Whole org</button>
            </div>
          </label>

          {formError && <div className="studio-error">{formError}</div>}

          <div className="studio-modal-actions">
            <button type="button" className="btn btn-ghost" onClick={resetForm}>Cancel</button>
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
          No context yet — drop a file above or add a note / MCP descriptor.
        </div>
      ) : (
        <div className="ctx-list">
          {items.map((item) => {
            const metaUrl = typeof item.meta?.url === 'string' ? item.meta.url : null
            return (
              <div key={item.id} className={`ctx-item ${item.enabled ? '' : 'disabled'}`}>
                <div className="ctx-item-main">
                  <div className="ctx-name">{item.name}</div>
                  <div className="ctx-item-meta">
                    <span className="studio-pill studio-pill-kind">{KIND_LABEL[item.kind]}</span>
                    <span className={`studio-pill ${item.scope === 'org' ? 'studio-pill-org' : 'studio-pill-private'}`}>
                      {item.scope === 'org' ? 'Org' : 'Private'}
                    </span>
                    {!item.isOwner && <span className="studio-pill">Shared</span>}
                    {metaUrl && <span title={metaUrl}>{metaUrl}</span>}
                  </div>
                </div>
                <div className="ctx-item-actions">
                  {item.isOwner ? (
                    <>
                      <button type="button" className={`ctx-switch ${item.enabled ? 'on' : ''}`}
                        title={item.enabled ? 'Enabled' : 'Disabled'} aria-label="Toggle enabled"
                        disabled={busyId === item.id} onClick={() => void toggleEnabled(item)} />
                      <button type="button" className="btn btn-ghost btn-xs"
                        disabled={busyId === item.id} onClick={() => void toggleScope(item)}>
                        {item.scope === 'org' ? 'Make private' : 'Share to org'}
                      </button>
                      <button type="button" className="btn btn-danger btn-xs"
                        disabled={busyId === item.id} onClick={() => void remove(item)}>
                        Delete
                      </button>
                    </>
                  ) : (
                    <span className="studio-pill">{item.enabled ? 'Enabled' : 'Disabled'}</span>
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

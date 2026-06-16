// Vault — workspace-wide view of every connector and document used to generate
// reports, aggregated across semantic models, the context library, and each
// report's data vault. Owner-attributed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  getOrgVault,
  deleteVaultEntry,
  testConnectorUrl,
  streamConnectorTest,
  updateVaultMcp,
  updateVaultProj,
  updateVaultModelConnector,
  getVaultDocContent,
  createContext,
  type VaultConnector,
  type VaultDocument,
} from '../lib/api'
import './vault.css'

type FieldDef = { key: string; label: string; type: 'text' | 'password' | 'url'; placeholder?: string }

const CONNECTOR_FIELDS: Record<string, FieldDef[]> = {
  salesforce: [
    { key: 'instanceUrl', label: 'Instance URL', type: 'url', placeholder: 'https://mycompany.salesforce.com' },
    { key: 'clientId',    label: 'Consumer Key (Client ID)', type: 'text' },
    { key: 'clientSecret',label: 'Consumer Secret', type: 'password' },
    { key: 'username',    label: 'Username', type: 'text' },
    { key: 'accessToken', label: 'Access Token', type: 'password' },
  ],
  hubspot: [
    { key: 'url',      label: 'API Base URL', type: 'url', placeholder: 'https://api.hubapi.com' },
    { key: 'apiKey',   label: 'Private App Token', type: 'password' },
    { key: 'portalId', label: 'Portal ID', type: 'text' },
  ],
  snowflake: [
    { key: 'account',   label: 'Account', type: 'text', placeholder: 'myorg-myaccount' },
    { key: 'username',  label: 'Username', type: 'text' },
    { key: 'password',  label: 'Password', type: 'password' },
    { key: 'database',  label: 'Database', type: 'text' },
    { key: 'warehouse', label: 'Warehouse', type: 'text' },
    { key: 'schema',    label: 'Schema', type: 'text', placeholder: 'PUBLIC' },
  ],
  powerbi: [
    { key: 'tenantId',     label: 'Tenant ID', type: 'text' },
    { key: 'clientId',     label: 'Client ID', type: 'text' },
    { key: 'clientSecret', label: 'Client Secret', type: 'password' },
    { key: 'workspaceId',  label: 'Workspace ID', type: 'text' },
  ],
  sqlserver: [
    { key: 'host',     label: 'Host / Server', type: 'text', placeholder: 'server.database.windows.net' },
    { key: 'port',     label: 'Port', type: 'text', placeholder: '1433' },
    { key: 'database', label: 'Database', type: 'text' },
    { key: 'username', label: 'Username', type: 'text' },
    { key: 'password', label: 'Password', type: 'password' },
  ],
  sheets: [
    { key: 'spreadsheetId', label: 'Spreadsheet ID', type: 'text' },
    { key: 'apiKey',        label: 'API Key', type: 'password' },
  ],
  sap: [
    { key: 'host',         label: 'Host', type: 'text' },
    { key: 'systemNumber', label: 'System Number', type: 'text', placeholder: '00' },
    { key: 'client',       label: 'Client', type: 'text', placeholder: '100' },
    { key: 'username',     label: 'Username', type: 'text' },
    { key: 'password',     label: 'Password', type: 'password' },
  ],
  excel: [
    { key: 'fileUrl', label: 'File URL', type: 'url' },
    { key: 'apiKey',  label: 'API Key', type: 'password' },
  ],
  rest: [
    { key: 'url',      label: 'Base URL', type: 'url', placeholder: 'https://api.example.com' },
    { key: 'apiKey',   label: 'API Key / Bearer Token', type: 'password' },
    { key: 'username', label: 'Basic Auth Username', type: 'text' },
    { key: 'password', label: 'Basic Auth Password', type: 'password' },
  ],
  api: [
    { key: 'url',      label: 'Base URL', type: 'url', placeholder: 'https://api.example.com' },
    { key: 'apiKey',   label: 'API Key / Bearer Token', type: 'password' },
    { key: 'username', label: 'Basic Auth Username', type: 'text' },
    { key: 'password', label: 'Basic Auth Password', type: 'password' },
  ],
  mcp: [
    { key: 'url',         label: 'Server URL', type: 'url', placeholder: 'https://...' },
    { key: 'description', label: 'Description', type: 'text', placeholder: 'What this server provides...' },
  ],
}

const DEFAULT_FIELDS: FieldDef[] = [
  { key: 'url',    label: 'URL', type: 'url', placeholder: 'https://...' },
  { key: 'apiKey', label: 'API Key / Token', type: 'password' },
]

const CONNECTOR_TYPES = [
  { id: 'rest',       label: 'REST API',      icon: '⚡' },
  { id: 'mcp',        label: 'MCP Server',    icon: '🔌' },
  { id: 'salesforce', label: 'Salesforce',    icon: '☁' },
  { id: 'hubspot',    label: 'HubSpot',       icon: '◎' },
  { id: 'snowflake',  label: 'Snowflake',     icon: '❄' },
  { id: 'sheets',     label: 'Google Sheets', icon: '▤' },
  { id: 'powerbi',    label: 'Power BI',      icon: '▦' },
  { id: 'sqlserver',  label: 'SQL Server',    icon: '🗄' },
  { id: 'excel',      label: 'Excel',         icon: '▦' },
  { id: 'sap',        label: 'SAP',           icon: '◆' },
]

const KIND_ICON: Record<string, string> = {
  powerbi: '▦',
  snowflake: '❄',
  salesforce: '☁',
  hubspot: '◎',
  sqlserver: '🗄',
  sheets: '▤',
  sap: '◆',
  excel: '▦',
  rest: '⚡',
  mcp: '🔌',
  api: '⚡',
  file: '⤓',
  doc: '📄',
  html: '◳',
  note: '✎',
}
const ico = (k: string) => KIND_ICON[k] ?? '•'

const SOURCE_LABEL: Record<string, string> = {
  model: 'Semantic model',
  report: 'Report',
  library: 'Context library',
}

function OwnerBadge({ email }: { email: string | null }) {
  const { user } = useAuth()
  const mine = email && user?.email === email
  const label = !email ? 'Workspace' : mine ? 'You' : email
  return (
    <span className="vault-owner" title={label}>
      <span className="vault-owner-av">{(label[0] || '?').toUpperCase()}</span>
      {label}
    </span>
  )
}

export default function Vault() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()

  const [connectors, setConnectors] = useState<VaultConnector[]>([])
  const [documents, setDocuments] = useState<VaultDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  // Test button state: maps connector id -> 'testing' | 'ok' | 'fail:...' | undefined
  const [testResults, setTestResults] = useState<Record<string, 'testing' | 'ok' | 'fail' | string>>({})
  // Live test log lines per connector id
  const [testLog, setTestLog] = useState<Record<string, string[]>>({})
  const testAbortRef = useRef<Record<string, AbortController>>({})

  // Document drop-upload state
  const [docDragOver, setDocDragOver] = useState(false)
  const [docDropping, setDocDropping] = useState(false)
  const docDropRef = useRef<HTMLDivElement>(null)
  const docFileRef = useRef<HTMLInputElement>(null)

  async function uploadDocFile(file: File) {
    setDocDropping(true)
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      const name = file.name.replace(/\.[^.]+$/, '')
      let content = ''
      const meta: Record<string, unknown> = {}
      if (isPdf) {
        const dataUri = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(r.result as string)
          r.onerror = reject
          r.readAsDataURL(file)
        })
        meta.pdf = dataUri
      } else {
        content = (await file.text()).slice(0, 60000)
      }
      await createContext(t, orgId, {
        kind: isPdf ? 'doc' : (file.name.match(/\.html?$/i) ? 'html' : 'doc'),
        name,
        content,
        meta: Object.keys(meta).length ? meta : undefined,
        scope: 'org',
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setDocDropping(false)
      if (docFileRef.current) docFileRef.current.value = ''
    }
  }

  // Document preview state
  const [preview, setPreview] = useState<{ name: string; kind: string; content: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewRef, setPreviewRef] = useState<string | null>(null)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)

  // Create a blob URL for PDF data URIs — browsers render these far more reliably than data: URIs
  useEffect(() => {
    if (!preview?.content.startsWith('data:application/pdf;base64,')) {
      setPdfBlobUrl(null)
      return
    }
    try {
      const [, b64] = preview.content.split(',')
      const binary = atob(b64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      setPdfBlobUrl(url)
      return () => { URL.revokeObjectURL(url) }
    } catch {
      setPdfBlobUrl(null)
    }
  }, [preview])

  async function openPreview(doc: VaultDocument) {
    setPreviewRef(doc.deleteRef)
    setPreviewLoading(true)
    setPreview(null)
    try {
      const t = await getAccessToken()
      if (!t) return
      const result = await getVaultDocContent(t, orgId, doc.deleteRef)
      setPreview(result)
    } catch {
      setPreview({ name: doc.name, kind: doc.kind, content: '' })
    } finally {
      setPreviewLoading(false)
    }
  }

  // Edit modal state
  const [editing, setEditing] = useState<VaultConnector | null>(null)
  const [editType, setEditType] = useState('rest')
  const [editName, setEditName] = useState('')
  const [editMeta, setEditMeta] = useState<Record<string, string>>({})
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Add connector modal state
  const [showAdd, setShowAdd] = useState(false)
  const [addType, setAddType] = useState('rest')
  const [addName, setAddName] = useState('')
  const [addMeta, setAddMeta] = useState<Record<string, string>>({})
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  function openAddConnector() {
    setAddType('rest')
    setAddName('')
    setAddMeta({})
    setAddError(null)
    setShowAdd(true)
  }

  async function handleAddSave(e: React.FormEvent) {
    e.preventDefault()
    if (!addName.trim() || addSaving) return
    setAddSaving(true)
    setAddError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const url = addMeta.url ?? addMeta.instanceUrl ?? ''
      const content = [
        url ? `Endpoint: ${url}` : '',
        addMeta.description ? `Description: ${addMeta.description}` : '',
        addMeta.apiKey ? `Auth: Bearer token configured` : '',
      ].filter(Boolean).join('\n')
      await createContext(t, orgId, {
        kind: 'mcp',
        name: addName.trim(),
        content,
        meta: { ...addMeta, connectorType: addType },
        scope: 'org',
      })
      setShowAdd(false)
      await load()
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setAddSaving(false)
    }
  }

  const load = useCallback(async () => {
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired — please sign in again.')
      const data = await getOrgVault(t, orgId)
      setConnectors(data.connectors)
      setDocuments(data.documents)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the vault.')
    } finally {
      setLoading(false)
    }
  }, [getAccessToken, orgId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  async function handleDelete(deleteRef: string, label: string) {
    const isModel = deleteRef.startsWith('model:')
    const msg = isModel
      ? `Delete "${label}" and all its connectors? This cannot be undone.`
      : `Remove "${label}"? This cannot be undone.`
    if (!confirm(msg)) return
    setDeleting(deleteRef)
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      await deleteVaultEntry(t, orgId, deleteRef)
      // Remove locally — if model, remove all connectors that share the same deleteRef
      setConnectors((prev) => prev.filter((c) => c.deleteRef !== deleteRef))
      setDocuments((prev) => prev.filter((d) => d.deleteRef !== deleteRef))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  async function handleTest(c: VaultConnector) {
    if (!c.url) return
    // Cancel any in-progress test for this connector
    testAbortRef.current[c.id]?.abort()
    const ctrl = new AbortController()
    testAbortRef.current[c.id] = ctrl

    setTestResults((prev) => ({ ...prev, [c.id]: 'testing' }))
    setTestLog((prev) => ({ ...prev, [c.id]: [] }))

    const appendLog = (line: string) =>
      setTestLog((prev) => ({ ...prev, [c.id]: [...(prev[c.id] ?? []), line] }))

    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      let finalOk = false
      for await (const evt of streamConnectorTest(t, orgId, c.url, ctrl.signal)) {
        appendLog(evt.msg)
        if (evt.done) {
          finalOk = evt.ok === true
          setTestResults((prev) => ({ ...prev, [c.id]: finalOk ? 'ok' : 'fail:see log' }))
        }
      }
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return
      const msg = e instanceof Error ? e.message : 'error'
      appendLog(msg)
      setTestResults((prev) => ({ ...prev, [c.id]: `fail:${msg}` }))
    }
  }

  function openEdit(c: VaultConnector) {
    setEditing(c)
    // Prefer stored connectorType, fall back to the kind from vault aggregation
    const storedType = (c.meta as Record<string, string> | undefined)?.connectorType ?? c.kind
    const knownType = CONNECTOR_TYPES.find((t) => t.id === storedType) ? storedType : 'rest'
    setEditType(knownType)
    setEditName(c.name)
    setEditMeta({ ...(c.meta ?? {}) } as Record<string, string>)
    setEditError(null)
  }

  async function handleEditSave() {
    if (!editing) return
    setEditSaving(true)
    setEditError(null)
    // Always store connectorType so future opens restore the correct type
    const metaToSave = { ...editMeta, connectorType: editType }
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      if (editing.deleteRef.startsWith('ctx:')) {
        await updateVaultMcp(t, orgId, editing.deleteRef.slice(4), { name: editName, meta: metaToSave })
      } else if (editing.deleteRef.startsWith('proj:')) {
        const [, projectId, itemId] = editing.deleteRef.split(':')
        await updateVaultProj(t, orgId, projectId, itemId, { name: editName, meta: metaToSave })
      } else if (editing.deleteRef.startsWith('model:')) {
        await updateVaultModelConnector(t, orgId, {
          modelId: editing.deleteRef.slice(6),
          connectorKind: editType,
          meta: metaToSave,
        })
      }
      const urlFromMeta = (metaToSave as Record<string, string>).url ?? (metaToSave as Record<string, string>).instanceUrl ?? null
      setConnectors((prev) => prev.map((c) =>
        c.id === editing.id
          ? { ...c, name: editName, kind: editType, meta: metaToSave, url: urlFromMeta ?? c.url }
          : c
      ))
      setEditing(null)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleTestAll() {
    const testable = connectors.filter((c) => c.url)
    if (!testable.length) return
    const t = await getAccessToken()
    if (!t) return
    setTestResults((prev) => {
      const next = { ...prev }
      for (const c of testable) next[c.id] = 'testing'
      return next
    })
    await Promise.allSettled(
      testable.map(async (c) => {
        try {
          const res = await testConnectorUrl(t, orgId, c.url!)
          setTestResults((prev) => ({ ...prev, [c.id]: res.ok ? 'ok' : `fail:${res.status ?? res.error}` }))
        } catch (e) {
          setTestResults((prev) => ({ ...prev, [c.id]: 'fail:' + (e instanceof Error ? e.message : 'error') }))
        }
      })
    )
  }

  const filteredConnectors = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return connectors
    return connectors.filter(
      (c) =>
        c.name.toLowerCase().includes(s) ||
        c.kind.toLowerCase().includes(s) ||
        c.sourceName.toLowerCase().includes(s) ||
        (c.ownerEmail ?? '').toLowerCase().includes(s),
    )
  }, [connectors, q])

  const filteredDocuments = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return documents
    return documents.filter(
      (d) =>
        d.name.toLowerCase().includes(s) ||
        d.kind.toLowerCase().includes(s) ||
        d.sourceName.toLowerCase().includes(s) ||
        (d.ownerEmail ?? '').toLowerCase().includes(s),
    )
  }, [documents, q])

  return (
    <main className="wrap vault-page">
      <header className="vault-head">
        <div>
          <h1>
            Connectors &amp; <span className="grad-text">data sources</span>.
          </h1>
          <p className="vault-lead">
            Everything your workspace uses to generate reports — data connectors,
            documents, MCP servers, and APIs — with who added each one.
          </p>
        </div>
        <input
          className="vault-search"
          placeholder="Search connectors, docs, owners…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </header>

      {error && <div className="vault-error">{error}</div>}

      {/* Connectors */}
      <section className="vault-section">
        <div className="vault-section-head">
          <h2>Connectors</h2>
          <span className="vault-count">{filteredConnectors.length}</span>
          {connectors.some((c) => c.url) && (
            <button
              className="btn btn-ghost btn-xs vault-test-all-btn"
              onClick={() => void handleTestAll()}
            >
              Test all
            </button>
          )}
          <button
            className="btn btn-primary btn-xs"
            onClick={openAddConnector}
          >
            + Add connector
          </button>
        </div>
        {loading ? (
          <div className="vault-empty">Loading…</div>
        ) : filteredConnectors.length === 0 ? (
          <div className="vault-empty">
            No connectors yet — click <strong>+ Add connector</strong> to add an API, MCP server, or integration.
          </div>
        ) : (
          <div className="vault-grid">
            {filteredConnectors.map((c) => (
              <div className="vault-card" key={c.id}>
                <div className="vault-card-top">
                  <span className="vault-ic">{ico(c.kind)}</span>
                  <div className="vault-card-name">{c.name}</div>
                  <span className="vault-kind">{c.kind}</span>
                  <button
                    className="vault-del-btn"
                    title="Remove"
                    disabled={deleting === c.deleteRef}
                    onClick={() => void handleDelete(c.deleteRef, c.name)}
                  >
                    {deleting === c.deleteRef ? '…' : '✕'}
                  </button>
                </div>
                {c.url && (
                  <div className="vault-card-url">{c.url}</div>
                )}
                <div className="vault-card-meta">
                  <OwnerBadge email={c.ownerEmail} />
                </div>
                <div className="vault-card-actions">
                  {c.url && (
                    <button
                      className={`btn btn-xs vault-test-btn${
                        testResults[c.id] === 'ok' ? ' vault-test-ok' :
                        typeof testResults[c.id] === 'string' && testResults[c.id] !== 'testing' && testResults[c.id] !== 'ok' ? ' vault-test-fail' : ''
                      }`}
                      disabled={testResults[c.id] === 'testing'}
                      onClick={() => void handleTest(c)}
                    >
                      {testResults[c.id] === 'testing' ? 'Testing…' :
                       testResults[c.id] === 'ok' ? '✓ Connected' :
                       typeof testResults[c.id] === 'string' && testResults[c.id].startsWith('fail:') ? '✕ Failed' :
                       'Test'}
                    </button>
                  )}
                  <button
                    className="vault-edit-icon-btn"
                    title="Edit connector"
                    onClick={() => openEdit(c)}
                  >
                    ✎
                  </button>
                </div>
                {(testLog[c.id]?.length ?? 0) > 0 && (
                  <div className="vault-test-log">
                    {testLog[c.id].map((line, i) => (
                      <div
                        key={i}
                        className={`vault-test-log-line${
                          line.startsWith('✓') || line === 'Connected' ? ' vault-test-log-ok' :
                          line.startsWith('✕') || line === 'Connection failed' ? ' vault-test-log-fail' : ''
                        }`}
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Documents */}
      <section className="vault-section">
        <div className="vault-section-head">
          <h2>Documents &amp; sources</h2>
          <span className="vault-count">{filteredDocuments.length}</span>
          <label className="btn btn-ghost btn-xs vault-doc-upload-btn" title="Upload a document to the workspace library">
            <input
              ref={docFileRef}
              type="file"
              accept=".md,.txt,.html,.htm,.csv,.json,.xml,.yaml,.yml,.pdf"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadDocFile(f) }}
              disabled={docDropping}
            />
            {docDropping ? 'Uploading…' : '+ Upload'}
          </label>
        </div>
        {loading ? (
          <div className="vault-empty">Loading…</div>
        ) : (
          <div
            ref={docDropRef}
            className={`vault-doc-dropzone${docDragOver ? ' vault-doc-dropzone--over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDocDragOver(true) }}
            onDragLeave={(e) => {
              if (docDropRef.current && !docDropRef.current.contains(e.relatedTarget as Node)) {
                setDocDragOver(false)
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              setDocDragOver(false)
              const f = e.dataTransfer.files?.[0]
              if (f) void uploadDocFile(f)
            }}
          >
          {filteredDocuments.length === 0 && !docDropping ? (
            <div className="vault-doc-drop-hint">
              <span className="vault-doc-drop-icon">⤓</span>
              <span>Drop a file here, or use <strong>+ Upload</strong> above</span>
              <span className="vault-doc-drop-sub">.md · .txt · .html · .csv · .json · .pdf — added to workspace library</span>
            </div>
          ) : docDropping ? (
            <div className="vault-empty">Uploading…</div>
          ) : null}
          {filteredDocuments.length > 0 && (
          <div className="vault-list">
            {filteredDocuments.map((d) => (
              <div className="vault-row" key={d.id}>
                <span className="vault-ic">{ico(d.kind)}</span>
                <div className="vault-row-main">
                  <button
                    type="button"
                    className="vault-row-name vault-row-name--link"
                    onClick={() => void openPreview(d)}
                    disabled={previewLoading && previewRef === d.deleteRef}
                  >
                    {previewLoading && previewRef === d.deleteRef ? '…' : d.name}
                  </button>
                  <div className="vault-row-sub">
                    {SOURCE_LABEL[d.sourceType]} · {d.sourceName}
                    {d.scope ? ` · ${d.scope}` : ''}
                  </div>
                </div>
                <span className="vault-kind">{d.kind}</span>
                <OwnerBadge email={d.ownerEmail} />
                <button
                  className="vault-del-btn"
                  title="Remove"
                  disabled={deleting === d.deleteRef}
                  onClick={() => void handleDelete(d.deleteRef, d.name)}
                >
                  {deleting === d.deleteRef ? '…' : '✕'}
                </button>
              </div>
            ))}
          </div>
          )}
          </div>
        )}
      </section>

      {/* Document preview modal */}
      {(preview || (previewLoading && previewRef)) && (
        <div className="vault-modal-backdrop" onClick={() => { setPreview(null); setPreviewRef(null); setPdfBlobUrl(null) }}>
          <div className="vault-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vault-modal-head">
              <h2>{preview?.name ?? '…'}</h2>
              <button className="vault-modal-close" onClick={() => { setPreview(null); setPreviewRef(null); setPdfBlobUrl(null) }}>✕</button>
            </div>
            <div className="vault-preview-body">
              {previewLoading && <div className="vault-preview-loading">Loading preview…</div>}
              {preview && !preview.content && <div className="vault-preview-empty">No preview available for this file.</div>}
              {preview?.content && (() => {
                const { content, kind } = preview
                if (kind === 'image' || content.startsWith('data:image/')) {
                  return <img src={content} alt={preview.name} className="vault-preview-img" />
                }
                if (kind === 'html' || content.startsWith('<!')) {
                  return <iframe srcDoc={content} sandbox="allow-scripts allow-popups" className="vault-preview-frame" title={preview.name} />
                }
                if (content.startsWith('data:application/pdf;base64,')) {
                  return pdfBlobUrl
                    ? <iframe src={pdfBlobUrl} className="vault-preview-frame" title={preview.name} />
                    : <div className="vault-preview-loading">Preparing PDF…</div>
                }
                if (preview.name.toLowerCase().endsWith('.pdf')) {
                  // Name is PDF but content is a text description — show the text
                  return <pre className="vault-preview-text">{content}</pre>
                }
                return <pre className="vault-preview-text">{content}</pre>
              })()}
            </div>
          </div>
        </div>
      )}

      {showAdd && (() => {
        const fields = CONNECTOR_FIELDS[addType] ?? DEFAULT_FIELDS
        return (
          <div className="vault-modal-backdrop" onClick={() => !addSaving && setShowAdd(false)}>
            <form className="vault-modal vault-add-modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => void handleAddSave(e)}>
              <div className="vault-modal-head">
                <h2>Add connector</h2>
                <button type="button" className="vault-modal-close" onClick={() => setShowAdd(false)}>✕</button>
              </div>

              <label className="vault-modal-field">
                <span>Type</span>
                <div className="vault-type-grid">
                  {CONNECTOR_TYPES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`vault-type-btn${addType === t.id ? ' selected' : ''}`}
                      onClick={() => { setAddType(t.id); setAddMeta({}) }}
                    >
                      <span className="vault-type-icon">{t.icon}</span>
                      {t.label}
                    </button>
                  ))}
                </div>
              </label>

              <label className="vault-modal-field">
                <span>Name</span>
                <input
                  className="vault-modal-input"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder={`My ${CONNECTOR_TYPES.find((t) => t.id === addType)?.label ?? 'connector'}`}
                  autoFocus
                  required
                />
              </label>

              {fields.map((f) => (
                <label className="vault-modal-field" key={f.key}>
                  <span>{f.label}</span>
                  <input
                    className="vault-modal-input"
                    type={f.type === 'password' ? 'password' : f.type === 'url' ? 'url' : 'text'}
                    value={addMeta[f.key] ?? ''}
                    onChange={(e) => setAddMeta((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder ?? ''}
                    autoComplete={f.type === 'password' ? 'off' : undefined}
                  />
                </label>
              ))}

              {addError && <div className="vault-modal-error">{addError}</div>}

              <div className="vault-modal-actions">
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setShowAdd(false)} disabled={addSaving}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-xs" disabled={addSaving || !addName.trim()}>
                  {addSaving ? 'Saving…' : 'Add connector'}
                </button>
              </div>
            </form>
          </div>
        )
      })()}

      {editing && (() => {
        const fields = CONNECTOR_FIELDS[editType] ?? DEFAULT_FIELDS
        return (
        <div className="vault-modal-backdrop" onClick={() => !editSaving && setEditing(null)}>
          <div className="vault-modal vault-add-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vault-modal-head">
              <h2>Edit connector</h2>
              <button className="vault-modal-close" onClick={() => setEditing(null)}>✕</button>
            </div>

            <label className="vault-modal-field">
              <span>Type</span>
              <div className="vault-type-grid">
                {CONNECTOR_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`vault-type-btn${editType === t.id ? ' selected' : ''}`}
                    onClick={() => { setEditType(t.id); setEditMeta((prev) => ({ connectorType: t.id, url: prev.url ?? '' })) }}
                  >
                    <span className="vault-type-icon">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            </label>

            <label className="vault-modal-field">
              <span>Name</span>
              <input className="vault-modal-input" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </label>

            {fields.map((f) => (
              <label className="vault-modal-field" key={f.key}>
                <span>{f.label}</span>
                <input
                  className="vault-modal-input"
                  type={f.type === 'password' ? 'password' : f.type === 'url' ? 'url' : 'text'}
                  value={editMeta[f.key] ?? ''}
                  onChange={(e) => setEditMeta((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder ?? ''}
                  autoComplete={f.type === 'password' ? 'off' : undefined}
                />
              </label>
            ))}

            {editError && <div className="vault-modal-error">{editError}</div>}
            <div className="vault-modal-actions">
              <button className="btn btn-ghost btn-xs" onClick={() => setEditing(null)} disabled={editSaving}>Cancel</button>
              <button className="btn btn-primary btn-xs" onClick={() => void handleEditSave()} disabled={editSaving || !editName.trim()}>
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
        )
      })()}
    </main>
  )
}

// Vault — workspace-wide view of every connector and document used to generate
// reports, aggregated across semantic models, the context library, and each
// report's data vault. Owner-attributed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStickyTab } from '../lib/useStickyTab'

type VTab = 'connectors' | 'mcp' | 'databases' | 'websites' | 'data' | 'documents' | 'markdown' | 'powerbi' | 'employees' | 'kpis'
// 'kpis' intentionally omitted — tab hidden for now (falls back if it was sticky)
const VTABS: readonly VTab[] = ['connectors', 'mcp', 'databases', 'websites', 'data', 'documents', 'markdown', 'employees', 'powerbi']

// Connector kinds that represent a connected database / warehouse — these get
// their own "Databases" tab; everything else stays under "Connectors".
const DB_KINDS = new Set(['snowflake', 'sqlserver', 'sap', 'postgres', 'postgresql', 'mysql', 'mariadb', 'supabase', 'redshift', 'bigquery', 'oracle', 'databricks', 'mongodb', 'mssql', 'db2'])
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  getOrgVault,
  ingestToVault,
  deleteVaultEntry,
  testConnectorUrl,
  streamConnectorTest,
  updateVaultMcp,
  updateVaultProj,
  updateVaultModelConnector,
  getVaultDocContent,
  createContext,
  listVaultPowerBI,
  listVaultKpis,
  deleteVaultKpi,
  describePowerBi,
  type VaultConnector,
  type VaultDocument,
  type VaultPowerBI,
  type VaultKpi,
} from '../lib/api'
import AnalyzeUrlModal from '../components/vault/AnalyzeUrlModal'
import PowerBiScanModal from '../components/vault/PowerBiScanModal'
import DbAnalyzeModal from '../components/vault/DbAnalyzeModal'
import Employees from '../components/vault/Employees'
import { COMPANY_PROFILE_NAME } from '../components/vault/CompanyProfile'
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
  postgres: [
    { key: 'host',     label: 'Host', type: 'text', placeholder: 'db.example.com' },
    { key: 'port',     label: 'Port', type: 'text', placeholder: '5432' },
    { key: 'database', label: 'Database', type: 'text' },
    { key: 'username', label: 'Username', type: 'text' },
    { key: 'password', label: 'Password', type: 'password' },
    { key: 'ssl',      label: 'SSL mode (optional)', type: 'text', placeholder: 'require' },
  ],
  mysql: [
    { key: 'host',     label: 'Host', type: 'text', placeholder: 'db.example.com' },
    { key: 'port',     label: 'Port', type: 'text', placeholder: '3306' },
    { key: 'database', label: 'Database', type: 'text' },
    { key: 'username', label: 'Username', type: 'text' },
    { key: 'password', label: 'Password', type: 'password' },
  ],
  mariadb: [
    { key: 'host',     label: 'Host', type: 'text', placeholder: 'db.example.com' },
    { key: 'port',     label: 'Port', type: 'text', placeholder: '3306' },
    { key: 'database', label: 'Database', type: 'text' },
    { key: 'username', label: 'Username', type: 'text' },
    { key: 'password', label: 'Password', type: 'password' },
  ],
  supabase: [
    { key: 'url',            label: 'Project URL (SUPABASE_URL)', type: 'url', placeholder: 'https://xxxx.supabase.co' },
    { key: 'publishableKey', label: 'Publishable key (SUPABASE_PUBLISHABLE_KEY)', type: 'password', placeholder: 'sb_publishable_…' },
    { key: 'secretKey',      label: 'Secret key (SUPABASE_SECRET_KEY)', type: 'password', placeholder: 'sb_secret_…' },
    { key: 'jwksUrl',        label: 'JWKS URL (SUPABASE_JWKS_URL)', type: 'url', placeholder: 'https://xxxx.supabase.co/auth/v1/.well-known/jwks.json' },
  ],
  bigquery: [
    { key: 'projectId',      label: 'Project ID', type: 'text' },
    { key: 'dataset',        label: 'Dataset', type: 'text' },
    { key: 'serviceAccount', label: 'Service account JSON', type: 'password', placeholder: 'paste the JSON key' },
  ],
  redshift: [
    { key: 'host',     label: 'Host / Endpoint', type: 'text', placeholder: 'cluster.xxxx.redshift.amazonaws.com' },
    { key: 'port',     label: 'Port', type: 'text', placeholder: '5439' },
    { key: 'database', label: 'Database', type: 'text' },
    { key: 'username', label: 'Username', type: 'text' },
    { key: 'password', label: 'Password', type: 'password' },
  ],
  oracle: [
    { key: 'host',        label: 'Host', type: 'text' },
    { key: 'port',        label: 'Port', type: 'text', placeholder: '1521' },
    { key: 'serviceName', label: 'Service name / SID', type: 'text' },
    { key: 'username',    label: 'Username', type: 'text' },
    { key: 'password',    label: 'Password', type: 'password' },
  ],
  mongodb: [
    { key: 'url',      label: 'Connection string', type: 'password', placeholder: 'mongodb+srv://user:pass@cluster/db' },
    { key: 'database', label: 'Database', type: 'text' },
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
  { id: 'sheets',     label: 'Google Sheets', icon: '▤' },
  { id: 'powerbi',    label: 'Power BI',      icon: '▦' },
  { id: 'excel',      label: 'Excel',         icon: '▦' },
  { id: 'sap',        label: 'SAP',           icon: '◆' },
  // Databases (shown in the Databases tab's "+ Add database" picker)
  { id: 'postgres',   label: 'PostgreSQL',    icon: '🐘' },
  { id: 'mysql',      label: 'MySQL',         icon: '🐬' },
  { id: 'mariadb',    label: 'MariaDB',       icon: '🦭' },
  { id: 'sqlserver',  label: 'SQL Server',    icon: '🗄' },
  { id: 'supabase',   label: 'Supabase',      icon: '⚡' },
  { id: 'snowflake',  label: 'Snowflake',     icon: '❄' },
  { id: 'bigquery',   label: 'BigQuery',      icon: '🔷' },
  { id: 'redshift',   label: 'Redshift',      icon: '🟥' },
  { id: 'oracle',     label: 'Oracle',        icon: '🅾' },
  { id: 'mongodb',    label: 'MongoDB',       icon: '🍃' },
]
// Which connector types are databases (for the per-tab "+ Add" picker).
const DB_TYPE_IDS = new Set(['postgres', 'mysql', 'mariadb', 'sqlserver', 'supabase', 'snowflake', 'bigquery', 'redshift', 'oracle', 'mongodb'])

const KIND_ICON: Record<string, string> = {
  powerbi: '▦',
  snowflake: '❄',
  salesforce: '☁',
  hubspot: '◎',
  sqlserver: '🗄',
  sheets: '▤',
  sap: '◆',
  excel: '▦',
  postgres: '🐘',
  postgresql: '🐘',
  mysql: '🐬',
  mariadb: '🦭',
  supabase: '⚡',
  bigquery: '🔷',
  redshift: '🟥',
  oracle: '🅾',
  mongodb: '🍃',
  mssql: '🗄',
  databricks: '🧱',
  rest: '⚡',
  mcp: '🔌',
  api: '⚡',
  file: '⤓',
  doc: '📄',
  html: '◳',
  note: '✎',
  website: '🌐',
  data: '📊',
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

// AI "what this report portrays" summary for a Power BI card. Fetched once per
// report and cached for the session so the Power BI tab doesn't re-spend tokens.
const pbiDescCache = new Map<string, string>()
function PowerBiDescription({ orgId, report }: { orgId: string; report: VaultPowerBI }) {
  const { getAccessToken } = useAuth()
  const [desc, setDesc] = useState<string | null>(() => pbiDescCache.get(report.id) ?? null)
  useEffect(() => {
    if (pbiDescCache.has(report.id)) { setDesc(pbiDescCache.get(report.id)!); return }
    let cancelled = false
    void (async () => {
      try {
        const t = await getAccessToken()
        if (!t) return
        const insp = report.inspection
        const r = await describePowerBi(t, orgId, {
          name: report.name,
          tables: (report.tables ?? []).map((tb) => ({ name: tb.name, columns: tb.columns ?? [] })),
          sources: [...new Set((insp?.sourceSystems ?? []).map((s) => s.database || s.server || s.name).filter(Boolean) as string[])],
          sourceTypes: [...new Set((insp?.connectors ?? []).map((c) => c.type).filter(Boolean))],
          kpis: insp?.kpis?.length ? insp.kpis.map((k) => k.name) : (report.kpis ?? []),
          entities: (insp?.entities ?? []).map((e) => e.name),
          pages: report.pages ?? [],
        })
        if (!cancelled) { pbiDescCache.set(report.id, r.description); setDesc(r.description) }
      } catch { /* description is best-effort */ }
    })()
    return () => { cancelled = true }
  }, [orgId, report, getAccessToken])

  return (
    <div className="vault-pbi-sec">
      <h4>📝 What this report portrays</h4>
      {desc ? <p className="vault-pbi-desc">{desc}</p> : <p className="vault-pbi-desc vault-pbi-desc--load">Generating description…</p>}
    </div>
  )
}

export default function Vault() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()

  const [connectors, setConnectors] = useState<VaultConnector[]>([])
  const [documents, setDocuments] = useState<VaultDocument[]>([])
  const [powerbi, setPowerbi] = useState<VaultPowerBI[]>([])
  const [pbiOpen, setPbiOpen] = useState<Record<string, boolean>>({}) // expanded Power BI cards
  const [kpis, setKpis] = useState<VaultKpi[]>([])
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

  // Websites section
  const [showAddSite, setShowAddSite] = useState(false)
  const [siteUrl, setSiteUrl] = useState('')
  const [siteName, setSiteName] = useState('')
  const [siteSaving, setSiteSaving] = useState(false)
  const [siteError, setSiteError] = useState<string | null>(null)

  // Data file upload state
  const [dataUploading, setDataUploading] = useState(false)
  const dataFileRef = useRef<HTMLInputElement>(null)

  async function handleAddWebsite(e: React.FormEvent) {
    e.preventDefault()
    if (!siteUrl.trim() || siteSaving) return
    setSiteSaving(true)
    setSiteError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      let url = siteUrl.trim()
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`
      const name = siteName.trim() || url.replace(/^https?:\/\//, '').replace(/\/$/, '')
      await createContext(t, orgId, { kind: 'website', name, content: '', meta: { url }, scope: 'org' })
      setShowAddSite(false)
      setSiteUrl('')
      setSiteName('')
      await load()
    } catch (e) {
      setSiteError(e instanceof Error ? e.message : 'Failed to add website')
    } finally {
      setSiteSaving(false)
    }
  }

  // Unified "drop anything" intake — AI classifies + routes to a section.
  const [anyDragOver, setAnyDragOver] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [ingestNote, setIngestNote] = useState<string | null>(null)
  const [quickInput, setQuickInput] = useState('')
  const anyDropRef = useRef<HTMLDivElement>(null)
  const anyFileRef = useRef<HTMLInputElement>(null)

  const CATEGORY_LABEL: Record<string, string> = {
    data: 'Data', website: 'Websites', image: 'Images', document: 'Documents',
    powerbi: 'Power BI', note: 'Documents',
  }

  async function ingestAny(input: { url?: string; text?: string; dataBase64?: string; mediaType?: string; filename?: string; name?: string }) {
    setIngesting(true)
    setIngestNote(null)
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const res = await ingestToVault(t, orgId, input)
      const pct = Math.round(res.confidence * 100)
      setIngestNote(`Added “${res.item.name}” to ${CATEGORY_LABEL[res.category] ?? res.category} (${pct}% confidence)`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not ingest that item')
    } finally {
      setIngesting(false)
    }
  }

  async function ingestFile(file: File) {
    const dataUri = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = reject
      r.readAsDataURL(file)
    })
    await ingestAny({ filename: file.name, name: file.name, mediaType: file.type || undefined, dataBase64: dataUri })
  }

  // Multi-file intake — process sequentially so each AI classify/route + reload
  // settles before the next, and one failure doesn't abort the rest.
  async function ingestFiles(files: File[]) {
    for (let i = 0; i < files.length; i++) {
      if (files.length > 1) setIngestNote(`Ingesting ${i + 1} of ${files.length}: ${files[i].name}…`)
      await ingestFile(files[i])
    }
    if (files.length > 1) setIngestNote(`Added ${files.length} files.`)
  }

  async function ingestQuick() {
    const v = quickInput.trim()
    if (!v) return
    const looksUrl = /^https?:\/\//i.test(v) || (/^[\w-]+(\.[\w-]+)+/.test(v) && !/\s/.test(v))
    setQuickInput('')
    await ingestAny(looksUrl ? { url: v } : { text: v, name: v.slice(0, 60) })
  }

  async function uploadDataFile(file: File) {
    setDataUploading(true)
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const ext = (file.name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase()
      const isBinary = ext === 'xlsx' || ext === 'xls'
      const meta: Record<string, unknown> = { format: ext.toUpperCase() }
      let content = ''
      if (isBinary) {
        // Catalogue the spreadsheet; store the bytes in meta so nothing is lost.
        // (Tabular extraction for .xlsx is a follow-up — export to CSV for AI use.)
        const dataUri = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(r.result as string)
          r.onerror = reject
          r.readAsDataURL(file)
        })
        if (dataUri.length < 4_000_000) meta.file = dataUri
      } else {
        content = (await file.text()).slice(0, 200_000)
      }
      await createContext(t, orgId, { kind: 'data', name: file.name, content, meta, scope: 'org' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Data upload failed')
    } finally {
      setDataUploading(false)
      if (dataFileRef.current) dataFileRef.current.value = ''
    }
  }

  async function uploadDataFiles(files: File[]) {
    for (const f of files) await uploadDataFile(f)
  }

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

  async function uploadDocFiles(files: File[]) {
    for (const f of files) await uploadDocFile(f)
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

  // Analyse-URL modal target ({ url, title } or null when closed)
  const [analyzeTarget, setAnalyzeTarget] = useState<{ url: string; title?: string } | null>(null)
  // Power BI "forensic scan" modal target.
  const [scanReport, setScanReport] = useState<VaultPowerBI | null>(null)
  const [dbAnalyze, setDbAnalyze] = useState<{ ref: string; name: string; supabase?: { url: string; key: string } } | null>(null)

  // Vault tabs — one section per tab to avoid a long cluttered scroll.
  // Remembered per org across reloads.
  const [vtab, setVtab] = useStickyTab<VTab>(`vault.tab.${orgId}`, 'connectors', VTABS)

  // Card vs list layout — remembered per org across reloads.
  const [view, setView] = useStickyTab<'card' | 'list'>(`vault.view.${orgId}`, 'card', ['card', 'list'])

  function openAddConnector() {
    setAddType(vtab === 'databases' ? 'postgres' : vtab === 'mcp' ? 'mcp' : 'rest')
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
      const [data, pbi, kpiRes] = await Promise.all([
        getOrgVault(t, orgId),
        listVaultPowerBI(t, orgId).catch(() => []),
        listVaultKpis(t, orgId).catch(() => ({ kpis: [], sourceCounts: {} })),
      ])
      setConnectors(data.connectors)
      setDocuments(data.documents)
      setPowerbi(pbi)
      setKpis(kpiRes.kpis)
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

  async function removePbi(item: VaultPowerBI) {
    if (!confirm(`Remove "${item.name}" from the vault?`)) return
    try {
      const t = await getAccessToken()
      if (!t) return
      await deleteVaultEntry(t, orgId, item.deleteRef)
      setPowerbi((prev) => prev.filter((p) => p.id !== item.id))
    } catch { /* ignore */ }
  }

  async function removeKpi(name: string) {
    if (!confirm(`Remove the KPI "${name}"? It will be detected again if its Power BI report is re-uploaded.`)) return
    const prev = kpis
    setKpis((cur) => cur.filter((k) => k.name.toLowerCase() !== name.toLowerCase())) // optimistic
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      await deleteVaultKpi(t, orgId, name)
    } catch (e) {
      setKpis(prev) // roll back on failure
      setError(e instanceof Error ? e.message : 'Failed to remove KPI')
    }
  }

  async function handleDelete(deleteRef: string, label: string, skipConfirm = false) {
    const isModel = deleteRef.startsWith('model:')
    const msg = isModel
      ? `Delete "${label}" and all its connectors? This cannot be undone.`
      : `Remove "${label}"? This cannot be undone.`
    if (!skipConfirm && !confirm(msg)) return
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

  // Classify by the REAL connector type. The vault aggregation tags every
  // context-library connector with kind 'mcp', so the true type lives in
  // meta.connectorType (rest / mcp / postgres / …). Fall back to kind only when
  // no connectorType is stored.
  const realType = (c: VaultConnector) => (((c.meta as Record<string, string> | undefined)?.connectorType) || c.kind).toLowerCase()
  const isMcp = (c: VaultConnector) => realType(c) === 'mcp'
  const databaseConnectors = useMemo(() => filteredConnectors.filter((c) => DB_KINDS.has(realType(c))), [filteredConnectors])
  const mcpConnectors = useMemo(() => filteredConnectors.filter((c) => isMcp(c) && !DB_KINDS.has(realType(c))), [filteredConnectors])
  const otherConnectors = useMemo(() => filteredConnectors.filter((c) => !DB_KINDS.has(realType(c)) && !isMcp(c)), [filteredConnectors])
  const connList = vtab === 'databases' ? databaseConnectors : vtab === 'mcp' ? mcpConnectors : otherConnectors

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

  // The Documents section's `documents` feed also carries the new Websites and
  // Data kinds — split them into their own sections.
  const websites = useMemo(() => filteredDocuments.filter((d) => d.kind === 'website'), [filteredDocuments])
  const dataFiles = useMemo(() => filteredDocuments.filter((d) => d.kind === 'data'), [filteredDocuments])
  const otherDocs = useMemo(
    // Exclude the singleton company-profile note — it has its own panel.
    () => filteredDocuments.filter((d) => d.kind !== 'website' && d.kind !== 'data' && d.name !== COMPANY_PROFILE_NAME),
    [filteredDocuments],
  )
  // Notes (kind 'note') are company/research write-ups (from Analyse, the
  // assistant, etc.) → they live under the Company tab. Docs/HTML stay under
  // Sources. Competitor notes (name-prefixed) live under the Competitors tab.
  // Markdown docs (e.g. saved from the assistant chat) get their own tab.
  // Detect by `.md` filename OR the stored format flag (meta.format === 'md'),
  // so markdown whose name lacks the extension still lands in the Markdown tab
  // instead of leaking into Documents.
  const isMd = (d: VaultDocument) => /\.md$/i.test(d.name) || (d.format ?? '').toLowerCase() === 'md'
  const markdownDocs = useMemo(() => otherDocs.filter((d) => d.kind !== 'note' && isMd(d)), [otherDocs])
  const sourceDocs = useMemo(() => otherDocs.filter((d) => d.kind !== 'note' && !isMd(d)), [otherDocs])

  // Sortable Markdown table state.
  const [mdSort, setMdSort] = useState<{ key: 'name' | 'category' | 'date'; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' })
  const mdToggleSort = (key: 'name' | 'category' | 'date') =>
    setMdSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' ? 'desc' : 'asc' }))
  const mdArrow = (key: string) => (mdSort.key === key ? (mdSort.dir === 'asc' ? '▲' : '▼') : '↕')
  const sortedMd = useMemo(() => {
    const dir = mdSort.dir === 'asc' ? 1 : -1
    return [...markdownDocs].sort((a, b) => {
      if (mdSort.key === 'name') return a.name.localeCompare(b.name) * dir
      if (mdSort.key === 'category') return (a.category ?? '').localeCompare(b.category ?? '') * dir
      return (new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()) * dir
    })
  }, [markdownDocs, mdSort])

  // Markdown multi-select + bulk delete (keyed by deleteRef).
  const [mdSelected, setMdSelected] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const mdAllSelected = markdownDocs.length > 0 && markdownDocs.every((d) => mdSelected.has(d.deleteRef))

  // Drop selections for rows that no longer exist (after delete/reload).
  useEffect(() => {
    setMdSelected((prev) => {
      if (prev.size === 0) return prev
      const live = new Set(markdownDocs.map((d) => d.deleteRef))
      const next = new Set([...prev].filter((ref) => live.has(ref)))
      return next.size === prev.size ? prev : next
    })
  }, [markdownDocs])

  function toggleMdSelect(ref: string) {
    setMdSelected((prev) => {
      const next = new Set(prev)
      next.has(ref) ? next.delete(ref) : next.add(ref)
      return next
    })
  }

  function toggleMdSelectAll() {
    setMdSelected((prev) =>
      prev.size === markdownDocs.length ? new Set() : new Set(markdownDocs.map((d) => d.deleteRef))
    )
  }

  async function bulkDeleteMd() {
    const refs = markdownDocs.filter((d) => mdSelected.has(d.deleteRef)).map((d) => d.deleteRef)
    if (refs.length === 0) return
    if (!confirm(`Delete ${refs.length} markdown file${refs.length > 1 ? 's' : ''}? This cannot be undone.`)) return
    setBulkDeleting(true)
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      for (const ref of refs) {
        try {
          await deleteVaultEntry(t, orgId, ref)
          setDocuments((prev) => prev.filter((d) => d.deleteRef !== ref))
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Delete failed')
        }
      }
      setMdSelected(new Set())
    } finally {
      setBulkDeleting(false)
    }
  }

  return (
    <main className={`wrap vault-page vault-view-${view}`}>
      <header className="vault-head">
        <div>
          <h1>
            <span className="grad-text">Data Vault</span>
          </h1>
          <p className="vault-lead">
            Everything your workspace uses to generate reports — data connectors,
            documents, MCP servers, and APIs — with who added each one.
          </p>
        </div>
        <div className="vault-head-actions">
          <div className="vault-view-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={`vault-view-btn${view === 'card' ? ' active' : ''}`}
              onClick={() => setView('card')}
              aria-pressed={view === 'card'}
              title="Card view"
            >
              ▦
            </button>
            <button
              type="button"
              className={`vault-view-btn${view === 'list' ? ' active' : ''}`}
              onClick={() => setView('list')}
              aria-pressed={view === 'list'}
              title="List view"
            >
              ☰
            </button>
          </div>
          <input
            className="vault-search"
            placeholder="Search connectors, docs, owners…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </header>

      {error && <div className="vault-error">{error}</div>}

      {/* Unified intake — drop anything, AI routes it to the right section */}
      <div
        ref={anyDropRef}
        className={`vault-intake${anyDragOver ? ' vault-intake--over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setAnyDragOver(true) }}
        onDragLeave={(e) => {
          if (anyDropRef.current && !anyDropRef.current.contains(e.relatedTarget as Node)) setAnyDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setAnyDragOver(false)
          const fs = e.dataTransfer.files
          if (fs?.length) void ingestFiles(Array.from(fs))
        }}
      >
        <div className="vault-intake-main">
          <span className="vault-intake-icon">✦</span>
          <div className="vault-intake-text">
            <strong>Drop anything — we’ll sort it.</strong>
            <span>Files (CSV, Excel, PDF, images, .pbix), a website URL, or pasted text. AI detects the type and files it in the right section.</span>
          </div>
          <label className="btn btn-primary btn-xs">
            <input
              ref={anyFileRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { const fs = e.target.files; if (fs?.length) void ingestFiles(Array.from(fs)); if (anyFileRef.current) anyFileRef.current.value = '' }}
              disabled={ingesting}
            />
            {ingesting ? 'Working…' : 'Choose files'}
          </label>
        </div>
        <div className="vault-intake-quick">
          <input
            className="vault-intake-input"
            placeholder="…or paste a URL or text and press Enter"
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void ingestQuick() } }}
            disabled={ingesting}
          />
          <button className="btn btn-ghost btn-xs" onClick={() => void ingestQuick()} disabled={ingesting || !quickInput.trim()}>
            Add
          </button>
        </div>
        {ingestNote && <div className="vault-intake-note">{ingestNote}</div>}
      </div>

      {/* Tabs — one section per tab */}
      <div className="vault-tabs">
        <button type="button" className={`vault-tab${vtab === 'connectors' ? ' active' : ''}`} onClick={() => setVtab('connectors')}>
          API<span className="vault-tab-count">{otherConnectors.length}</span>
        </button>
        <button type="button" className={`vault-tab${vtab === 'mcp' ? ' active' : ''}`} onClick={() => setVtab('mcp')}>
          🔌 MCP<span className="vault-tab-count">{mcpConnectors.length}</span>
        </button>
        <button type="button" className={`vault-tab${vtab === 'databases' ? ' active' : ''}`} onClick={() => setVtab('databases')}>
          🗄 Databases<span className="vault-tab-count">{databaseConnectors.length}</span>
        </button>
        <button type="button" className={`vault-tab${vtab === 'websites' ? ' active' : ''}`} onClick={() => setVtab('websites')}>
          Websites<span className="vault-tab-count">{websites.length}</span>
        </button>
        <button type="button" className={`vault-tab${vtab === 'data' ? ' active' : ''}`} onClick={() => setVtab('data')}>
          Data<span className="vault-tab-count">{dataFiles.length}</span>
        </button>
        <button type="button" className={`vault-tab${vtab === 'documents' ? ' active' : ''}`} onClick={() => setVtab('documents')}>
          Documents<span className="vault-tab-count">{sourceDocs.length}</span>
        </button>
        <button type="button" className={`vault-tab${vtab === 'markdown' ? ' active' : ''}`} onClick={() => setVtab('markdown')}>
          Markdown<span className="vault-tab-count">{markdownDocs.length}</span>
        </button>
        <button type="button" className={`vault-tab${vtab === 'employees' ? ' active' : ''}`} onClick={() => setVtab('employees')}>
          👥 Employees
        </button>
        <button type="button" className={`vault-tab${vtab === 'powerbi' ? ' active' : ''}`} onClick={() => setVtab('powerbi')}>
          📊 Power BI<span className="vault-tab-count">{powerbi.length}</span>
        </button>
        {/* KPIs tab hidden for now */}
      </div>

      {vtab === 'powerbi' && (
        <div className="vault-pbi">
          {powerbi.length === 0 ? (
            <div className="vault-empty">
              No Power BI reports yet — drop a <code>.pbit</code> / <code>.pbix</code> into the box above and we'll detect its tables, connections &amp; KPIs.
            </div>
          ) : powerbi.map((p) => {
            // Prefer the rich inspection counts; fall back to legacy fields.
            const kpiCount = p.inspection?.kpis?.length ?? p.measureCount
            const connCount = p.inspection?.connectors?.length ?? p.connectors.length
            // Source systems are the upstream databases/services. "Other
            // connections" = connectors NOT already shown as a source system
            // (files, folders, web) — avoids listing the same thing twice.
            const sourceSystems = p.inspection?.sourceSystems ?? []
            const sourceIds = new Set(sourceSystems.map((s) => s.connectorId))
            const otherConns = (p.inspection?.connectors ?? []).filter((c) => !sourceIds.has(c.id))
            const open = !!pbiOpen[p.id]
            return (
            <div className={`vault-pbi-card${open ? ' is-open' : ''}`} key={p.id}>
              <div className="vault-pbi-head">
                <button
                  type="button"
                  className="vault-pbi-toggle"
                  aria-expanded={open}
                  title={open ? 'Collapse' : 'Expand details'}
                  onClick={() => setPbiOpen((m) => ({ ...m, [p.id]: !open }))}
                >
                  <span className="vault-pbi-chev">{open ? '▾' : '▸'}</span>
                  <span className="vault-pbi-name">📊 {p.name}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-primary vault-pbi-analyse"
                  title="Scan this report for connectors, KPIs, databases & risks"
                  onClick={() => setScanReport(p)}
                >
                  🛰 Analyse
                </button>
                <button type="button" className="vault-pbi-del" title="Remove" onClick={() => void removePbi(p)}>✕</button>
              </div>
              <button type="button" className="vault-pbi-stats vault-pbi-stats--btn" onClick={() => setPbiOpen((m) => ({ ...m, [p.id]: !open }))}>
                {p.tables.length} table{p.tables.length === 1 ? '' : 's'} · {connCount} connection{connCount === 1 ? '' : 's'} · {kpiCount} KPI{kpiCount === 1 ? '' : 's'}
                {p.pages.length > 0 && <> · {p.pages.length} page{p.pages.length === 1 ? '' : 's'}</>}
                {!open && <span className="vault-pbi-more"> · show details</span>}
              </button>

              {open && (<>
              <PowerBiDescription orgId={orgId} report={p} />

              {sourceSystems.length > 0 && (
                <div className="vault-pbi-sec">
                  <h4>Source systems</h4>
                  <div className="vault-pbi-chips">
                    {sourceSystems.map((s, i) => (
                      <span key={i} className="vault-pbi-chip" title={[s.server, s.database].filter(Boolean).join(' / ')}>{s.name}<span className="vault-pbi-chip-kind">{s.type.replace(/_/g, ' ')}</span></span>
                    ))}
                  </div>
                </div>
              )}

              {sourceSystems.length === 0 && p.inspection?.connectors?.length === undefined && p.connectors.length > 0 && (
                <div className="vault-pbi-sec">
                  <h4>Connections</h4>
                  <div className="vault-pbi-chips">
                    {p.connectors.map((c, i) => (
                      <span key={i} className="vault-pbi-chip">{c.name}<span className="vault-pbi-chip-kind">{c.kind}</span></span>
                    ))}
                  </div>
                </div>
              )}

              {otherConns.length > 0 && (
                <div className="vault-pbi-sec">
                  <h4>{sourceSystems.length > 0 ? 'Other connections' : 'Connections'}</h4>
                  <div className="vault-pbi-chips">
                    {otherConns.map((c, i) => (
                      <span key={i} className="vault-pbi-chip" title={[c.server, c.database, c.dataset, c.url, c.filePath].filter(Boolean).join(' · ')}>{c.displayName}<span className="vault-pbi-chip-kind">{c.type.replace(/_/g, ' ')}</span></span>
                    ))}
                  </div>
                </div>
              )}

              {(p.inspection?.entities?.length ?? 0) > 0 && (
                <div className="vault-pbi-sec">
                  <h4>Business entities</h4>
                  <div className="vault-pbi-chips">
                    {p.inspection!.entities!.slice(0, 24).map((e, i) => (
                      <span key={i} className="vault-pbi-entity" title={`from: ${e.sourceNames.slice(0, 4).join(', ')}`}>{e.name}</span>
                    ))}
                  </div>
                </div>
              )}

              {((p.inspection?.kpis?.length ?? 0) > 0 || p.kpis.length > 0) && (
                <div className="vault-pbi-sec">
                  <h4>Important KPIs</h4>
                  <div className="vault-pbi-chips">
                    {p.inspection?.kpis?.length
                      ? p.inspection.kpis.slice(0, 30).map((k, i) => {
                          // Cryptic field names (t-7, 4wra…) get their plain-English
                          // meaning shown inline; descriptive names stand alone.
                          const meaning = k.businessMeaningGuess
                          const cryptic = meaning && meaning.toLowerCase() !== k.name.toLowerCase() && (/^[a-z]?[-+]?\d/i.test(k.name) || k.name.length <= 4)
                          return (
                            <span key={i} className="vault-pbi-kpi" title={[meaning && `≈ ${meaning}`, `source: ${k.source.replace(/_/g, ' ')}`, k.expression].filter(Boolean).join(' · ')}>
                              <span className="kpi-fx">fx</span>{k.name}{cryptic && <span className="vault-pbi-kpi-meaning"> · {meaning}</span>}
                            </span>
                          )
                        })
                      : p.kpis.slice(0, 24).map((k, i) => <span key={i} className="vault-pbi-kpi"><span className="kpi-fx">fx</span>{k}</span>)}
                  </div>
                </div>
              )}

              {p.tables.length > 0 && (
                <div className="vault-pbi-sec">
                  <h4>Tables &amp; fields</h4>
                  <ul className="vault-pbi-tables">
                    {p.tables.map((t, i) => (
                      <li key={i}>
                        <div className="vault-pbi-trow">
                          <span className="vault-pbi-tname">🗂 {t.name}</span>
                          <span className="vault-pbi-tmeta">{t.columns.length} col{t.columns.length === 1 ? '' : 's'}{t.measures.length ? ` · ${t.measures.length} measure${t.measures.length === 1 ? '' : 's'}` : ''}</span>
                        </div>
                        {t.columns.length > 0 && (
                          <div className="vault-pbi-cols">{t.columns.slice(0, 16).join(', ')}{t.columns.length > 16 ? ` +${t.columns.length - 16} more` : ''}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(p.inspection?.queries?.length ?? 0) > 0 && (
                <div className="vault-pbi-sec">
                  <h4>Queries &amp; lineage ({p.inspection!.queries!.length})</h4>
                  <ul className="vault-pbi-tables">
                    {p.inspection!.queries!.slice(0, 24).map((q, i) => (
                      <li key={i}>
                        <div className="vault-pbi-trow">
                          <span className="vault-pbi-tname">🧮 {q.name}</span>
                          <span className="vault-pbi-tmeta">{q.steps} step{q.steps === 1 ? '' : 's'}</span>
                        </div>
                        {q.sourceTables.length > 0 && (
                          <div className="vault-pbi-cols"><strong>from:</strong> {q.sourceTables.map((t) => `${t.schema ? `${t.schema}.` : ''}${t.name}`).slice(0, 8).join(', ')}</div>
                        )}
                        {q.selectedColumns.length > 0 && (
                          <div className="vault-pbi-cols"><strong>columns:</strong> {q.selectedColumns.slice(0, 20).join(', ')}{q.selectedColumns.length > 20 ? ` +${q.selectedColumns.length - 20} more` : ''}</div>
                        )}
                        {q.sourceTables.length === 0 && q.selectedColumns.length === 0 && q.outputEntityGuess && (
                          <div className="vault-pbi-cols">≈ {q.outputEntityGuess}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(p.inspection?.limitations?.length ?? 0) > 0 && (
                <div className="vault-pbi-sec">
                  <h4>Scan notes</h4>
                  <ul className="vault-pbi-risks">
                    {p.inspection!.limitations!.map((l, i) => (
                      <li key={i} className="vault-pbi-risk sev-info"><span className="vault-pbi-risk-sev">note</span>{l}</li>
                    ))}
                  </ul>
                </div>
              )}

              {p.pages.length > 0 && (
                <div className="vault-pbi-sec">
                  <h4>Dashboard pages ({p.pages.length})</h4>
                  <div className="vault-pbi-chips">
                    {p.pages.map((pg, i) => <span key={i} className="vault-pbi-chip">📑 {pg}</span>)}
                  </div>
                </div>
              )}

              {(p.inspection?.risks?.length ?? 0) > 0 && (
                <div className="vault-pbi-sec">
                  <h4>Risk &amp; refresh flags</h4>
                  <ul className="vault-pbi-risks">
                    {p.inspection!.risks!.map((rk, i) => (
                      <li key={i} className={`vault-pbi-risk sev-${rk.severity}`}><span className="vault-pbi-risk-sev">{rk.severity}</span>{rk.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              </>)}
            </div>
          )})}
        </div>
      )}

      {vtab === 'kpis' && (
        <div className="vault-kpis">
          {kpis.length === 0 ? (
            <div className="vault-empty">
              No KPIs detected yet — add a <strong>Power BI</strong> report (its measures &amp; metrics are detected automatically), or connect a database. Detected KPIs become grounding for reports, Blocks &amp; agents.
            </div>
          ) : (
            <>
              <div className="vault-kpis-lead">{kpis.length} KPI{kpis.length === 1 ? '' : 's'} identified across your workspace.</div>
              <div className="vault-kpi-grid">
                {kpis.map((k, i) => (
                  <div className="vault-kpi-card" key={i}>
                    <button type="button" className="vault-kpi-del" title="Remove KPI" onClick={() => void removeKpi(k.name)}>✕</button>
                    <div className="vault-kpi-top">
                      <span className="vault-kpi-name"><span className="kpi-fx">fx</span>{k.name}</span>
                      <span className={`vault-kpi-conf conf-${k.confidence}`}>{k.confidence}</span>
                    </div>
                    {k.businessMeaning && k.businessMeaning.toLowerCase() !== k.name.toLowerCase() && (
                      <div className="vault-kpi-meaning">≈ {k.businessMeaning}</div>
                    )}
                    <div className="vault-kpi-meta">
                      <span className="vault-kpi-src">{k.source.replace(/_/g, ' ')}</span>
                      {k.table && <span className="vault-kpi-table">{k.table}</span>}
                    </div>
                    {k.expression && <code className="vault-kpi-expr">{k.expression}</code>}
                    <div className="vault-kpi-origins">
                      {k.origins.map((o, j) => <span key={j} className="vault-kpi-origin">{o.type === 'powerbi' ? '📊' : o.type === 'database' ? '🗄' : '🔌'} {o.name}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {(vtab === 'connectors' || vtab === 'databases' || vtab === 'mcp') && (
      <section className="vault-section">
        <div className="vault-section-head">
          <h2>{vtab === 'databases' ? 'Connected databases' : vtab === 'mcp' ? 'MCP servers' : 'APIs'}</h2>
          <span className="vault-count">{connList.length}</span>
          {connList.some((c) => c.url) && (
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
            {vtab === 'databases' ? '+ Add database' : vtab === 'mcp' ? '+ Add MCP server' : '+ Add API'}
          </button>
        </div>
        {loading ? (
          <div className="vault-empty">Loading…</div>
        ) : connList.length === 0 ? (
          <div className="vault-empty">
            {vtab === 'databases'
              ? <>No databases connected yet — click <strong>+ Add database</strong> to connect Snowflake, SQL Server, Postgres, BigQuery and more.</>
              : vtab === 'mcp'
              ? <>No MCP servers yet — click <strong>+ Add MCP server</strong> to connect a Model Context Protocol server.</>
              : <>No APIs yet — click <strong>+ Add API</strong> to add an API or integration.</>}
          </div>
        ) : (
          <div className="vault-list">
            {connList.map((c) => {
              const t = realType(c)
              const isDb = DB_KINDS.has(t)
              const meta = (c.meta ?? {}) as Record<string, string>
              const sub = isDb
                ? `${t}${meta.host ? ` · ${meta.host}` : meta.url ? ` · ${meta.url.replace(/^https?:\/\//, '')}` : ''}`
                : `${t}${c.url ? ` · ${c.url.replace(/^https?:\/\//, '')}` : ''}`
              const tr = testResults[c.id]
              return (
                <div className="vault-row vault-row--wrap" key={c.id}>
                  <div className="vault-row-line">
                    <span className="vault-ic">{ico(t)}</span>
                    <div className="vault-row-main">
                      <div className="vault-row-name">{c.name}</div>
                      <div className="vault-row-sub">{sub}</div>
                    </div>
                    {!isDb && c.url && (
                      <button
                        className={`btn btn-xs vault-test-btn${tr === 'ok' ? ' vault-test-ok' : typeof tr === 'string' && tr !== 'testing' && tr !== 'ok' ? ' vault-test-fail' : ''}`}
                        disabled={tr === 'testing'}
                        onClick={() => void handleTest(c)}
                      >
                        {tr === 'testing' ? 'Testing…' : tr === 'ok' ? '✓' : typeof tr === 'string' && tr.startsWith('fail:') ? '✕' : 'Test'}
                      </button>
                    )}
                    {isDb ? (
                      <button
                        className="btn btn-xs btn-ghost"
                        title="Discover tables, fields & KPI-worthy data, then build Blocks"
                        onClick={() => {
                          const supabase = t === 'supabase' && meta.url && (meta.publishableKey || meta.secretKey)
                            ? { url: meta.url, key: meta.publishableKey || meta.secretKey } : undefined
                          setDbAnalyze({ ref: c.deleteRef, name: c.name, supabase })
                        }}
                      >
                        🔬 Analyze
                      </button>
                    ) : c.url ? (
                      <button
                        className="btn btn-xs btn-ghost"
                        title="Analyze with AI & build a Block"
                        onClick={() => setAnalyzeTarget({ url: c.url!, title: c.name })}
                      >
                        ⚡ Analyze
                      </button>
                    ) : null}
                    <button className="vault-edit-icon-btn" title="Edit connector" onClick={() => openEdit(c)}>✎</button>
                    <button className="vault-del-btn" title="Remove" disabled={deleting === c.deleteRef} onClick={() => void handleDelete(c.deleteRef, c.name)}>
                      {deleting === c.deleteRef ? '…' : '✕'}
                    </button>
                  </div>
                  {(testLog[c.id]?.length ?? 0) > 0 && (
                    <div className="vault-test-log">
                      {testLog[c.id].map((line, i) => (
                        <div key={i} className={`vault-test-log-line${line.startsWith('✓') || line === 'Connected' ? ' vault-test-log-ok' : line.startsWith('✕') || line === 'Connection failed' ? ' vault-test-log-fail' : ''}`}>{line}</div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      )}

      {vtab === 'websites' && (
      <section className="vault-section">
        <div className="vault-section-head">
          <h2>Websites</h2>
          <span className="vault-count">{websites.length}</span>
          <button className="btn btn-primary btn-xs" onClick={() => { setSiteUrl(''); setSiteName(''); setSiteError(null); setShowAddSite(true) }}>
            + Add website
          </button>
        </div>
        {loading ? (
          <div className="vault-empty">Loading…</div>
        ) : websites.length === 0 ? (
          <div className="vault-empty">
            No websites yet — click <strong>+ Add website</strong> to track a URL. Its live content is
            fetched when generating reports.
          </div>
        ) : (
          <div className="vault-list">
            {websites.map((w) => (
              <div className="vault-row" key={w.id}>
                <span className="vault-ic">{ico('website')}</span>
                <Link
                  className="vault-row-name vault-row-name--link"
                  style={{ flex: 1 }}
                  to={`/app/${orgId}/site?url=${encodeURIComponent(w.url ?? '')}`}
                >
                  {(w.url ?? w.name).replace(/^https?:\/\//, '')}
                </Link>
                {w.url && (
                  <button
                    className="btn btn-xs btn-ghost"
                    title="Analyse this URL with AI"
                    onClick={() => setAnalyzeTarget({ url: w.url!, title: w.name })}
                  >
                    ⚡ Analyse
                  </button>
                )}
                <button
                  className="vault-del-btn"
                  title="Remove"
                  disabled={deleting === w.deleteRef}
                  onClick={() => void handleDelete(w.deleteRef, w.name)}
                >
                  {deleting === w.deleteRef ? '…' : '✕'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      )}

      {vtab === 'data' && (
      <section className="vault-section">
        <div className="vault-section-head">
          <h2>Data</h2>
          <span className="vault-count">{dataFiles.length}</span>
          <label className="btn btn-ghost btn-xs vault-doc-upload-btn" title="Upload a spreadsheet or CSV">
            <input
              ref={dataFileRef}
              type="file"
              accept=".csv,.tsv,.json,.txt,.xlsx,.xls"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { const fs = e.target.files; if (fs?.length) void uploadDataFiles(Array.from(fs)) }}
              disabled={dataUploading}
            />
            {dataUploading ? 'Uploading…' : '+ Upload data'}
          </label>
        </div>
        {loading ? (
          <div className="vault-empty">Loading…</div>
        ) : dataFiles.length === 0 ? (
          <div className="vault-empty">
            No data files yet — upload Excel, CSV, TSV, or JSON. CSV/TSV/JSON content is read by the AI
            when generating reports.
          </div>
        ) : (
          <div className="vault-list">
            {dataFiles.map((d) => (
              <div className="vault-row" key={d.id}>
                <span className="vault-ic">{ico('data')}</span>
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
                <span className="vault-kind">{d.format || 'data'}</span>
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
      </section>

      )}

      {vtab === 'documents' && (
      <section className="vault-section">
        <div className="vault-section-head">
          <h2>Documents &amp; sources</h2>
          <span className="vault-count">{sourceDocs.length}</span>
          <label className="btn btn-ghost btn-xs vault-doc-upload-btn" title="Upload a document to the workspace library">
            <input
              ref={docFileRef}
              type="file"
              accept=".md,.txt,.html,.htm,.csv,.json,.xml,.yaml,.yml,.pdf"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { const fs = e.target.files; if (fs?.length) void uploadDocFiles(Array.from(fs)) }}
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
              const fs = e.dataTransfer.files
              if (fs?.length) void uploadDocFiles(Array.from(fs))
            }}
          >
          {sourceDocs.length === 0 && !docDropping ? (
            <div className="vault-doc-drop-hint">
              <span className="vault-doc-drop-icon">⤓</span>
              <span>Drop a file here, or use <strong>+ Upload</strong> above</span>
              <span className="vault-doc-drop-sub">.md · .txt · .html · .pdf — added to workspace library</span>
            </div>
          ) : docDropping ? (
            <div className="vault-empty">Uploading…</div>
          ) : null}
          {sourceDocs.length > 0 && (
          <div className="vault-list">
            {sourceDocs.map((d) => (
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
      )}

      {vtab === 'markdown' && (
      <section className="vault-section">
        <div className="vault-section-head">
          <h2>Markdown</h2>
          <span className="vault-count">{markdownDocs.length}</span>
          {mdSelected.size > 0 && (
            <div className="vault-bulk">
              <span className="vault-bulk-count">{mdSelected.size} selected</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMdSelected(new Set())} disabled={bulkDeleting}>
                Clear
              </button>
              <button type="button" className="btn btn-danger btn-xs" onClick={() => void bulkDeleteMd()} disabled={bulkDeleting}>
                {bulkDeleting ? 'Deleting…' : `🗑 Delete ${mdSelected.size}`}
              </button>
            </div>
          )}
        </div>
        {loading ? (
          <div className="vault-empty">Loading…</div>
        ) : markdownDocs.length === 0 ? (
          <div className="vault-empty">
            No markdown yet — in the ✦ assistant chat, click <strong>＋ Add to Vault as .md</strong> on any
            research or report and it lands here.
          </div>
        ) : (
          <table className="vault-table">
            <thead>
              <tr>
                <th className="vault-th-sel">
                  <input
                    type="checkbox"
                    className="vault-check"
                    checked={mdAllSelected}
                    ref={(el) => { if (el) el.indeterminate = mdSelected.size > 0 && !mdAllSelected }}
                    onChange={toggleMdSelectAll}
                    aria-label="Select all markdown files"
                  />
                </th>
                <th className="vault-th-ic" />
                <th><button type="button" className="vault-th" onClick={() => mdToggleSort('name')}>Name <span className="vault-th-arrow">{mdArrow('name')}</span></button></th>
                <th><button type="button" className="vault-th" onClick={() => mdToggleSort('category')}>Category <span className="vault-th-arrow">{mdArrow('category')}</span></button></th>
                <th><button type="button" className="vault-th" onClick={() => mdToggleSort('date')}>Added <span className="vault-th-arrow">{mdArrow('date')}</span></button></th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {sortedMd.map((d) => (
                <tr className={`vault-trow${mdSelected.has(d.deleteRef) ? ' vault-trow--sel' : ''}`} key={d.id}>
                  <td className="vault-td-sel">
                    <input
                      type="checkbox"
                      className="vault-check"
                      checked={mdSelected.has(d.deleteRef)}
                      onChange={() => toggleMdSelect(d.deleteRef)}
                      aria-label={`Select ${d.name}`}
                    />
                  </td>
                  <td className="vault-td-ic">📝</td>
                  <td>
                    <button
                      type="button"
                      className="vault-row-name vault-row-name--link"
                      onClick={() => void openPreview(d)}
                      disabled={previewLoading && previewRef === d.deleteRef}
                    >
                      {previewLoading && previewRef === d.deleteRef ? '…' : d.name}
                    </button>
                    <div className="vault-row-sub">{SOURCE_LABEL[d.sourceType]} · {d.sourceName}{d.scope ? ` · ${d.scope}` : ''}</div>
                  </td>
                  <td><span className="vault-cat">{d.category ?? 'Document'}</span></td>
                  <td className="vault-td-date">
                    {d.createdAt ? new Date(d.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
                  </td>
                  <td><OwnerBadge email={d.ownerEmail} /></td>
                  <td>
                    <button
                      className="vault-del-btn"
                      title="Delete"
                      disabled={deleting === d.deleteRef}
                      onClick={() => void handleDelete(d.deleteRef, d.name, true)}
                    >
                      {deleting === d.deleteRef ? '…' : '🗑'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      )}

      {vtab === 'employees' && <Employees orgId={orgId} />}

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

      {showAddSite && (
        <div className="vault-modal-backdrop" onClick={() => !siteSaving && setShowAddSite(false)}>
          <form className="vault-modal vault-add-modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => void handleAddWebsite(e)}>
            <div className="vault-modal-head">
              <h2>Add website</h2>
              <button type="button" className="vault-modal-close" onClick={() => setShowAddSite(false)}>✕</button>
            </div>
            <label className="vault-modal-field">
              <span>URL</span>
              <input
                className="vault-modal-input"
                type="url"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="https://example.com"
                autoFocus
                required
              />
            </label>
            <label className="vault-modal-field">
              <span>Name <span style={{ opacity: 0.6, fontStyle: 'italic' }}>(optional)</span></span>
              <input
                className="vault-modal-input"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="Defaults to the domain"
              />
            </label>
            {siteError && <div className="vault-modal-error">{siteError}</div>}
            <div className="vault-modal-actions">
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setShowAddSite(false)} disabled={siteSaving}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-xs" disabled={siteSaving || !siteUrl.trim()}>
                {siteSaving ? 'Saving…' : 'Add website'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showAdd && (() => {
        const fields = CONNECTOR_FIELDS[addType] ?? DEFAULT_FIELDS
        const typeChoices = vtab === 'databases'
          ? CONNECTOR_TYPES.filter((t) => DB_TYPE_IDS.has(t.id))
          : vtab === 'mcp'
          ? []
          : CONNECTOR_TYPES.filter((t) => !DB_TYPE_IDS.has(t.id) && t.id !== 'mcp')
        const modalTitle = vtab === 'databases' ? 'Connect a database' : vtab === 'mcp' ? 'Add MCP server' : 'Add connector'
        return (
          <div className="vault-modal-backdrop" onClick={() => !addSaving && setShowAdd(false)}>
            <form className="vault-modal vault-add-modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => void handleAddSave(e)}>
              <div className="vault-modal-head">
                <h2>{modalTitle}</h2>
                <button type="button" className="vault-modal-close" onClick={() => setShowAdd(false)}>✕</button>
              </div>

              {typeChoices.length > 0 && (
                <label className="vault-modal-field">
                  <span>{vtab === 'databases' ? 'Database type' : 'Type'}</span>
                  <div className="vault-type-grid">
                    {typeChoices.map((t) => (
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
              )}

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
                  {addSaving ? 'Saving…' : vtab === 'databases' ? 'Add database' : vtab === 'mcp' ? 'Add MCP server' : 'Add connector'}
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

      {analyzeTarget && (
        <AnalyzeUrlModal
          orgId={orgId}
          url={analyzeTarget.url}
          title={analyzeTarget.title}
          onClose={() => setAnalyzeTarget(null)}
          onCreated={() => void load()}
        />
      )}

      {scanReport && (
        <PowerBiScanModal orgId={orgId} report={scanReport} onClose={() => setScanReport(null)} />
      )}

      {dbAnalyze && (
        <DbAnalyzeModal orgId={orgId} deleteRef={dbAnalyze.ref} name={dbAnalyze.name} supabase={dbAnalyze.supabase} onClose={() => setDbAnalyze(null)} />
      )}
    </main>
  )
}

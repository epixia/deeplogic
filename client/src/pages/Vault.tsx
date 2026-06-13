// Vault — workspace-wide view of every connector and document used to generate
// reports, aggregated across semantic models, the context library, and each
// report's data vault. Owner-attributed.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { getOrgVault, type VaultConnector, type VaultDocument } from '../lib/api'
import './vault.css'

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
          <span className="eyebrow">Workspace vault</span>
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
        </div>
        {loading ? (
          <div className="vault-empty">Loading…</div>
        ) : filteredConnectors.length === 0 ? (
          <div className="vault-empty">
            No connectors yet — ingest a model or add MCP/API sources to a report.
          </div>
        ) : (
          <div className="vault-grid">
            {filteredConnectors.map((c) => (
              <div className="vault-card" key={c.id}>
                <div className="vault-card-top">
                  <span className="vault-ic">{ico(c.kind)}</span>
                  <div className="vault-card-name">{c.name}</div>
                  <span className="vault-kind">{c.kind}</span>
                </div>
                <div className="vault-card-meta">
                  <span className="vault-src">
                    {SOURCE_LABEL[c.sourceType]} · {c.sourceName}
                  </span>
                  <OwnerBadge email={c.ownerEmail} />
                </div>
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
        </div>
        {loading ? (
          <div className="vault-empty">Loading…</div>
        ) : filteredDocuments.length === 0 ? (
          <div className="vault-empty">
            No documents yet — add files, notes, or library items used to ground
            reports.
          </div>
        ) : (
          <div className="vault-list">
            {filteredDocuments.map((d) => (
              <div className="vault-row" key={d.id}>
                <span className="vault-ic">{ico(d.kind)}</span>
                <div className="vault-row-main">
                  <div className="vault-row-name">{d.name}</div>
                  <div className="vault-row-sub">
                    {SOURCE_LABEL[d.sourceType]} · {d.sourceName}
                    {d.scope ? ` · ${d.scope}` : ''}
                  </div>
                </div>
                <span className="vault-kind">{d.kind}</span>
                <OwnerBadge email={d.ownerEmail} />
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

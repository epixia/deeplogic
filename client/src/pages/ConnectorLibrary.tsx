// ConnectorLibrary — browse the platforms DeepLogic can connect to. Connectors
// bring data into the DataVault, which powers Blocks, Signals, and Agents.
//
// Connecting a real platform reuses the Data Vault connector flow; the Webhook
// connector shows a push endpoint external apps / Zapier / Make can post to.

import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  CONNECTORS,
  CONNECTOR_CATEGORIES,
  CONNECTOR_AUTH_LABEL,
  type Connector,
  type ConnectorCategory,
} from '../lib/connectors'
import { PRODUCT_COPY } from '../lib/productTerms'
import { getWebhookConnector } from '../lib/api'
import './connector-library.css'

type Filter = 'all' | ConnectorCategory

export default function ConnectorLibrary() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()
  const navigate = useNavigate()

  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [webhook, setWebhook] = useState<{ url: string; token: string } | null>(null)
  const [webhookBusy, setWebhookBusy] = useState(false)
  const [webhookErr, setWebhookErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Only show category chips for categories that actually have connectors.
  const usedCategories = useMemo(() => {
    const present = new Set(CONNECTORS.map((c) => c.category))
    return CONNECTOR_CATEGORIES.filter((c) => present.has(c.id))
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return CONNECTORS.filter((c) => {
      if (filter !== 'all' && c.category !== filter) return false
      if (!s) return true
      return (
        c.name.toLowerCase().includes(s) ||
        c.description.toLowerCase().includes(s) ||
        c.supportedEntities.some((e) => e.toLowerCase().includes(s)) ||
        c.recommendedBlocks.some((b) => b.toLowerCase().includes(s))
      )
    })
  }, [q, filter])

  async function openWebhook() {
    setWebhookBusy(true)
    setWebhookErr(null)
    setCopied(false)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired — please sign in again.')
      setWebhook(await getWebhookConnector(t, orgId))
    } catch (e) {
      setWebhookErr(e instanceof Error ? e.message : 'Could not load webhook details.')
      setWebhook({ url: '', token: '' })
    } finally {
      setWebhookBusy(false)
    }
  }

  function connect(c: Connector) {
    if (!c.isActive) return
    if (c.slug === 'webhook') { void openWebhook(); return }
    if (c.slug === 'csv-excel' || c.slug === 'powerbi') {
      // File / Power BI sources are ingested in the Data Vault.
      navigate(`/app/${orgId}/vault`)
      return
    }
    // Custom API + everything else lands in the Data Vault connector flow.
    navigate(`/app/${orgId}/vault`)
  }

  function copyWebhook() {
    if (!webhook?.url) return
    void navigator.clipboard?.writeText(webhook.url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <main className="wrap cl">
      <header className="cl-head">
        <div>
          <h1><span className="grad-text">Connector Library</span></h1>
          <p className="cl-lead">{PRODUCT_COPY.connectorLibrary}</p>
        </div>
      </header>

      <div className="cl-toolbar">
        <input
          className="cl-search"
          placeholder="Search connectors, entities, Blocks…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="cl-filters">
          <button type="button" className={`cl-filter${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
            All
          </button>
          {usedCategories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`cl-filter${filter === cat.id ? ' active' : ''}`}
              onClick={() => setFilter(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cl-grid">
        {filtered.map((c) => (
          <div className={`cl-card${c.isActive ? '' : ' is-soon'}`} key={c.id}>
            <div className="cl-card-top">
              <span className="cl-icon">{c.icon}</span>
              <span className="cl-name">{c.name}</span>
              {!c.isActive && <span className="cl-soon">Coming soon</span>}
            </div>
            <div className="cl-badges">
              <span className="cl-badge cl-badge-cat">{CONNECTOR_CATEGORIES.find((x) => x.id === c.category)?.label}</span>
              <span className="cl-badge cl-badge-auth">{CONNECTOR_AUTH_LABEL[c.authType]}</span>
            </div>
            <p className="cl-desc">{c.description}</p>

            <div className="cl-sec">
              <span className="cl-sec-label">Supported data</span>
              <div className="cl-chips">
                {c.supportedEntities.map((e) => <span className="cl-chip" key={e}>{e}</span>)}
              </div>
            </div>

            <div className="cl-sec">
              <span className="cl-sec-label">Recommended Blocks</span>
              <div className="cl-chips">
                {c.recommendedBlocks.map((b) => <span className="cl-chip cl-chip-block" key={b}>{b}</span>)}
              </div>
            </div>

            <div className="cl-card-foot">
              {c.isActive ? (
                <button type="button" className="btn btn-primary btn-xs" onClick={() => connect(c)}>
                  {c.slug === 'webhook' ? 'Get webhook URL' : 'Connect'}
                </button>
              ) : (
                <button type="button" className="btn btn-ghost btn-xs" disabled>Coming soon</button>
              )}
              {c.docsUrl && (
                <a className="btn btn-ghost btn-xs cl-docs" href={c.docsUrl} target="_blank" rel="noreferrer">
                  Docs ↗
                </a>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="cl-empty">No connectors match your search.</div>}
      </div>

      {webhook && (
        <div className="cl-modal-backdrop" onClick={() => setWebhook(null)}>
          <div className="cl-modal" onClick={(e) => e.stopPropagation()}>
            <h2>🪝 Webhook Connector</h2>
            <p className="cl-modal-sub">
              Point any external app, Zapier, or Make at this endpoint to push data into DeepLogic. Payloads land in
              your DataVault and can drive Blocks, Signals, and Agents.
            </p>
            {webhookBusy ? (
              <div className="cl-modal-loading">Loading endpoint…</div>
            ) : webhookErr ? (
              <div className="cl-modal-err">{webhookErr}</div>
            ) : (
              <>
                <label className="cl-field-label">POST endpoint</label>
                <div className="cl-webhook-url">
                  <code>{webhook.url}</code>
                  <button type="button" className="btn btn-secondary btn-xs" onClick={copyWebhook}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="cl-modal-note">
                  Send a JSON body via <code>POST</code>. Keep this URL secret — its token authorizes writes to your
                  workspace.
                </p>
              </>
            )}
            <div className="cl-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setWebhook(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

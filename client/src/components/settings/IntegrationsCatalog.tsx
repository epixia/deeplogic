// IntegrationsCatalog — a catalogue of popular SaaS APIs the workspace can
// connect to (QuickBooks, Salesforce, HubSpot, …). Connecting stores the
// credentials as a Data Vault connector (kind 'mcp'), so the integration is
// immediately visible in the Vault → Connectors tab and grounds agents/reports.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getOrgVault, createContext, deleteVaultEntry, type VaultConnector } from '../../lib/api'
import './integrations-catalog.css'

type AuthKind = 'apikey' | 'token' | 'oauth'
interface Integration {
  id: string
  name: string
  icon: string
  category: string
  blurb: string
  auth: AuthKind
  needsUrl?: boolean // an instance / store domain is required (Salesforce, Shopify…)
}

const CATALOG: Integration[] = [
  // Accounting & finance
  { id: 'quickbooks', name: 'QuickBooks', icon: '📗', category: 'Accounting & Finance', blurb: 'Invoices, expenses, P&L and cash flow from QuickBooks Online.', auth: 'oauth' },
  { id: 'xero', name: 'Xero', icon: '💠', category: 'Accounting & Finance', blurb: 'Accounting, invoices and bank reconciliation.', auth: 'oauth' },
  { id: 'stripe', name: 'Stripe', icon: '💳', category: 'Accounting & Finance', blurb: 'Payments, subscriptions, MRR and churn.', auth: 'apikey' },
  // CRM & sales
  { id: 'salesforce', name: 'Salesforce', icon: '☁️', category: 'CRM & Sales', blurb: 'Leads, opportunities and pipeline from your CRM.', auth: 'oauth', needsUrl: true },
  { id: 'hubspot', name: 'HubSpot', icon: '🟧', category: 'CRM & Sales', blurb: 'Contacts, deals, marketing and sales activity.', auth: 'token' },
  { id: 'pipedrive', name: 'Pipedrive', icon: '🟩', category: 'CRM & Sales', blurb: 'Sales pipeline, deals and activities.', auth: 'apikey' },
  // Commerce
  { id: 'shopify', name: 'Shopify', icon: '🛍', category: 'Commerce', blurb: 'Orders, products and storefront sales.', auth: 'token', needsUrl: true },
  { id: 'square', name: 'Square', icon: '◼️', category: 'Commerce', blurb: 'POS sales, payments and inventory.', auth: 'token' },
  { id: 'woocommerce', name: 'WooCommerce', icon: '🟣', category: 'Commerce', blurb: 'WordPress store orders & products.', auth: 'apikey', needsUrl: true },
  // Marketing
  { id: 'mailchimp', name: 'Mailchimp', icon: '🐵', category: 'Marketing', blurb: 'Email campaigns, audiences and engagement.', auth: 'apikey' },
  { id: 'google-ads', name: 'Google Ads', icon: '📣', category: 'Marketing', blurb: 'Ad spend, conversions and ROAS.', auth: 'oauth' },
  { id: 'meta-ads', name: 'Meta Ads', icon: '📘', category: 'Marketing', blurb: 'Facebook/Instagram ad performance.', auth: 'oauth' },
  // Analytics
  { id: 'ga4', name: 'Google Analytics', icon: '📈', category: 'Analytics', blurb: 'Traffic, sessions and conversions (GA4).', auth: 'oauth' },
  { id: 'mixpanel', name: 'Mixpanel', icon: '🟪', category: 'Analytics', blurb: 'Product events, funnels and retention.', auth: 'apikey' },
  // Productivity & data
  { id: 'slack', name: 'Slack', icon: '💬', category: 'Productivity & Data', blurb: 'Post alerts & summaries to channels.', auth: 'token' },
  { id: 'notion', name: 'Notion', icon: '📝', category: 'Productivity & Data', blurb: 'Read/write docs and databases.', auth: 'token' },
  { id: 'airtable', name: 'Airtable', icon: '🗂', category: 'Productivity & Data', blurb: 'Bases, tables and records.', auth: 'token' },
  { id: 'google-sheets', name: 'Google Sheets', icon: '📊', category: 'Productivity & Data', blurb: 'Pull data straight from spreadsheets.', auth: 'oauth' },
]

const CATEGORIES = [...new Set(CATALOG.map((i) => i.category))]
const AUTH_LABEL: Record<AuthKind, string> = { apikey: 'API key', token: 'Access token', oauth: 'API token / personal access token' }

export default function IntegrationsCatalog({ orgId, getToken }: { orgId: string; getToken: () => Promise<string> }) {
  const [connectors, setConnectors] = useState<VaultConnector[]>([])
  const [active, setActive] = useState<Integration | null>(null)
  const [form, setForm] = useState({ label: '', url: '', key: '' })
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const t = await getToken()
      const v = await getOrgVault(t, orgId)
      setConnectors(v.connectors)
    } catch { /* ignore */ }
  }, [getToken, orgId])

  useEffect(() => { void load() }, [load])

  // Map integration id → its connector (if connected).
  const connected = useMemo(() => {
    const m = new Map<string, VaultConnector>()
    for (const c of connectors) { const i = c.meta?.integration; if (i) m.set(i, c) }
    return m
  }, [connectors])

  function open(i: Integration) {
    setActive(i)
    setForm({ label: i.name, url: '', key: '' })
    setError(null)
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault()
    if (!active || saving) return
    if (!form.key.trim()) { setError(`Enter your ${AUTH_LABEL[active.auth]} to connect.`); return }
    if (active.needsUrl && !form.url.trim()) { setError('Enter your instance / store URL.'); return }
    setSaving(true); setError(null)
    try {
      const t = await getToken()
      const content = [
        `Integration: ${active.name}`,
        form.url ? `Instance: ${form.url.trim()}` : '',
        `Auth: ${AUTH_LABEL[active.auth]} configured`,
      ].filter(Boolean).join('\n')
      await createContext(t, orgId, {
        kind: 'mcp',
        name: form.label.trim() || active.name,
        content,
        meta: { connectorType: active.id, integration: active.id, category: active.category, url: form.url.trim(), apiKey: form.key.trim() },
        scope: 'org',
      })
      setActive(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect.')
    } finally { setSaving(false) }
  }

  async function disconnect(i: Integration) {
    const c = connected.get(i.id)
    if (!c || !confirm(`Disconnect ${i.name}? Its stored credentials will be removed.`)) return
    setBusy(i.id)
    try {
      const t = await getToken()
      await deleteVaultEntry(t, orgId, c.deleteRef)
      await load()
    } catch { /* ignore */ } finally { setBusy(null) }
  }

  return (
    <div className="ic-wrap">
      <div className="ic-head">
        <h2>Connect your tools</h2>
        <span className="ic-sub">Link the apps your business runs on. Connected sources show in your Data Vault and ground every report, agent &amp; answer.</span>
      </div>

      {CATEGORIES.map((cat) => (
        <section className="ic-cat" key={cat}>
          <h3 className="ic-cat-title">{cat}</h3>
          <div className="ic-grid">
            {CATALOG.filter((i) => i.category === cat).map((i) => {
              const isOn = connected.has(i.id)
              return (
                <div className={`ic-card${isOn ? ' is-connected' : ''}`} key={i.id}>
                  <div className="ic-card-top">
                    <span className="ic-icon">{i.icon}</span>
                    <span className="ic-name">{i.name}</span>
                    {isOn && <span className="ic-badge">✓ Connected</span>}
                  </div>
                  <p className="ic-blurb">{i.blurb}</p>
                  {isOn ? (
                    <button type="button" className="btn btn-ghost btn-xs ic-btn" disabled={busy === i.id} onClick={() => void disconnect(i)}>
                      {busy === i.id ? '…' : 'Disconnect'}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-xs ic-btn" onClick={() => open(i)}>Connect</button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {active && (
        <div className="studio-modal-backdrop" onClick={() => !saving && setActive(null)}>
          <form className="studio-modal" onClick={(e) => e.stopPropagation()} onSubmit={connect}>
            <h2>{active.icon} Connect {active.name}</h2>
            <p className="studio-modal-sub">
              Paste your {AUTH_LABEL[active.auth]} from {active.name}. We store it securely and register it as a data source.
            </p>
            {active.auth === 'oauth' && (
              <div className="ic-oauth-note">
                {active.name} normally uses OAuth — for now, paste a <strong>personal access token / API token</strong> from its developer settings. One‑click OAuth is coming soon.
              </div>
            )}
            <label className="studio-field">
              <span>Name</span>
              <input className="studio-input" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} autoFocus />
            </label>
            {active.needsUrl && (
              <label className="studio-field">
                <span>Instance / store URL</span>
                <input className="studio-input" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder={active.id === 'shopify' ? 'your-store.myshopify.com' : 'https://yourcompany.my.salesforce.com'} />
              </label>
            )}
            <label className="studio-field">
              <span>{AUTH_LABEL[active.auth]}</span>
              <input className="studio-input" type="password" value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))} placeholder="Paste your key/token" />
            </label>
            {error && <div className="studio-error">{error}</div>}
            <div className="studio-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setActive(null)} disabled={saving}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !form.key.trim()}>{saving ? 'Connecting…' : 'Connect'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

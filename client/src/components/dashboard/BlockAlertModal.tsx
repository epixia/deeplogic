// BlockAlertModal — alerts as a first-class component of a Block. Lists the
// alerts tied to this Block (widget) and lets you add/remove them. The available
// alert kinds adapt to the Block: website-embed → uptime (URL prefilled);
// any Block can also watch keywords, a numeric threshold, or an AI condition.

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import {
  listAlerts, createAlert, deleteAlert,
  type Widget, type Alert, type AlertKind,
} from '../../lib/api'
import { decodeBlockConfig, inferBlockConfig } from '../../lib/blockGallery'
import './block-alert-modal.css'

const KIND_LABEL: Record<AlertKind, string> = {
  uptime: '🌐 Site down', keyword: '🔑 Keyword', threshold: '📊 Threshold', ai: '✨ AI condition',
}

export default function BlockAlertModal({ orgId, widget, onClose }: {
  orgId: string
  widget: Widget
  onClose: () => void
}) {
  const { getAccessToken, user } = useAuth()
  const blockUrl = (() => {
    const cfg = decodeBlockConfig(widget.prompt) ?? inferBlockConfig(widget.html)
    return (cfg?.config.url || '').trim()
  })()

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState<AlertKind>(blockUrl ? 'uptime' : 'keyword')
  const [url, setUrl] = useState(blockUrl)
  const [keywords, setKeywords] = useState('')
  const [path, setPath] = useState('')
  const [op, setOp] = useState<'gt' | 'lt' | 'eq'>('gt')
  const [value, setValue] = useState('')
  const [condition, setCondition] = useState('')
  const [notify, setNotify] = useState(user?.email ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const token = useCallback(async () => (await getAccessToken()) ?? '', [getAccessToken])

  const load = useCallback(async () => {
    try {
      const t = await token(); if (!t) return
      const all = await listAlerts(t, orgId)
      setAlerts(all.filter((a) => a.widgetId === widget.id))
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load alerts.') } finally { setLoading(false) }
  }, [token, orgId, widget.id])
  useEffect(() => { void load() }, [load])

  async function add() {
    if (saving) return
    setSaving(true); setError(null)
    try {
      const t = await token(); if (!t) throw new Error('Session expired')
      const config: Record<string, unknown> = {}
      let name = widget.name
      if (kind === 'uptime') { if (!url.trim()) throw new Error('Enter a URL to monitor.'); config.url = url.trim(); name = `Uptime — ${url.trim()}` }
      else if (kind === 'keyword') { const ks = keywords.split(',').map((k) => k.trim()).filter(Boolean); if (!ks.length) throw new Error('Enter at least one keyword.'); config.keywords = ks; name = `Keyword — ${ks.join(', ')}` }
      else if (kind === 'threshold') { if (!path.trim() || !value.trim()) throw new Error('Enter a field path and a value.'); config.path = path.trim(); config.op = op; config.value = Number(value); name = `Threshold — ${path.trim()} ${op} ${value}` }
      else if (kind === 'ai') { if (!condition.trim()) throw new Error('Describe the condition to watch for.'); name = `Watch — ${widget.name}` }
      const created = await createAlert(t, orgId, {
        name: name.slice(0, 120), kind, config,
        condition: kind === 'ai' ? condition.trim() : undefined,
        widgetId: widget.id, notifyEmail: notify.trim() || undefined, status: 'active',
      })
      setAlerts((prev) => [created, ...prev])
      // Reset the lighter inputs.
      setKeywords(''); setValue(''); setCondition('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to create alert.') } finally { setSaving(false) }
  }

  async function remove(id: string) {
    try { const t = await token(); if (!t) return; await deleteAlert(t, orgId, id); setAlerts((p) => p.filter((a) => a.id !== id)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed.') }
  }

  return (
    <div className="bam-backdrop" onClick={() => !saving && onClose()}>
      <div className="bam-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bam-head">
          <h2>🔔 Alerts — <span className="bam-block">{widget.name}</span></h2>
          <button className="bam-close" onClick={onClose}>✕</button>
        </div>

        <div className="bam-body">
          {/* Existing alerts */}
          <div className="bam-sec-label">Active on this Block</div>
          {loading ? (
            <div className="bam-empty">Loading…</div>
          ) : alerts.length === 0 ? (
            <div className="bam-empty">No alerts yet — add one below.</div>
          ) : (
            <ul className="bam-list">
              {alerts.map((a) => (
                <li key={a.id} className="bam-item">
                  <span className="bam-item-kind">{KIND_LABEL[a.kind] ?? a.kind}</span>
                  <span className="bam-item-name">{a.name}</span>
                  <span className={`bam-item-status bam-${a.status}`}>{a.status}</span>
                  <button className="bam-item-del" title="Remove" onClick={() => void remove(a.id)}>✕</button>
                </li>
              ))}
            </ul>
          )}

          {/* Add alert */}
          <div className="bam-sec-label">Add an alert</div>
          <div className="bam-form">
            <label className="bam-field"><span>Type</span>
              <select className="bam-input" value={kind} onChange={(e) => setKind(e.target.value as AlertKind)}>
                <option value="uptime">🌐 Alert me if the site goes down</option>
                <option value="keyword">🔑 A keyword appears</option>
                <option value="threshold">📊 A number crosses a threshold</option>
                <option value="ai">✨ An AI-described condition</option>
              </select>
            </label>

            {kind === 'uptime' && (
              <label className="bam-field"><span>URL to monitor</span>
                <input className="bam-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
              </label>
            )}
            {kind === 'keyword' && (
              <label className="bam-field"><span>Keywords <em>(comma-separated)</em></span>
                <input className="bam-input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="recall, outage, lawsuit" />
              </label>
            )}
            {kind === 'threshold' && (
              <div className="bam-row3">
                <label className="bam-field"><span>Field</span><input className="bam-input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="temperature" /></label>
                <label className="bam-field"><span>Op</span>
                  <select className="bam-input" value={op} onChange={(e) => setOp(e.target.value as 'gt' | 'lt' | 'eq')}><option value="gt">&gt;</option><option value="lt">&lt;</option><option value="eq">=</option></select>
                </label>
                <label className="bam-field"><span>Value</span><input className="bam-input" type="number" value={value} onChange={(e) => setValue(e.target.value)} /></label>
              </div>
            )}
            {kind === 'ai' && (
              <label className="bam-field"><span>Condition</span>
                <input className="bam-input" value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="e.g. sentiment turns negative" />
              </label>
            )}

            <label className="bam-field"><span>Notify email</span>
              <input className="bam-input" value={notify} onChange={(e) => setNotify(e.target.value)} placeholder="you@company.com" />
            </label>

            {error && <div className="bam-error">{error}</div>}
            <button className="btn btn-primary" onClick={() => void add()} disabled={saving}>{saving ? 'Adding…' : '+ Add alert'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

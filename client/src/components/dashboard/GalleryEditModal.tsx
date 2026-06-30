// GalleryEditModal — edit a predefined (gallery) Block's SETTINGS in a popup.
// No vibe-coding: it shows the block's fields, rebuilds the HTML deterministically
// on save, and persists the marker so it stays a settings-only Block.

import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import {
  updateOrgWidget, searchWindyWebcams, getWindyWebcam,
  listAlerts, createAlert, deleteAlert,
  type Widget, type WindyWebcam,
} from '../../lib/api'
import { decodeBlockConfig, inferBlockConfig, encodeBlockConfig } from '../../lib/blockGallery'

// True when a widget is a predefined gallery Block (marker or HTML signature).
export function isGalleryWidget(w: Pick<Widget, 'prompt' | 'html'>): boolean {
  return !!(decodeBlockConfig(w.prompt) ?? inferBlockConfig(w.html))
}

export default function GalleryEditModal({
  orgId, widget, onClose, onSaved,
}: {
  orgId: string
  widget: Widget
  onClose: () => void
  onSaved?: (w: Widget) => void
}) {
  const { getAccessToken, user } = useAuth()
  const detected = decodeBlockConfig(widget.prompt) ?? inferBlockConfig(widget.html)
  const [cfg, setCfg] = useState<Record<string, string>>(detected?.config ?? {})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Uptime monitoring (website-embed): "alert me if the site goes down".
  const isWebsite = detected?.block.id === 'website-embed'
  const [monitor, setMonitor] = useState(false)
  const [uptimeAlertId, setUptimeAlertId] = useState<string | null>(null)

  // Load any existing uptime alert tied to this Block.
  useEffect(() => {
    if (!isWebsite) return
    void (async () => {
      try {
        const t = await getAccessToken(); if (!t) return
        const found = (await listAlerts(t, orgId)).find((a) => a.widgetId === widget.id && a.kind === 'uptime')
        if (found) { setMonitor(true); setUptimeAlertId(found.id) }
      } catch { /* ignore */ }
    })()
  }, [isWebsite, getAccessToken, orgId, widget.id])
  // Windy "find by location" finder.
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [results, setResults] = useState<WindyWebcam[] | null>(null)
  const [finding, setFinding] = useState(false)
  const [findErr, setFindErr] = useState<string | null>(null)

  async function findWebcams() {
    const la = Number(lat), lo = Number(lon)
    if (!Number.isFinite(la) || !Number.isFinite(lo)) { setFindErr('Enter a valid latitude & longitude.'); return }
    setFinding(true); setFindErr(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const r = await searchWindyWebcams(t, orgId, { lat: la, lon: lo, radius: 50, limit: 12, key: (cfg.apiKey || '').trim() || undefined })
      setResults(r.webcams)
      if (!r.webcams.length) setFindErr('No webcams found near there.')
    } catch (e) {
      setFindErr(e instanceof Error ? e.message : 'Search failed — connect Windy in Settings → APIs.')
    } finally {
      setFinding(false)
    }
  }

  // Resolve a webcam by ID → its official player embed URL (via the Windy API).
  async function loadById() {
    const id = (cfg.webcamId || '').trim()
    if (!id) { setFindErr('Enter a webcam ID.'); return }
    setFinding(true); setFindErr(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const { webcam } = await getWindyWebcam(t, orgId, id, (cfg.apiKey || '').trim() || undefined)
      if (!webcam.embedUrl) { setFindErr('That webcam has no embeddable player.'); return }
      setCfg((c) => ({ ...c, webcamId: webcam.id, embedUrl: webcam.embedUrl ?? '' }))
      setResults([webcam])
    } catch (e) {
      setFindErr(e instanceof Error ? e.message : 'Could not load that webcam.')
    } finally {
      setFinding(false)
    }
  }

  if (!detected) return null
  const block = detected.block

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const built = block.build(cfg)
      const updated = await updateOrgWidget(t, orgId, widget.id, {
        html: built.html,
        prompt: encodeBlockConfig(block.id, cfg),
      })
      // Sync the uptime alert for website-embed Blocks.
      if (isWebsite) {
        const url = (cfg.url || '').trim()
        if (monitor && url && !uptimeAlertId) {
          let host = url
          try { host = new URL(url).hostname } catch { /* keep raw */ }
          const a = await createAlert(t, orgId, {
            name: `Uptime — ${host}`, kind: 'uptime', config: { url },
            widgetId: widget.id, notifyEmail: user?.email || undefined, status: 'active',
          })
          setUptimeAlertId(a.id)
        } else if (!monitor && uptimeAlertId) {
          await deleteAlert(t, orgId, uptimeAlertId)
          setUptimeAlertId(null)
        }
      }
      onSaved?.(updated)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="studio-modal-backdrop" onClick={() => !saving && onClose()}>
      <form className="studio-modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>{block.icon} {block.name}</h2>
        <p className="studio-modal-sub">{block.description}</p>

        {block.fields.map((f) => (
          <label className="studio-field" key={f.key}>
            <span>{f.label}</span>
            {f.type === 'select' ? (
              <select className="studio-select" value={cfg[f.key] ?? f.default ?? ''} onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.value }))}>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input className="studio-input" type={f.type === 'number' ? 'number' : 'text'} value={cfg[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.value }))} />
            )}
            {(f.help || f.helpUrl) && <small className="blk-gal-help">{f.help} {f.helpUrl && <a href={f.helpUrl} target="_blank" rel="noopener noreferrer" className="blk-gal-link">{f.helpLabel ?? 'Get a key →'}</a>}</small>}
          </label>
        ))}
        {block.fields.length === 0 && <p className="blk-gal-help">This Block has no settings — it's ready to use.</p>}

        {isWebsite && (
          <label className="studio-field gal-monitor">
            <span className="gal-monitor-row">
              <input type="checkbox" checked={monitor} onChange={(e) => setMonitor(e.target.checked)} />
              🔔 Alert me if this site goes down
            </span>
            <small className="blk-gal-help">
              Monitors the URL on a schedule and {user?.email ? <>emails <strong>{user.email}</strong></> : 'notifies you'} if it stops responding.
              Manage all alerts on the Alerts page.
            </small>
          </label>
        )}

        {block.id === 'windy-webcam' && (
          <div className="gw-finder">
            <div className="gw-finder-head">Find a webcam</div>
            <label className="studio-field">
              <span>Windy API key <span className="blk-gal-help">(optional if connected in Settings → APIs)</span> <a href="https://api.windy.com/keys" target="_blank" rel="noopener noreferrer" className="blk-gal-link">Get a free key →</a></span>
              <input className="studio-input" type="password" autoComplete="off" placeholder="Paste your Windy Webcams API key" value={cfg.apiKey ?? ''} onChange={(e) => setCfg((c) => ({ ...c, apiKey: e.target.value }))} />
            </label>
            <div className="gw-finder-row">
              <input className="studio-input" placeholder="Latitude (e.g. 45.50)" value={lat} onChange={(e) => setLat(e.target.value)} />
              <input className="studio-input" placeholder="Longitude (e.g. -73.57)" value={lon} onChange={(e) => setLon(e.target.value)} />
              <button type="button" className="btn btn-secondary btn-xs" onClick={() => void findWebcams()} disabled={finding}>{finding ? '…' : '🔍 Find'}</button>
            </div>
            <div className="gw-finder-row">
              <input className="studio-input" placeholder="…or a webcam ID (e.g. 1739714700)" value={cfg.webcamId ?? ''} onChange={(e) => setCfg((c) => ({ ...c, webcamId: e.target.value }))} />
              <button type="button" className="btn btn-secondary btn-xs" onClick={() => void loadById()} disabled={finding}>{finding ? '…' : 'Load'}</button>
            </div>
            {cfg.embedUrl && <small className="blk-gal-help">✓ Webcam selected — Save to apply.</small>}
            {findErr && <small className="blk-gal-help">{findErr}</small>}
            {results && results.length > 0 && (
              <div className="gw-results">
                {results.map((w) => (
                  <button type="button" key={w.id} className={`gw-cam${cfg.webcamId === w.id ? ' sel' : ''}`} onClick={() => setCfg((c) => ({ ...c, webcamId: w.id, embedUrl: w.embedUrl ?? '' }))} title={[w.title, w.city, w.country].filter(Boolean).join(' · ')}>
                    {w.image ? <img src={w.image} alt="" loading="lazy" /> : <div className="gw-cam-noimg">📷</div>}
                    <span className="gw-cam-title">{w.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <div className="studio-error">{error}</div>}

        <div className="studio-modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}

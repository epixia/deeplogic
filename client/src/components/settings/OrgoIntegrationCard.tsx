// Settings → Integrations → Orgo.ai. Enable Orgo to provision real virtual
// computers for autonomous agents (Hermes / OpenClaw). When enabled, deploying
// an agent spins up an Orgo VM and runs the mission on it. The API key is stored
// server-side and never returned — we only ever know whether one is set.

import { useCallback, useEffect, useState } from 'react'
import { getIntegrations, saveOrgoIntegration, testOrgoIntegration } from '../../lib/api'
import './orgo-integration.css'

export default function OrgoIntegrationCard({
  orgId,
  getToken,
}: {
  orgId: string
  getToken: () => Promise<string>
}) {
  const [enabled, setEnabled] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const t = await getToken()
      const v = await getIntegrations(t, orgId)
      setEnabled(v.orgo.enabled)
      setHasKey(v.orgo.hasKey)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load integration settings.')
    } finally {
      setLoading(false)
    }
  }, [getToken, orgId])

  useEffect(() => { void load() }, [load])

  async function save(nextEnabled?: boolean) {
    setSaving(true); setError(null); setNote(null)
    try {
      const t = await getToken()
      const body: { enabled?: boolean; apiKey?: string } = {}
      if (typeof nextEnabled === 'boolean') body.enabled = nextEnabled
      if (keyInput.trim()) body.apiKey = keyInput.trim()
      const v = await saveOrgoIntegration(t, orgId, body)
      setEnabled(v.orgo.enabled)
      setHasKey(v.orgo.hasKey)
      setKeyInput('')
      setNote('Saved.')
      setTimeout(() => setNote(null), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true); setError(null); setNote(null)
    try {
      const t = await getToken()
      const r = await testOrgoIntegration(t, orgId, keyInput.trim() || undefined)
      if (r.ok) setNote('✓ Connection OK — key is valid.')
      else setError(`Connection failed: ${r.error ?? 'invalid key'}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed.')
    } finally {
      setTesting(false)
    }
  }

  async function toggle() {
    const next = !enabled
    if (next && !hasKey && !keyInput.trim()) {
      setError('Add your Orgo API key first, then enable.')
      return
    }
    await save(next)
  }

  if (loading) return <div className="orgo-card"><div className="orgo-empty">Loading…</div></div>

  return (
    <div className="orgo-card">
      <div className="orgo-head">
        <span className="orgo-logo">🖥</span>
        <div className="orgo-head-text">
          <h2>Orgo.ai — virtual computers</h2>
          <p>Provision real virtual computers and control them programmatically. Power autonomous agent fleets (Hermes / OpenClaw), automation workflows, or browser testing at scale.</p>
        </div>
        <label className={`orgo-switch${enabled ? ' is-on' : ''}`}>
          <input type="checkbox" checked={enabled} onChange={() => void toggle()} disabled={saving} />
          <span className="orgo-switch-track"><span className="orgo-switch-thumb" /></span>
        </label>
      </div>

      <div className={`orgo-status ${enabled ? 'orgo-status--on' : 'orgo-status--off'}`}>
        {enabled
          ? '● Enabled — new agent deployments provision a real Orgo VM and run their mission on it.'
          : '○ Disabled — agent deployments use a simulated VM lifecycle.'}
      </div>

      <label className="orgo-field">
        <span>API key {hasKey && <em className="orgo-haskey">· a key is saved</em>}</span>
        <input
          className="orgo-input"
          type="password"
          autoComplete="off"
          placeholder={hasKey ? '•••••••••••• (saved — paste a new key to replace)' : 'sk_live_…'}
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
        />
        <span className="orgo-hint">
          Get a key at <a href="https://www.orgo.ai/start" target="_blank" rel="noreferrer">orgo.ai/start</a>.
          Stored encrypted server-side — never shown again.
        </span>
      </label>

      {error && <div className="orgo-error">{error}</div>}
      {note && <div className="orgo-note">{note}</div>}

      <div className="orgo-actions">
        <button className="btn btn-ghost btn-xs" onClick={() => void test()} disabled={testing || (!keyInput.trim() && !hasKey)}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <button className="btn btn-primary btn-xs" onClick={() => void save()} disabled={saving || !keyInput.trim()}>
          {saving ? 'Saving…' : 'Save key'}
        </button>
      </div>
    </div>
  )
}

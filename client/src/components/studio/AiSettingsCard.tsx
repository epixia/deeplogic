// AiSettingsCard — per-workspace BYOK AI keys for ALL providers in a list.
// Each provider (Claude / OpenAI / OpenRouter) has its own model + key field and
// a "Use" radio to pick the active one. A "Test all" button validates every saved
// key (cheap, no inference). Raw keys are never returned by the API.

import { useEffect, useState } from 'react'
import {
  getAiSettings,
  saveAiSettings,
  testAiSettings,
  type AiKeyTestResult,
  type AiProvider,
  type AiSettings,
} from '../../lib/api'

const PROVIDERS: { id: AiProvider; label: string; model: string; keyHint: string }[] = [
  { id: 'anthropic', label: 'Claude (Anthropic)', model: 'claude-opus-4-8', keyHint: 'sk-ant-…' },
  { id: 'openai', label: 'OpenAI', model: 'gpt-4o', keyHint: 'sk-…' },
  { id: 'openrouter', label: 'OpenRouter', model: 'openai/gpt-4o', keyHint: 'sk-or-…' },
]

type RowState = { model: string; key: string; hasKey: boolean }

export default function AiSettingsCard({
  orgId,
  getToken,
}: {
  orgId: string
  getToken: () => Promise<string>
}) {
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [active, setActive] = useState<AiProvider>('anthropic')
  const [rows, setRows] = useState<Record<AiProvider, RowState>>({
    anthropic: { model: '', key: '', hasKey: false },
    openai: { model: '', key: '', hasKey: false },
    openrouter: { model: '', key: '', hasKey: false },
  })
  const [tests, setTests] = useState<Record<string, AiKeyTestResult>>({})
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function hydrate(s: AiSettings) {
    setSettings(s)
    setActive(s.active)
    setRows((prev) => {
      const next = { ...prev }
      for (const p of s.providers) {
        next[p.id] = { model: p.model, key: '', hasKey: p.hasKey }
      }
      return next
    })
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const t = await getToken()
        const s = await getAiSettings(t, orgId)
        if (alive) hydrate(s)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load AI settings.')
      }
    })()
    return () => {
      alive = false
    }
  }, [orgId, getToken])

  const canEdit = settings?.canEdit ?? false

  function setRow(id: AiProvider, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const t = await getToken()
      const entries = PROVIDERS.map((p) => {
        const r = rows[p.id]
        const entry: { provider: AiProvider; model?: string; apiKey?: string } = {
          provider: p.id,
          model: r.model.trim(),
        }
        if (r.key.trim()) entry.apiKey = r.key.trim() // only send newly-typed keys
        return entry
      })
      const s = await saveAiSettings(t, orgId, { active, entries })
      hydrate(s)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setBusy(false)
    }
  }

  async function testAll() {
    setTesting(true)
    setError(null)
    try {
      const t = await getToken()
      const results = await testAiSettings(t, orgId)
      const map: Record<string, AiKeyTestResult> = {}
      for (const r of results) map[r.id] = r
      setTests(map)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed.')
    } finally {
      setTesting(false)
    }
  }

  async function clearKey(id: AiProvider) {
    setBusy(true)
    try {
      const t = await getToken()
      const s = await saveAiSettings(t, orgId, {
        entries: [{ provider: id, model: rows[id].model.trim(), apiKey: '' }],
      })
      hydrate(s)
      setTests((prev) => {
        const n = { ...prev }
        delete n[id]
        return n
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear key.')
    } finally {
      setBusy(false)
    }
  }

  const anyKey = PROVIDERS.some((p) => rows[p.id].hasKey)

  return (
    <section className="rounded-card ais-card">
      <style>{styles}</style>
      <div className="ais-head">
        <div>
          <span className="eyebrow">AI providers</span>
          <h2>Bring your own model keys</h2>
          <p className="ais-sub">
            Add a key for any provider; pick which one is used to generate
            reports. Keys are stored server-side and never returned to the browser.
            Use an exact model slug — for OpenRouter, browse{' '}
            <a
              href="https://openrouter.ai/models"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--cyan)' }}
            >
              openrouter.ai/models
            </a>{' '}
            (“Test all keys” checks the key, not the model).
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={testAll}
          disabled={testing || !anyKey}
        >
          {testing ? 'Testing…' : 'Test all keys'}
        </button>
      </div>

      {error && <div className="ais-error">{error}</div>}
      {settings && !anyKey && (
        <div className="ais-note">
          {settings.envKey
            ? 'No workspace keys yet — using the server fallback key. Add one to override.'
            : 'No keys yet — report generation runs in template mode until you add one.'}
        </div>
      )}

      <div className="ais-list">
        {PROVIDERS.map((p) => {
          const r = rows[p.id]
          const test = tests[p.id]
          const isActive = active === p.id
          return (
            <div key={p.id} className={`ais-row ${isActive ? 'is-active' : ''}`}>
              <label className="ais-use" title="Use this provider">
                <input
                  type="radio"
                  name="ais-active"
                  checked={isActive}
                  disabled={!canEdit}
                  onChange={() => setActive(p.id)}
                />
                <span className="ais-use-label">{isActive ? 'Active' : 'Use'}</span>
              </label>

              <div className="ais-row-main">
                <div className="ais-row-top">
                  <span className="ais-prov-name">{p.label}</span>
                  {r.hasKey ? (
                    <span className="ais-chip on">Key set</span>
                  ) : (
                    <span className="ais-chip off">No key</span>
                  )}
                  {test && (
                    <span className={`ais-test ${test.ok ? 'ok' : 'bad'}`}>
                      {test.ok ? '✓ valid' : `✕ ${test.error || 'failed'}`}
                    </span>
                  )}
                </div>
                <div className="ais-row-fields">
                  <input
                    className="ais-input ais-model"
                    placeholder={p.model}
                    value={r.model}
                    onChange={(e) => setRow(p.id, { model: e.target.value })}
                    disabled={!canEdit || busy}
                    aria-label={`${p.label} model`}
                  />
                  <input
                    className="ais-input ais-key"
                    type="password"
                    autoComplete="off"
                    placeholder={r.hasKey ? '•••••••• saved (blank = keep)' : p.keyHint}
                    value={r.key}
                    onChange={(e) => setRow(p.id, { key: e.target.value })}
                    disabled={!canEdit || busy}
                    aria-label={`${p.label} API key`}
                  />
                  {canEdit && r.hasKey && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => clearKey(p.id)}
                      disabled={busy}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {canEdit ? (
        <div className="ais-actions">
          <button className="btn btn-primary" type="button" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save providers'}
          </button>
          {saved && <span className="ais-saved">Saved ✓</span>}
        </div>
      ) : (
        <p className="ais-hint">Only an owner or admin can change AI providers.</p>
      )}
    </section>
  )
}

const styles = `
.ais-card { padding: 24px; margin-top: 18px; display: flex; flex-direction: column; gap: 14px; }
.ais-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.ais-head h2 { font-size: 18px; font-weight: 800; margin-top: 4px; }
.ais-sub { color: var(--mut); font-size: 13.5px; margin-top: 6px; max-width: 60ch; }
.ais-error { color: var(--bad); font-size: 13px; border: 1px solid var(--line); background: var(--card2); border-radius: 8px; padding: 8px 10px; }
.ais-note { color: var(--mut); font-size: 13px; border: 1px solid var(--line); background: var(--card2); border-radius: 8px; padding: 10px 12px; }

.ais-list { display: flex; flex-direction: column; gap: 10px; }
.ais-row {
  display: flex; gap: 14px; align-items: flex-start; padding: 14px;
  border: 1px solid var(--line); border-radius: 12px; background: var(--card2);
}
.ais-row.is-active { border-color: var(--cyan); box-shadow: 0 0 0 2px rgba(111,227,240,.12); }
[data-theme='light'] .ais-row.is-active { border-color: var(--blue); box-shadow: 0 0 0 2px rgba(0,120,212,.12); }
.ais-use { display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 2px; flex: none; width: 52px; cursor: pointer; }
.ais-use input { width: 16px; height: 16px; accent-color: var(--cyan); }
.ais-use-label { font-size: 10.5px; color: var(--mut2); text-transform: uppercase; letter-spacing: .06em; font-weight: 700; }
.ais-row.is-active .ais-use-label { color: var(--cyan); }

.ais-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.ais-row-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ais-prov-name { font-size: 14.5px; font-weight: 700; color: var(--ink); }
.ais-chip { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; padding: 3px 8px; border-radius: 999px; }
.ais-chip.on { color: var(--cyan); background: rgba(111,227,240,.12); }
.ais-chip.off { color: var(--mut2); border: 1px solid var(--line); }
.ais-test { font-size: 12px; font-weight: 600; }
.ais-test.ok { color: #5fcf8a; }
.ais-test.bad { color: var(--bad); }

.ais-row-fields { display: flex; gap: 8px; flex-wrap: wrap; }
.ais-input { height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--ink); font: inherit; font-size: 13.5px; outline: none; }
.ais-input:focus { border-color: var(--cyan); box-shadow: 0 0 0 3px rgba(111,227,240,.14); }
.ais-model { width: 220px; max-width: 100%; }
.ais-key { flex: 1; min-width: 200px; }

.ais-actions { display: flex; align-items: center; gap: 12px; }
.ais-saved { color: var(--cyan); font-size: 13px; font-weight: 600; }
.ais-hint { color: var(--mut2); font-size: 12.5px; }
`

// PlatformApisCatalog — Settings → APIs. First-party data APIs that power the
// platform itself (DataForSEO for SERP / keyword / competitor data, …). Unlike
// the Integrations catalog (which registers Data Vault connectors), these keys
// are called server-side by platform features. Credentials are stored encrypted
// server-side and never returned — we only ever know { enabled, hasCreds }.

import { useCallback, useEffect, useState } from 'react'
import {
  getPlatformApis,
  savePlatformApi,
  deletePlatformApi,
  testPlatformApi,
  type PlatformApiState,
} from '../../lib/api'
import './integrations-catalog.css'
import './platform-apis.css'

interface CredField {
  key: string
  label: string
  type?: 'text' | 'password'
  placeholder?: string
  hint?: React.ReactNode
}
interface PlatformApi {
  id: string
  name: string
  icon: string
  blurb: string
  docsUrl: string
  fields: CredField[]
}

const PROVIDERS: PlatformApi[] = [
  {
    id: 'dataforseo',
    name: 'DataForSEO',
    icon: '🔍',
    blurb:
      'SERP, keyword, backlink and competitor SEO data. Powers competitor insights and SEO research across the platform.',
    docsUrl: 'https://docs.dataforseo.com/v3/',
    fields: [
      { key: 'login', label: 'Login (account email)', type: 'text', placeholder: 'you@company.com' },
      {
        key: 'password',
        label: 'API password',
        type: 'password',
        placeholder: 'API password from the API Access tab',
        hint: (
          <>
            Not your account password — copy the auto-generated <strong>API password</strong> from
            DataForSEO →{' '}
            <a href="https://app.dataforseo.com/api-access" target="_blank" rel="noreferrer">
              API Access
            </a>
            .
          </>
        ),
      },
    ],
  },
]

export default function PlatformApisCatalog({
  orgId,
  getToken,
}: {
  orgId: string
  getToken: () => Promise<string>
}) {
  const [state, setState] = useState<Record<string, PlatformApiState>>({})
  const [active, setActive] = useState<PlatformApi | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [testingAll, setTestingAll] = useState(false)
  const [results, setResults] = useState<Record<string, { ok: boolean; error?: string }>>({})

  const load = useCallback(async () => {
    try {
      const t = await getToken()
      const v = await getPlatformApis(t, orgId)
      setState(v.providers)
    } catch {
      /* ignore */
    }
  }, [getToken, orgId])

  useEffect(() => {
    void load()
  }, [load])

  // Remember non-secret field values (e.g. the login email) per org+provider so
  // the user doesn't retype them — passwords are never persisted client-side.
  const fieldStoreKey = (provider: string, key: string) => `dl.papi.${orgId}.${provider}.${key}`
  function recallField(provider: string, key: string): string {
    try {
      return localStorage.getItem(fieldStoreKey(provider, key)) ?? ''
    } catch {
      return ''
    }
  }
  function rememberField(provider: string, key: string, value: string) {
    try {
      if (value) localStorage.setItem(fieldStoreKey(provider, key), value)
      else localStorage.removeItem(fieldStoreKey(provider, key))
    } catch {
      /* storage unavailable */
    }
  }

  function open(p: PlatformApi) {
    setActive(p)
    setForm(
      Object.fromEntries(
        p.fields.map((f) => [f.key, f.type === 'password' ? '' : recallField(p.id, f.key)]),
      ),
    )
    setError(null)
    setNote(null)
  }

  const activeState = active ? state[active.id] : undefined

  // Drop a stale "test all" result once a provider's credentials change.
  function clearResult(id: string) {
    setResults((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function collectCreds(p: PlatformApi): Record<string, string> {
    const creds: Record<string, string> = {}
    for (const f of p.fields) {
      const v = form[f.key]?.trim()
      if (v) creds[f.key] = v
    }
    return creds
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!active || saving) return
    const creds = collectCreds(active)
    // When nothing is stored yet, all fields are required.
    if (!activeState?.hasCreds && active.fields.some((f) => !form[f.key]?.trim())) {
      setError('Fill in all fields to connect.')
      return
    }
    setSaving(true)
    setError(null)
    setNote(null)
    try {
      const t = await getToken()
      const v = await savePlatformApi(t, orgId, active.id, {
        enabled: true,
        credentials: Object.keys(creds).length ? creds : undefined,
      })
      setState(v.providers)
      for (const f of active.fields) {
        if (f.type !== 'password') rememberField(active.id, f.key, form[f.key]?.trim() ?? '')
      }
      clearResult(active.id)
      setActive(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    if (!active) return
    const creds = collectCreds(active)
    setTesting(true)
    setError(null)
    setNote(null)
    try {
      const t = await getToken()
      const r = await testPlatformApi(t, orgId, active.id, Object.keys(creds).length ? creds : undefined)
      if (r.ok) setNote('✓ Connection OK — credentials are valid.')
      else setError(`Connection failed: ${r.error ?? 'invalid credentials'}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed.')
    } finally {
      setTesting(false)
    }
  }

  async function toggle(p: PlatformApi) {
    const s = state[p.id]
    if (!s?.hasCreds) {
      open(p)
      return
    }
    setBusy(p.id)
    try {
      const t = await getToken()
      const v = await savePlatformApi(t, orgId, p.id, { enabled: !s.enabled })
      setState(v.providers)
      clearResult(p.id)
    } catch {
      /* ignore */
    } finally {
      setBusy(null)
    }
  }

  // Test every connected provider at once, using stored credentials.
  async function testAll() {
    const connected = PROVIDERS.filter((p) => state[p.id]?.hasCreds)
    if (!connected.length || testingAll) return
    setTestingAll(true)
    setResults({})
    try {
      const t = await getToken()
      const entries = await Promise.all(
        connected.map(async (p) => {
          try {
            return [p.id, await testPlatformApi(t, orgId, p.id)] as const
          } catch (e) {
            return [p.id, { ok: false, error: e instanceof Error ? e.message : 'request failed' }] as const
          }
        }),
      )
      setResults(Object.fromEntries(entries))
    } finally {
      setTestingAll(false)
    }
  }

  async function remove(p: PlatformApi) {
    if (!confirm(`Remove your ${p.name} credentials? Platform features using it will stop working.`)) return
    setBusy(p.id)
    try {
      const t = await getToken()
      const v = await deletePlatformApi(t, orgId, p.id)
      setState(v.providers)
      for (const f of p.fields) if (f.type !== 'password') rememberField(p.id, f.key, '')
      clearResult(p.id)
    } catch {
      /* ignore */
    } finally {
      setBusy(null)
    }
  }

  const anyConnected = PROVIDERS.some((p) => state[p.id]?.hasCreds)

  return (
    <div className="ic-wrap">
      <div className="ic-head pa-head">
        <div>
          <h2>Platform APIs</h2>
          <span className="ic-sub">
            Connect first-party data APIs that power the platform directly — SEO research,
            competitor insights and more. Keys are stored encrypted server-side and never shown again.
          </span>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-xs pa-testall"
          onClick={() => void testAll()}
          disabled={testingAll || !anyConnected}
          title={anyConnected ? 'Test every connected API' : 'Connect an API first'}
        >
          {testingAll ? 'Testing…' : 'Test all'}
        </button>
      </div>

      <div className="ic-grid">
        {PROVIDERS.map((p) => {
          const s = state[p.id]
          const connected = !!s?.hasCreds
          return (
            <div className={`ic-card${connected && s?.enabled ? ' is-connected' : ''}`} key={p.id}>
              <div className="ic-card-top">
                <span className="ic-icon">{p.icon}</span>
                <span className="ic-name">{p.name}</span>
                {connected && (
                  <span className={`pa-status${s?.enabled ? ' is-on' : ''}`}>
                    {s?.enabled ? '✓ Enabled' : '○ Disabled'}
                  </span>
                )}
              </div>
              <p className="ic-blurb">{p.blurb}</p>
              {results[p.id] && (
                <span className={`pa-test-result${results[p.id].ok ? ' ok' : ' err'}`}>
                  {results[p.id].ok ? '✓ Connection OK' : `✗ ${results[p.id].error ?? 'failed'}`}
                </span>
              )}
              <a className="pa-docs" href={p.docsUrl} target="_blank" rel="noreferrer">
                API docs ↗
              </a>
              <div className="pa-actions">
                {connected ? (
                  <>
                    <button type="button" className="btn btn-secondary btn-xs" onClick={() => open(p)}>
                      Update key
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      disabled={busy === p.id}
                      onClick={() => void toggle(p)}
                    >
                      {busy === p.id ? '…' : s?.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs pa-remove"
                      disabled={busy === p.id}
                      onClick={() => void remove(p)}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-secondary btn-xs" onClick={() => open(p)}>
                    Connect
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {active && (
        <div className="studio-modal-backdrop" onClick={() => !saving && setActive(null)}>
          <form className="studio-modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <h2>
              {active.icon} {activeState?.hasCreds ? `Update ${active.name}` : `Connect ${active.name}`}
            </h2>
            <p className="studio-modal-sub">
              Paste your credentials from{' '}
              <a href={active.docsUrl} target="_blank" rel="noreferrer">
                {active.name}
              </a>
              . We store them securely server-side and use them for platform features.
            </p>

            {active.fields.map((f) => (
              <label className="studio-field" key={f.key}>
                <span>{f.label}</span>
                <input
                  className="studio-input"
                  type={f.type === 'password' ? 'password' : 'text'}
                  autoComplete="off"
                  value={form[f.key] ?? ''}
                  placeholder={
                    activeState?.hasCreds && f.type === 'password'
                      ? '•••••••••••• (saved — paste a new value to replace)'
                      : f.placeholder
                  }
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
                {f.hint && <span className="pa-field-hint">{f.hint}</span>}
              </label>
            ))}

            {error && <div className="studio-error">{error}</div>}
            {note && <div className="pa-note">{note}</div>}

            <div className="studio-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setActive(null)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void test()} disabled={testing || saving}>
                {testing ? 'Testing…' : 'Test connection'}
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save & enable'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

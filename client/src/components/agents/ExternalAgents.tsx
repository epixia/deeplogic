// ExternalAgents — Hermes & OpenClaw sections in the Agents page. Each provider
// can be deployed to its own VM; instances show a provisioning → running
// lifecycle with connection host, and can be stopped or removed.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listExternalAgents,
  deployExternalAgent,
  stopExternalAgent,
  deleteExternalAgent,
  getIntegrations,
  type ExternalAgent,
  type ExternalAgentProvider,
} from '../../lib/api'
import AgentConfigModal from './AgentConfigModal'
import './external-agents.css'

// Memorable random codenames — used as the default instance name (editable).
const NAME_ADJ = ['Swift', 'Bold', 'Quiet', 'Clever', 'Nimble', 'Rapid', 'Lunar', 'Iron', 'Amber', 'Cobalt', 'Vivid', 'Stellar', 'Brisk', 'Onyx']
const NAME_NOUN = ['Falcon', 'Otter', 'Comet', 'Heron', 'Lynx', 'Vortex', 'Beacon', 'Cipher', 'Nomad', 'Quasar', 'Pioneer', 'Scout', 'Raven', 'Atlas']
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]
const randomAgentName = (): string => `${pick(NAME_ADJ)} ${pick(NAME_NOUN)}`

const PROVIDERS: { id: ExternalAgentProvider; label: string; icon: string; blurb: string }[] = [
  { id: 'hermes', label: 'Hermes', icon: '☿', blurb: 'Autonomous outreach & messaging agent runtime, deployed in its own VM.' },
  { id: 'openclaw', label: 'OpenClaw', icon: '🦞', blurb: 'Web-scraping & data-extraction agent runtime, deployed in its own VM.' },
]
const REGIONS = ['us-east', 'us-west', 'eu-west']
const SIZES = ['small', 'medium', 'large']

const STATUS: Record<string, { label: string; cls: string }> = {
  provisioning: { label: 'Provisioning', cls: 'ea-status--prov' },
  running: { label: 'Running', cls: 'ea-status--run' },
  stopped: { label: 'Stopped', cls: 'ea-status--stop' },
  failed: { label: 'Failed', cls: 'ea-status--fail' },
}

const MISSION: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Mission pending', cls: 'ea-m--pending' },
  in_progress: { label: 'On mission', cls: 'ea-m--active' },
  completed: { label: 'Mission complete', cls: 'ea-m--done' },
  failed: { label: 'Mission failed', cls: 'ea-m--fail' },
}

const EVENT_ICON: Record<string, string> = {
  deployed: '🚀', provisioned: '🖥', mission_started: '🎯', progress: '⏳',
  completed: '✅', failed: '⚠', message: '•',
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function ExternalAgents({
  orgId,
  getToken,
}: {
  orgId: string
  getToken: () => Promise<string>
}) {
  const [items, setItems] = useState<ExternalAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [deployProvider, setDeployProvider] = useState<ExternalAgentProvider | null>(null)
  const [form, setForm] = useState({ name: '', region: 'us-east', size: 'small', mission: '', reason: '', runtime: 'cloud' as 'cloud' | 'self-hosted' })
  const [deploying, setDeploying] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [orgoReady, setOrgoReady] = useState<boolean | null>(null)
  const [configAgent, setConfigAgent] = useState<ExternalAgent | null>(null)

  useEffect(() => {
    let on = true
    ;(async () => {
      try {
        const t = await getToken()
        const v = await getIntegrations(t, orgId)
        if (on) setOrgoReady(v.orgo.enabled && v.orgo.hasKey)
      } catch { if (on) setOrgoReady(false) }
    })()
    return () => { on = false }
  }, [getToken, orgId])

  const load = useCallback(async () => {
    try {
      const t = await getToken()
      setItems(await listExternalAgents(t, orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load external agents.')
    } finally {
      setLoading(false)
    }
  }, [getToken, orgId])

  useEffect(() => { void load() }, [load])

  // Poll while anything is mid-flight (provisioning OR still on a mission) so
  // status and mission progress update live.
  const live = items.some((i) => i.status === 'provisioning' || i.missionStatus === 'in_progress')
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => void load(), 4000)
    return () => clearInterval(t)
  }, [live, load])

  async function deploy(e: React.FormEvent) {
    e.preventDefault()
    if (!deployProvider || !form.name.trim() || !form.mission.trim() || deploying) return
    setDeploying(true)
    setError(null)
    try {
      const t = await getToken()
      const { name, region, size, mission, reason, runtime } = form
      await deployExternalAgent(t, orgId, {
        provider: deployProvider, name, region, size, mission, reason,
        runtime: runtime === 'self-hosted' ? 'self-hosted' : undefined,
      })
      setDeployProvider(null)
      setForm({ name: '', region: 'us-east', size: 'small', mission: '', reason: '', runtime: 'cloud' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deploy failed.')
    } finally {
      setDeploying(false)
    }
  }

  async function redeploy(a: ExternalAgent) {
    setBusy(a.id)
    setError(null)
    try {
      const t = await getToken()
      await deployExternalAgent(t, orgId, {
        provider: a.provider, name: a.name, region: a.region ?? 'us-east', size: a.size ?? 'small',
        mission: a.mission ?? '', reason: a.reason ?? '',
        runtime: a.runtime === 'self-hosted' ? 'self-hosted' : undefined,
        settings: a.settings ?? undefined, // carry the configured budget/cadence/guardrails into the re-run
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-deploy failed.')
    } finally {
      setBusy(null)
    }
  }

  async function stop(id: string) {
    setBusy(id)
    try {
      const t = await getToken()
      const updated = await stopExternalAgent(t, orgId, id)
      setItems((prev) => prev.map((x) => (x.id === id ? updated : x)))
    } catch { /* ignore */ } finally { setBusy(null) }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Remove external agent "${name}"? This tears down its VM.`)) return
    setBusy(id)
    try {
      const t = await getToken()
      await deleteExternalAgent(t, orgId, id)
      setItems((prev) => prev.filter((x) => x.id !== id))
    } catch { /* ignore */ } finally { setBusy(null) }
  }

  return (
    <div className="ea-wrap">
      <div className="ea-head">
        <h2>External agents</h2>
        <span className="ea-sub">Deploy autonomous agent runtimes to their own VM.</span>
      </div>

      <div className="ea-when">
        <div className="ea-when-head">
          <span className="ea-when-ic" aria-hidden>🧭</span>
          <strong>When to use an external agent</strong>
          <span className="ea-when-sub">Reach for Hermes / OpenClaw only when a task needs a real computer — otherwise the built‑in agents are faster &amp; cheaper.</span>
        </div>
        <ul className="ea-when-list">
          <li><span aria-hidden>🖱</span><div><strong>Drive a real browser</strong> — click, type &amp; navigate JS‑heavy apps the built‑in agents (static fetch only) can't see.</div></li>
          <li><span aria-hidden>🔐</span><div><strong>Log in &amp; hold a session</strong> — authenticate (passwords, OAuth, 2FA) and stay logged in across steps.</div></li>
          <li><span aria-hidden>🚪</span><div><strong>Work behind a login wall</strong> — BI/CRM, retailer portals (OCS/SQDC), bank/AR, gated competitor areas.</div></li>
          <li><span aria-hidden>✍️</span><div><strong>Submit, not just read</strong> — fill forms, post listings, send messages/DMs, apply to directories.</div></li>
          <li><span aria-hidden>⏱</span><div><strong>Run long, autonomously</strong> — minutes‑to‑hours missions that report back, not a single quick request.</div></li>
          <li><span aria-hidden>🖥</span><div><strong>Use a full desktop</strong> — upload/download files, operate desktop apps &amp; file dialogs.</div></li>
          <li><span aria-hidden>🥷</span><div><strong>Behave human‑like</strong> — pacing &amp; session state that gets past JS gating a raw fetch trips.</div></li>
        </ul>
      </div>

      {error && <div className="studio-error">{error}</div>}

      {PROVIDERS.map((p) => {
        const mine = items.filter((i) => i.provider === p.id)
        return (
          <section className="ea-section" key={p.id}>
            <div className="ea-section-head">
              <span className="ea-ic">{p.icon}</span>
              <div className="ea-section-text">
                <h3>{p.label}</h3>
                <span>{p.blurb}</span>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-xs"
                onClick={() => { setDeployProvider(p.id); setForm({ name: randomAgentName(), region: 'us-east', size: 'small', mission: '', reason: '', runtime: 'cloud' }); setError(null) }}
              >
                🚀 Deploy
              </button>
            </div>

            {loading ? (
              <div className="ea-empty">Loading…</div>
            ) : mine.length === 0 ? (
              <div className="ea-empty">No {p.label} instances deployed yet.</div>
            ) : (
              <div className="ea-grid">
                {mine.map((a) => {
                  const s = STATUS[a.status] ?? STATUS.failed
                  const m = MISSION[a.missionStatus] ?? MISSION.pending
                  const open = !!expanded[a.id]
                  const result = a.result as { summary?: string; deliverables?: string[] } | null
                  return (
                    <div className="ea-card" key={a.id}>
                      <div className="ea-card-top">
                        <span className="ea-card-name">{a.name}</span>
                        <span className={`ea-status ${s.cls}`}>
                          {a.status === 'provisioning' && <span className="ea-spinner" />}
                          {s.label}
                        </span>
                      </div>
                      <div className="ea-card-meta">
                        {p.label} · {a.region ?? '—'} · {a.size ?? '—'}
                        <span className={`ea-via ea-via--${a.deployedVia}`}>{a.deployedVia === 'chat' ? '💬 via assistant' : '🛠 manual'}</span>
                        <span className={`ea-runtime ea-runtime--${a.runtime}`}>{a.runtime === 'orgo' ? '🖥 Orgo Cloud' : a.runtime === 'self-hosted' ? '🖥 Self-hosted' : '🧪 simulated'}</span>
                      </div>

                      {a.soul && (
                        <div className="ea-soul">
                          {a.soul.soul && <p className="ea-soul-persona">{a.soul.soul}</p>}
                          {a.soul.skills.length > 0 && (
                            <div className="ea-soul-skills">
                              {a.soul.skills.map((sk, i) => <span key={i} className="ea-soul-skill">{sk}</span>)}
                            </div>
                          )}
                          {a.soul.humanMd && (
                            <details className="ea-soul-human">
                              <summary>🪪 human.md</summary>
                              <pre className="ea-soul-md">{a.soul.humanMd}</pre>
                            </details>
                          )}
                        </div>
                      )}

                      {a.settings && (() => {
                        const b = a.settings.budget ?? {}
                        const g = a.settings.guardrails ?? {}
                        const chips: string[] = []
                        if (b.maxRuntimeMin) chips.push(`⏱ ${b.maxRuntimeMin}m`)
                        if (b.maxSteps) chips.push(`👣 ${b.maxSteps} steps`)
                        if (b.maxSpendUsd) chips.push(`💰 $${b.maxSpendUsd}`)
                        if (a.settings.cadence && a.settings.cadence !== 'once') chips.push(`🔁 ${a.settings.cadence}`)
                        if (g.requireApproval) chips.push('🛡 approval')
                        if (g.readOnly) chips.push('👁 read-only')
                        if (g.allowedDomains && g.allowedDomains.length) chips.push(`🌐 ${g.allowedDomains.length} domains`)
                        return chips.length ? <div className="ea-cfg-badges">{chips.map((c, i) => <span key={i} className="ea-cfg-badge">{c}</span>)}</div> : null
                      })()}

                      {a.mission && (
                        <div className="ea-mission">
                          <div className="ea-mission-head">
                            <span className="ea-mission-label">🎯 Mission</span>
                            <span className={`ea-mstatus ${m.cls}`}>
                              {a.missionStatus === 'in_progress' && <span className="ea-spinner" />}
                              {m.label}
                            </span>
                          </div>
                          <p className="ea-mission-text">{a.mission}</p>
                          {a.reason && <p className="ea-reason"><strong>Why:</strong> {a.reason}</p>}
                        </div>
                      )}

                      {(a.status === 'failed' || a.missionStatus === 'failed') && (() => {
                        const failEv = [...a.events].reverse().find((e) => e.kind === 'failed')
                        const msg = (failEv?.message ?? 'The deployment could not be completed.').replace(/^Orgo error:\s*/i, '')
                        const isUpgrade = /paid plan|upgrade/i.test(msg)
                        return (
                          <div className="ea-fail">
                            <div className="ea-fail-head">⚠ Deployment failed</div>
                            <p className="ea-fail-msg">{msg}</p>
                            <div className="ea-fail-actions">
                              {isUpgrade && <a className="btn btn-primary btn-xs" href="https://www.orgo.ai/billing" target="_blank" rel="noreferrer">Upgrade Orgo →</a>}
                              <button className="btn btn-ghost btn-xs" onClick={() => void redeploy(a)}>↻ Re-deploy</button>
                            </div>
                          </div>
                        )
                      })()}

                      {a.missionStatus === 'completed' && result?.summary && (
                        <div className="ea-result">
                          <div className="ea-result-head">✅ Reported back to DeepLogic central</div>
                          <p className="ea-result-summary">{result.summary}</p>
                          {Array.isArray(result.deliverables) && (
                            <ul className="ea-result-list">
                              {result.deliverables.map((d, i) => <li key={i}>{d}</li>)}
                            </ul>
                          )}
                        </div>
                      )}

                      {a.events.length > 0 && (
                        <div className="ea-timeline-wrap">
                          <button className="ea-timeline-toggle" onClick={() => setExpanded((e) => ({ ...e, [a.id]: !open }))}>
                            {open ? '▾' : '▸'} Activity ({a.events.length})
                          </button>
                          {open && (
                            <ul className="ea-timeline">
                              {a.events.map((ev) => (
                                <li className="ea-event" key={ev.id}>
                                  <span className="ea-event-ic">{EVENT_ICON[ev.kind] ?? '•'}</span>
                                  <span className="ea-event-msg">{ev.message || ev.kind}</span>
                                  <span className="ea-event-time">{timeAgo(ev.createdAt)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      {a.status === 'running' && a.host && (
                        <a className="ea-host" href={a.host} target="_blank" rel="noreferrer">{a.host} ↗</a>
                      )}

                      {a.runtime === 'self-hosted' && a.callbackToken && (() => {
                        const origin = typeof window !== 'undefined' ? window.location.origin : ''
                        const cmd = `DEEPLOGIC_URL=${origin} \\\nAGENT_ID=${a.id} \\\nAGENT_TOKEN=${a.callbackToken} \\\nHERMES_CMD='your-hermes "{{mission}}"' \\\nnode scripts/hermes-worker.mjs`
                        return (
                          <details className="ea-connect">
                            <summary>🔌 Connect your worker</summary>
                            <p className="ea-connect-note">
                              Run this on your machine (Mac mini, etc.). It claims the mission and reports back — no inbound
                              exposure needed. Replace <code>HERMES_CMD</code> with your Hermes command (<code>{'{{mission}}'}</code> is substituted).
                            </p>
                            <pre className="ea-connect-cmd"><code>{cmd}</code></pre>
                            <button type="button" className="btn btn-ghost btn-xs" onClick={() => void navigator.clipboard?.writeText(cmd)}>Copy command</button>
                          </details>
                        )
                      })()}

                      <div className="ea-card-actions">
                        <button className="btn btn-ghost btn-xs" onClick={() => setConfigAgent(a)}>⚙ Configure</button>
                        {a.status === 'running' && (
                          <button className="btn btn-ghost btn-xs" disabled={busy === a.id} onClick={() => void stop(a.id)}>
                            {busy === a.id ? '…' : 'Stop'}
                          </button>
                        )}
                        <button className="btn btn-ghost btn-xs ea-remove" disabled={busy === a.id} onClick={() => void remove(a.id, a.name)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}

      {configAgent && (
        <AgentConfigModal
          orgId={orgId}
          agent={configAgent}
          onClose={() => setConfigAgent(null)}
          onSaved={(updated) => setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
        />
      )}

      {deployProvider && (
        <div className="studio-modal-backdrop" onClick={() => !deploying && setDeployProvider(null)}>
          <form className="studio-modal" onClick={(e) => e.stopPropagation()} onSubmit={deploy}>
            <h2>Deploy {PROVIDERS.find((p) => p.id === deployProvider)?.label} to a VM</h2>
            <p className="studio-modal-sub">Provisions a dedicated cloud computer and runs your goal on it autonomously.</p>

            {orgoReady === false && (
              <div className="ea-orgo-note ea-orgo-note--warn">
                ⚠ Orgo.ai not enabled — this will run <strong>simulated</strong>. Add your key <em>and turn Orgo on</em> in{' '}
                <Link to={`/app/${orgId}/settings?tab=ai`}>Settings → AI Providers</Link> for a real VM.
              </div>
            )}
            {orgoReady && (
              <div className="ea-orgo-note ea-orgo-note--ok">
                🖥 Deploys to a real <strong>Orgo.ai</strong> VM. It works autonomously and reports results back to DeepLogic securely.
              </div>
            )}

            <label className="studio-field">
              <span>Runtime</span>
              <select className="studio-select" value={form.runtime} onChange={(e) => setForm((f) => ({ ...f, runtime: e.target.value as 'cloud' | 'self-hosted' }))}>
                <option value="cloud">Orgo Cloud</option>
                <option value="self-hosted">Self-hosted — my own machine</option>
              </select>
              {form.runtime === 'self-hosted' && (
                <span className="ea-runtime-hint">
                  Runs on your computer (e.g. a Mac mini). After deploy, use the agent’s <strong>Connect</strong> details
                  to run the worker — it claims the mission and reports back. No inbound exposure needed.
                </span>
              )}
            </label>

            <label className="studio-field">
              <span>Goal — what should this agent accomplish?</span>
              <textarea
                className="studio-input" rows={3} autoFocus
                placeholder={deployProvider === 'hermes' ? 'e.g. Reach out to 50 dispensary buyers in Ontario and book demo calls.' : 'e.g. Scrape competitor pricing from these 8 sites weekly and summarise changes.'}
                value={form.mission} onChange={(e) => setForm((f) => ({ ...f, mission: e.target.value }))}
              />
            </label>
            <label className="studio-field">
              <span>Agent name</span>
              <div className="ea-name-row">
                <input className="studio-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Agent name" />
                <button type="button" className="btn btn-ghost btn-xs ea-name-dice" title="Pick a new random name" onClick={() => setForm((f) => ({ ...f, name: randomAgentName() }))}>🎲</button>
              </div>
            </label>
            <label className="studio-field">
              <span>Reason (optional) — why outsource this?</span>
              <input className="studio-input" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Why this needs a dedicated autonomous agent." />
            </label>
            <label className="studio-field">
              <span>Region</span>
              <select className="studio-select" value={form.region} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}>
                {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="studio-field">
              <span>VM size</span>
              <select className="studio-select" value={form.size} onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}>
                {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>

            <div className="studio-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setDeployProvider(null)} disabled={deploying}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={deploying || !form.name.trim() || !form.mission.trim()}>
                {deploying ? 'Deploying…' : '🚀 Deploy'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

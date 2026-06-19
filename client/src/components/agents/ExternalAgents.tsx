// ExternalAgents — Hermes & OpenClaw sections in the Agents page. Each provider
// can be deployed to its own VM; instances show a provisioning → running
// lifecycle with connection host, and can be stopped or removed.

import { useCallback, useEffect, useState } from 'react'
import {
  listExternalAgents,
  deployExternalAgent,
  stopExternalAgent,
  deleteExternalAgent,
  type ExternalAgent,
  type ExternalAgentProvider,
} from '../../lib/api'
import './external-agents.css'

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
  const [form, setForm] = useState({ name: '', region: 'us-east', size: 'small', mission: '', reason: '' })
  const [deploying, setDeploying] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

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
    if (!deployProvider || !form.name.trim() || deploying) return
    setDeploying(true)
    setError(null)
    try {
      const t = await getToken()
      await deployExternalAgent(t, orgId, { provider: deployProvider, ...form })
      setDeployProvider(null)
      setForm({ name: '', region: 'us-east', size: 'small', mission: '', reason: '' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deploy failed.')
    } finally {
      setDeploying(false)
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
                onClick={() => { setDeployProvider(p.id); setForm({ name: `${p.label} agent`, region: 'us-east', size: 'small', mission: '', reason: '' }); setError(null) }}
              >
                🚀 Deploy to VM
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
                        <span className={`ea-runtime ea-runtime--${a.runtime}`}>{a.runtime === 'orgo' ? '🖥 Orgo VM' : '🧪 simulated'}</span>
                      </div>

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
                      <div className="ea-card-actions">
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

      {deployProvider && (
        <div className="studio-modal-backdrop" onClick={() => !deploying && setDeployProvider(null)}>
          <form className="studio-modal" onClick={(e) => e.stopPropagation()} onSubmit={deploy}>
            <h2>Deploy {PROVIDERS.find((p) => p.id === deployProvider)?.label} to a VM</h2>
            <p className="studio-modal-sub">Provisions a dedicated VM and starts the agent runtime.</p>

            <label className="studio-field">
              <span>Instance name</span>
              <input className="studio-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
            </label>
            <label className="studio-field">
              <span>Mission — what should it accomplish?</span>
              <textarea
                className="studio-input" rows={3}
                placeholder={deployProvider === 'hermes' ? 'e.g. Reach out to 50 dispensary buyers in Ontario and book demo calls.' : 'e.g. Scrape competitor pricing from these 8 sites weekly and summarise changes.'}
                value={form.mission} onChange={(e) => setForm((f) => ({ ...f, mission: e.target.value }))}
              />
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
              <button type="submit" className="btn btn-primary" disabled={deploying || !form.name.trim()}>
                {deploying ? 'Deploying…' : '🚀 Deploy'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

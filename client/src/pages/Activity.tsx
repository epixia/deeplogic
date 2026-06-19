// Activity — the AI Activity Log. A reverse-chronological feed of every agent
// run (internal + deployed), each expandable to its full step trace and result.
// Reads /agent-runs; live-refreshes while any run is in flight. Supports a
// per-agent view via ?agent=<id>.

import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { listAgentRuns, getAgentRun, type AgentRun, type AgentRunEvent } from '../lib/api'
import '../components/studio/studio.css'
import './activity.css'

const STATUS: Record<AgentRun['status'], { label: string; cls: string }> = {
  running: { label: 'Running', cls: 'run' },
  succeeded: { label: 'Succeeded', cls: 'ok' },
  failed: { label: 'Failed', cls: 'fail' },
  cancelled: { label: 'Cancelled', cls: 'cancel' },
}
const TRIGGER_ICON: Record<string, string> = {
  manual: '👆', schedule: '⏱', chat: '💬', goal: '🎯', orchestrator: '🎛', deploy: '🚀',
}

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function duration(a: string, b: string | null): string {
  if (!b) return ''
  const ms = new Date(b).getTime() - new Date(a).getTime()
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

const CRON_LABEL: Record<string, string> = {
  '0 * * * *': 'Hourly', '0 9 * * *': 'Daily 9am', '0 9 * * 1': 'Weekly Mon 9am', '0 9 1 * *': 'Monthly 1st 9am',
}
// Does this run recur (the agent has a schedule) or is it a one-time run?
function runType(r: AgentRun): { recurring: boolean; label: string; followup: string } {
  const sched = typeof r.triggerContext?.schedule === 'string' ? (r.triggerContext.schedule as string) : null
  const recurring = !!r.triggerContext?.recurring || !!sched
  const schLabel = sched ? (CRON_LABEL[sched] ?? sched) : ''
  return recurring
    ? { recurring: true, label: `↻ Recurring${schLabel ? ` · ${schLabel}` : ''}`, followup: 'Loops — runs again automatically on its schedule.' }
    : { recurring: false, label: '○ One-time', followup: 'One-time run — no automated follow-up or loop; runs only when triggered.' }
}
// Aggregate a group's status: running wins, then failed, else succeeded.
function groupStatus(runs: AgentRun[]): AgentRun['status'] {
  if (runs.some((r) => r.status === 'running')) return 'running'
  if (runs.some((r) => r.status === 'failed')) return 'failed'
  if (runs.every((r) => r.status === 'cancelled')) return 'cancelled'
  return 'succeeded'
}

export default function Activity() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()
  const [params] = useSearchParams()
  const agentId = params.get('agent') ?? undefined

  const [runs, setRuns] = useState<AgentRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [detail, setDetail] = useState<Record<string, { events: AgentRunEvent[]; result: string | null; error: string | null; loading: boolean }>>({})

  const toggleGroup = (id: string) => setOpenGroups((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      setRuns(await listAgentRuns(t, orgId, { agentId, limit: 100 }))
      setError(null)
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : 'Failed to load activity.')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [getAccessToken, orgId, agentId])

  useEffect(() => { void load() }, [load])

  // Live-refresh while any run is still running.
  const anyRunning = runs.some((r) => r.status === 'running')
  useEffect(() => {
    if (!anyRunning) return
    const id = setInterval(() => { void load(true) }, 4000)
    return () => clearInterval(id)
  }, [anyRunning, load])

  async function toggle(run: AgentRun) {
    if (open === run.id) { setOpen(null); return }
    setOpen(run.id)
    if (detail[run.id] && !detail[run.id].loading) return
    setDetail((d) => ({ ...d, [run.id]: { events: [], result: null, error: null, loading: true } }))
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const full = await getAgentRun(t, orgId, run.id)
      setDetail((d) => ({ ...d, [run.id]: { events: full.events, result: full.result, error: full.error, loading: false } }))
    } catch {
      setDetail((d) => ({ ...d, [run.id]: { events: [], result: null, error: 'Failed to load trace.', loading: false } }))
    }
  }

  const agentName = agentId ? runs[0]?.agentName : undefined

  return (
    <main className="wrap studio">
      <header className="studio-head">
        <div>
          <h1><span className="grad-text">Activity</span></h1>
          <p className="studio-lead">
            {agentId
              ? <>Run history{agentName ? <> for <strong>{agentName}</strong></> : ''}. <Link to={`/app/${orgId}/activity`}>← All activity</Link></>
              : 'Every agent run across your workspace — what ran, what it did, and the result.'}
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>↻ Refresh</button>
      </header>

      {error && <div className="studio-error">{error}</div>}

      {loading ? (
        <div className="studio-empty">Loading activity…</div>
      ) : runs.length === 0 ? (
        <div className="studio-empty">
          No agent runs yet. Run an agent from the <Link to={`/app/${orgId}/agents`}>Agents</Link> page or ask the assistant to run one — every run is recorded here with its trace and result.
        </div>
      ) : (
        <div className="act-list">
          {(() => {
            // Build an ordered list of cards: grouped orchestrations + single runs.
            const groups = new Map<string, AgentRun[]>()
            const order: ({ kind: 'group'; id: string } | { kind: 'single'; run: AgentRun })[] = []
            for (const r of runs) {
              if (r.groupId) {
                if (!groups.has(r.groupId)) { groups.set(r.groupId, []); order.push({ kind: 'group', id: r.groupId }) }
                groups.get(r.groupId)!.push(r)
              } else {
                order.push({ kind: 'single', run: r })
              }
            }
            return order.map((item) => {
              if (item.kind === 'single') return renderRun(item.run, false)
              const children = groups.get(item.id)!
              const gst = STATUS[groupStatus(children)]
              const label = children[0].groupLabel ?? 'Orchestration'
              const opened = openGroups.has(item.id)
              const started = children.reduce((m, r) => Math.min(m, new Date(r.startedAt).getTime()), Infinity)
              const okCount = children.filter((r) => r.status === 'succeeded').length
              return (
                <div className={`act-group${opened ? ' is-open' : ''}`} key={item.id}>
                  <button type="button" className="act-row act-grouprow" onClick={() => toggleGroup(item.id)}>
                    <span className={`act-dot act-dot--${gst.cls}`} aria-hidden />
                    <span className="act-main">
                      <span className="act-name">🎯 {label}</span>
                      <span className="act-meta">
                        <span className="act-trigger">orchestration · {children.length} agent{children.length === 1 ? '' : 's'}</span>
                        <span className="act-runtype">○ One-time</span>
                        <span>{ago(new Date(started).toISOString())}</span>
                      </span>
                    </span>
                    <span className={`act-status act-status--${gst.cls}`}>{okCount}/{children.length} ok</span>
                    <span className="act-chev" aria-hidden>{opened ? '▾' : '▸'}</span>
                  </button>
                  {opened && (
                    <div className="act-children">
                      {children.map((r) => renderRun(r, true))}
                    </div>
                  )}
                </div>
              )
            })
          })()}
        </div>
      )}
    </main>
  )

  function renderRun(r: AgentRun, nested: boolean) {
    const st = STATUS[r.status]
    const d = detail[r.id]
    const rt = runType(r)
    return (
      <div className={`act-run${open === r.id ? ' is-open' : ''}${nested ? ' act-run--nested' : ''}`} key={r.id}>
        <button type="button" className="act-row" onClick={() => void toggle(r)}>
          <span className={`act-dot act-dot--${st.cls}`} aria-hidden />
          <span className="act-main">
            <span className="act-name">
              {r.agentName || 'Agent'}
              {!nested && r.trigger === 'goal' && typeof r.triggerContext?.goalTitle === 'string' && (
                <Link className="act-goal-tag" to={`/app/${orgId}/goals`} onClick={(e) => e.stopPropagation()} title="Part of this goal">🎯 {r.triggerContext.goalTitle as string}</Link>
              )}
            </span>
            <span className="act-meta">
              {!nested && <span className="act-trigger">{TRIGGER_ICON[r.trigger] ?? '•'} {r.trigger}</span>}
              <span className={`act-runtype${rt.recurring ? ' is-loop' : ''}`}>{rt.label}</span>
              <span>{ago(r.startedAt)}</span>
              {r.finishedAt && <span>· {duration(r.startedAt, r.finishedAt)}</span>}
            </span>
          </span>
          <span className={`act-status act-status--${st.cls}`}>{st.label}</span>
          <span className="act-chev" aria-hidden>{open === r.id ? '▾' : '▸'}</span>
        </button>

        {open === r.id && (
          <div className="act-detail">
            {d?.loading ? (
              <div className="act-loading">Loading trace…</div>
            ) : (() => {
              const events = d?.events ?? []
              const actions = events.filter((e) => e.kind === 'tool_call')
              const reasoning = events.filter((e) => e.kind === 'reasoning')
              const lifecycle = events.filter((e) => e.kind === 'step')
              return (
                <>
                  {/* Actions taken — the concrete things the agent did. */}
                  <div className="act-section">
                    <div className="act-result-head">Actions taken <span className="act-count">{actions.length}</span></div>
                    {actions.length > 0 ? (
                      <div className="act-trace">
                        {actions.map((e) => (
                          <div key={e.id} className="act-event act-event--tool_call">
                            <span className="act-event-ic">{e.icon ?? '⚙'}</span>
                            <span className="act-event-msg">{e.message}</span>
                            <span className="act-event-time">{ago(e.createdAt)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="act-empty-line">No tools were used — the agent answered directly from its context (no web search, page reads, or Vault writes).</div>
                    )}
                  </div>

                  {reasoning.length > 0 && (
                    <details className="act-section act-reasoning">
                      <summary>🧠 Reasoning ({reasoning.length})</summary>
                      <div className="act-trace">
                        {reasoning.map((e) => (
                          <div key={e.id} className="act-event act-event--reasoning">
                            <span className="act-event-ic">{e.icon ?? '🧠'}</span>
                            <span className="act-event-msg">{e.message}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {d?.result && (
                    <div className="act-result">
                      <div className="act-result-head">Result</div>
                      <pre className="act-result-body">{d.result}</pre>
                    </div>
                  )}
                  {d?.error && <div className="act-run-error">⚠ {d.error}</div>}

                  {/* What happens after the result — loop or one-time. */}
                  <div className="act-disposition">
                    <span className={`act-disp-badge${rt.recurring ? ' is-loop' : ''}`}>{rt.label}</span>
                    <span className="act-disp-text">{rt.followup}</span>
                  </div>

                  {events.length === 0 && !d?.result && !d?.error && (
                    <div className="act-loading">No trace recorded for this run.</div>
                  )}
                  {lifecycle.some((e) => e.icon === '✗') && (
                    <div className="act-run-error">⚠ This run ended with an error — see the actions above.</div>
                  )}
                </>
              )
            })()}
          </div>
        )}
      </div>
    )
  }
}

// Activity — the AI Activity Log. A reverse-chronological feed of every agent
// run (internal + deployed), each expandable to its full step trace and result.
// Reads /agent-runs; live-refreshes while any run is in flight. Supports a
// per-agent view via ?agent=<id>.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { listAgentRuns, getAgentRun, type AgentRun, type AgentRunEvent } from '../lib/api'
import { renderMarkdown } from '../lib/markdown'
import '../components/studio/studio.css'
import './activity.css'

// Make raw http(s) URLs in a plain step message clickable (new tab).
function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((p, i) =>
    /^https?:\/\//.test(p)
      ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a>
      : <span key={i}>{p}</span>,
  )
}

const STATUS: Record<AgentRun['status'], { label: string; cls: string }> = {
  running: { label: 'Running', cls: 'run' },
  succeeded: { label: 'Succeeded', cls: 'ok' },
  failed: { label: 'Failed', cls: 'fail' },
  cancelled: { label: 'Cancelled', cls: 'cancel' },
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
// A short "type" label for a run (shown as a column/badge).
function typeLabel(r: AgentRun): string {
  if (r.agentKind === 'external') return 'External'
  if (r.trigger === 'goal') return 'Goal'
  if (r.trigger === 'orchestrator') return 'Orchestration'
  if (r.trigger === 'schedule') return 'Scheduled'
  if (r.trigger === 'chat') return 'Chat'
  if (r.trigger === 'deploy') return 'Deploy'
  return 'Agent'
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
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

  // Open/close an orchestration group. On open, preload every child run's full
  // detail so the team summary can show what each agent actually produced.
  async function toggleGroup(id: string, children: AgentRun[]) {
    const willOpen = !openGroups.has(id)
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    if (!willOpen) return
    const t = await getAccessToken()
    if (!t) return
    for (const r of children) {
      if (detail[r.id] && !detail[r.id].loading) continue
      setDetail((d) => ({ ...d, [r.id]: { events: [], result: null, error: null, loading: true } }))
      try {
        const full = await getAgentRun(t, orgId, r.id)
        setDetail((d) => ({ ...d, [r.id]: { events: full.events, result: full.result, error: full.error, loading: false } }))
      } catch {
        setDetail((d) => ({ ...d, [r.id]: { events: [], result: null, error: 'Failed to load.', loading: false } }))
      }
    }
  }

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

  // Search + sort + pagination over the ordered card list.
  const PAGE_SIZE = 15
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: 'created' | 'name' | 'type' | 'status'; dir: 'asc' | 'desc' }>({ key: 'created', dir: 'desc' })
  useEffect(() => { setPage(0) }, [agentId, query, sort])
  const toggleSort = (key: 'created' | 'name' | 'type' | 'status') =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'created' ? 'desc' : 'asc' }))
  const sortArrow = (key: string) => (sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕')

  const { order, groups } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? runs.filter((r) => [r.agentName, r.groupLabel ?? '', r.trigger, typeLabel(r), r.model ?? ''].some((f) => f.toLowerCase().includes(q)))
      : runs
    const groups = new Map<string, AgentRun[]>()
    const order: ({ kind: 'group'; id: string } | { kind: 'single'; run: AgentRun })[] = []
    for (const r of filtered) {
      if (r.groupId) {
        if (!groups.has(r.groupId)) { groups.set(r.groupId, []); order.push({ kind: 'group', id: r.groupId }) }
        groups.get(r.groupId)!.push(r)
      } else {
        order.push({ kind: 'single', run: r })
      }
    }
    type Item = { kind: 'group'; id: string } | { kind: 'single'; run: AgentRun }
    const nameOf = (it: Item) => it.kind === 'single' ? it.run.agentName : (groups.get(it.id)![0].groupLabel ?? 'Orchestration')
    const typeOf = (it: Item) => it.kind === 'single' ? typeLabel(it.run) : 'Orchestration'
    const statusOf = (it: Item) => it.kind === 'single' ? it.run.status : groupStatus(groups.get(it.id)!)
    const timeOf = (it: Item) => it.kind === 'single' ? new Date(it.run.startedAt).getTime() : Math.min(...groups.get(it.id)!.map((r) => new Date(r.startedAt).getTime()))
    const dir = sort.dir === 'asc' ? 1 : -1
    order.sort((a, b) => {
      if (sort.key === 'name') return nameOf(a).localeCompare(nameOf(b)) * dir
      if (sort.key === 'type') return typeOf(a).localeCompare(typeOf(b)) * dir
      if (sort.key === 'status') return statusOf(a).localeCompare(statusOf(b)) * dir
      return (timeOf(a) - timeOf(b)) * dir
    })
    return { order, groups }
  }, [runs, query, sort])
  const pageCount = Math.max(1, Math.ceil(order.length / PAGE_SIZE))
  const curPage = Math.min(page, pageCount - 1)

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
        <>
        <div className="act-toolbar">
          <input className="studio-input act-search" placeholder="Search activity (name, type, trigger…)" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {order.length === 0 && <div className="studio-empty">No activity matches “{query}”.</div>}
        {order.length > 0 && (
          <table className="act-table">
            <thead>
              <tr>
                <th className="act-th-chev" aria-hidden />
                <th><button type="button" className={`act-th${sort.key === 'name' ? ' active' : ''}`} onClick={() => toggleSort('name')}>Activity {sortArrow('name')}</button></th>
                <th><button type="button" className={`act-th${sort.key === 'type' ? ' active' : ''}`} onClick={() => toggleSort('type')}>Type {sortArrow('type')}</button></th>
                <th><button type="button" className={`act-th${sort.key === 'status' ? ' active' : ''}`} onClick={() => toggleSort('status')}>Status {sortArrow('status')}</button></th>
                <th><button type="button" className={`act-th${sort.key === 'created' ? ' active' : ''}`} onClick={() => toggleSort('created')}>Created {sortArrow('created')}</button></th>
              </tr>
            </thead>
            <tbody>
              {order.slice(curPage * PAGE_SIZE, (curPage + 1) * PAGE_SIZE).map((item) =>
                item.kind === 'single' ? renderRunRows(item.run) : renderGroupRows(item.id))}
            </tbody>
          </table>
        )}
        </>
      )}
      {!loading && pageCount > 1 && (
        <div className="act-pager">
          <button type="button" className="btn btn-ghost btn-xs" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}>← Prev</button>
          <span className="act-pager-info">Page {curPage + 1} of {pageCount}</span>
          <button type="button" className="btn btn-ghost btn-xs" disabled={curPage >= pageCount - 1} onClick={() => setPage(curPage + 1)}>Next →</button>
        </div>
      )}
    </main>
  )

  // A top-level run as two table rows: a clickable summary row + (when open) a
  // full-width detail row.
  function renderRunRows(r: AgentRun) {
    const st = STATUS[r.status]
    const isOpen = open === r.id
    return (
      <Fragment key={r.id}>
        <tr className={`act-trow${isOpen ? ' is-open' : ''}`} onClick={() => void toggle(r)}>
          <td className="act-td-chev">{isOpen ? '▾' : '▸'}</td>
          <td className="act-td-name">
            <span className={`act-dot act-dot--${st.cls}`} aria-hidden />
            <span className="act-tname">{r.agentName || 'Agent'}</span>
            {r.trigger === 'goal' && typeof r.triggerContext?.goalTitle === 'string' && (
              <Link className="act-goal-tag" to={`/app/${orgId}/goals`} onClick={(e) => e.stopPropagation()} title="Part of this goal">🎯 {r.triggerContext.goalTitle as string}</Link>
            )}
          </td>
          <td><span className="act-type">{typeLabel(r)}</span></td>
          <td><span className={`act-status act-status--${st.cls}`}>{st.label}</span></td>
          <td className="act-td-date" title={ago(r.startedAt)}>{fmtDateTime(r.startedAt)}{r.finishedAt ? ` · ${duration(r.startedAt, r.finishedAt)}` : ''}</td>
        </tr>
        {isOpen && (
          <tr className="act-detail-row">
            <td colSpan={5}>{renderDetail(r)}</td>
          </tr>
        )}
      </Fragment>
    )
  }

  // An orchestration group as a summary row + (when open) a detail row with the
  // per-agent traces and the team summary.
  function renderGroupRows(groupId: string) {
    const children = groups.get(groupId)!
    const gst = STATUS[groupStatus(children)]
    const label = children[0].groupLabel ?? 'Orchestration'
    const opened = openGroups.has(groupId)
    const started = children.reduce((m, r) => Math.min(m, new Date(r.startedAt).getTime()), Infinity)
    const okCount = children.filter((r) => r.status === 'succeeded').length
    return (
      <Fragment key={groupId}>
        <tr className={`act-trow act-grouprow${opened ? ' is-open' : ''}`} onClick={() => void toggleGroup(groupId, children)}>
          <td className="act-td-chev">{opened ? '▾' : '▸'}</td>
          <td className="act-td-name">
            <span className={`act-dot act-dot--${gst.cls}`} aria-hidden />
            <span className="act-tname">🎯 {label}</span>
            <span className="act-tsub">{children.length} agent{children.length === 1 ? '' : 's'}</span>
          </td>
          <td><span className="act-type">Orchestration</span></td>
          <td><span className={`act-status act-status--${gst.cls}`}>{okCount}/{children.length} ok</span></td>
          <td className="act-td-date">{fmtDateTime(new Date(started).toISOString())}</td>
        </tr>
        {opened && (
          <tr className="act-detail-row">
            <td colSpan={5}>
              <div className="act-group-body">
                <div className="act-children">{children.map((r) => renderRun(r, true))}</div>
                <div className="act-team">
                  <div className="act-result-head">🎯 What the team accomplished</div>
                  {children.map((r) => {
                    const dd = detail[r.id]
                    const text = dd?.result || dd?.events.find((e) => e.kind === 'output')?.message || ''
                    return (
                      <div key={r.id} className="act-team-item">
                        <div className="act-team-agent">{r.agentName}<span className={`act-team-status act-status--${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></div>
                        {dd?.loading
                          ? <div className="act-loading">Loading…</div>
                          : text
                            ? <div className="act-md act-team-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
                            : <div className="act-empty-line">No result recorded.</div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  // Nested child run (inside an expanded group) — rendered as a card.
  function renderRun(r: AgentRun, nested: boolean) {
    const st = STATUS[r.status]
    const rt = runType(r)
    return (
      <div className={`act-run${open === r.id ? ' is-open' : ''}${nested ? ' act-run--nested' : ''}`} key={r.id}>
        <button type="button" className="act-row" onClick={() => void toggle(r)}>
          <span className={`act-dot act-dot--${st.cls}`} aria-hidden />
          <span className="act-main">
            <span className="act-name">{r.agentName || 'Agent'}</span>
            <span className="act-meta">
              <span className="act-type">{typeLabel(r)}</span>
              <span className={`act-runtype${rt.recurring ? ' is-loop' : ''}`}>{rt.label}</span>
              <span title={ago(r.startedAt)}>{fmtDateTime(r.startedAt)}</span>
              {r.finishedAt && <span>· {duration(r.startedAt, r.finishedAt)}</span>}
            </span>
          </span>
          <span className={`act-status act-status--${st.cls}`}>{st.label}</span>
          <span className="act-chev" aria-hidden>{open === r.id ? '▾' : '▸'}</span>
        </button>
        {open === r.id && <div className="act-detail">{renderDetail(r)}</div>}
      </div>
    )
  }

  // The expandable detail (actions, reasoning, findings, result) for a run.
  function renderDetail(r: AgentRun) {
    const d = detail[r.id]
    const rt = runType(r)
    return (
      <>
            {d?.loading ? (
              <div className="act-loading">Loading trace…</div>
            ) : (() => {
              const events = d?.events ?? []
              const actions = events.filter((e) => e.kind === 'tool_call')
              const reasoning = events.filter((e) => e.kind === 'reasoning')
              const lifecycle = events.filter((e) => e.kind === 'step')
              const outputs = events.filter((e) => e.kind === 'output' || e.kind === 'tool_result')
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
                            <span className="act-event-msg">{linkify(e.message)}</span>
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
                            <span className="act-event-msg">{linkify(e.message)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* Findings / outputs the run produced (results feedback). */}
                  {outputs.length > 0 && (
                    <div className="act-section">
                      <div className="act-result-head">Findings &amp; outputs <span className="act-count">{outputs.length}</span></div>
                      <div className="act-trace">
                        {outputs.map((e) => (
                          <div key={e.id} className="act-event act-event--output">
                            <span className="act-event-ic">{e.icon ?? '📄'}</span>
                            <span className="act-event-msg act-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(e.message) }} />
                            <span className="act-event-time">{ago(e.createdAt)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {d?.result && (
                    <div className="act-result">
                      <div className="act-result-head">Result</div>
                      <pre className="act-result-body">{linkify(d.result)}</pre>
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
      </>
    )
  }
}

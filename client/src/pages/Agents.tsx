import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  listAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  stopAgent,
  suggestAgentTeam,
  createAgentsBulk,
  runAgentStream,
  type Agent,
  type ProposedAgent,
} from '../lib/api'
import { startActivity, updateActivity, endActivity } from '../lib/agentActivity'
import { AGENT_TOOLS, AGENT_DEFAULT_TOOLS } from '../lib/agentTools'
import ExternalAgents from '../components/agents/ExternalAgents'
import Orchestrator from '../components/agents/Orchestrator'
import Skills from '../components/agents/Skills'
import '../components/studio/studio.css'
import './agents.css'

const MODELS = [
  { id: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6 (Recommended)' },
  { id: 'claude-opus-4-8',            label: 'Claude Opus 4.8 (Most capable)' },
  { id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5 (Fastest)' },
  { id: 'gpt-4o',                     label: 'GPT-4o' },
  { id: 'gpt-4o-mini',               label: 'GPT-4o mini' },
]

const SCHEDULES = [
  { value: '',              label: 'Manual only (no schedule)' },
  { value: '0 * * * *',    label: 'Every hour' },
  { value: '0 9 * * *',    label: 'Daily at 9 AM' },
  { value: '0 9 * * 1',    label: 'Weekly (Mon 9 AM)' },
  { value: '0 9 1 * *',    label: 'Monthly (1st at 9 AM)' },
  { value: 'custom',        label: 'Custom cron…' },
]

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function modelLabel(id: string) {
  return MODELS.find((m) => m.id === id)?.label.split(' (')[0] ?? id
}

type EditDraft = {
  name: string
  description: string
  model: string
  systemPrompt: string
  schedule: string
  customCron: string
  tools: string[]
}

const BLANK: EditDraft = {
  name: '',
  description: '',
  model: 'claude-sonnet-4-6',
  systemPrompt: '',
  schedule: '',
  customCron: '',
  tools: [...AGENT_DEFAULT_TOOLS],
}

export default function Agents() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()

  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // modal state
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Agent | null>(null) // null = create
  const [draft, setDraft] = useState<EditDraft>(BLANK)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  // Abort controllers for in-flight agent runs, so we can stop them.
  const runCtrls = useRef<Record<string, AbortController>>({})

  // AI team generator
  const [showGenerate, setShowGenerate] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      setAgents(await listAgents(t, orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agents.')
    } finally {
      setLoading(false)
    }
  }, [getAccessToken, orgId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  // Quietly refresh so "running" badges reflect runs triggered elsewhere (e.g.
  // the chat "spin up & run agents" flow). No spinner, no error clobbering.
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const t = await getAccessToken()
        if (!t || !alive) return
        const list = await listAgents(t, orgId)
        if (alive) setAgents(list)
      } catch { /* ignore transient poll errors */ }
    }
    const id = setInterval(() => { void tick() }, 5000)
    return () => { alive = false; clearInterval(id) }
  }, [getAccessToken, orgId])

  function openCreate() {
    setEditing(null)
    setDraft(BLANK)
    setFormError(null)
    setShowModal(true)
    setTimeout(() => nameRef.current?.focus(), 50)
  }

  function openEdit(a: Agent) {
    const sched = SCHEDULES.find((s) => s.value === (a.schedule ?? ''))
      ? (a.schedule ?? '')
      : 'custom'
    setEditing(a)
    setDraft({
      name: a.name,
      description: a.description,
      model: a.model,
      systemPrompt: a.systemPrompt,
      schedule: sched,
      customCron: sched === 'custom' ? (a.schedule ?? '') : '',
      tools: a.tools ?? [...AGENT_DEFAULT_TOOLS],
    })
    setFormError(null)
    setShowModal(true)
    setTimeout(() => nameRef.current?.focus(), 50)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!draft.name.trim()) { setFormError('Give your agent a name.'); return }
    const cronValue = draft.schedule === 'custom' ? draft.customCron.trim() : draft.schedule
    setSaving(true)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const body = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        model: draft.model,
        systemPrompt: draft.systemPrompt,
        schedule: cronValue || null,
        tools: draft.tools,
      }
      if (editing) {
        const updated = await updateAgent(t, orgId, editing.id, body)
        setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
      } else {
        const created = await createAgent(t, orgId, body)
        setAgents((prev) => [created, ...prev])
      }
      setShowModal(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(a: Agent) {
    setBusyId(a.id)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      await deleteAgent(t, orgId, a.id)
      setAgents((prev) => prev.filter((x) => x.id !== a.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setBusyId(null)
    }
  }

  async function run(a: Agent) {
    if (a.status === 'running') return
    // Optimistic running state + a global activity toast that streams the
    // agent's live thoughts and tool actions as it works.
    setAgents((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: 'running' } : x)))
    const actId = `agent-${a.id}`
    startActivity(actId, a.name, { icon: '▶️', text: 'Starting…' })
    const ctrl = new AbortController()
    runCtrls.current[a.id] = ctrl
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      let done = false
      for await (const ev of runAgentStream(t, orgId, a.id, ctrl.signal)) {
        if (ev.type === 'step') {
          updateActivity(actId, { icon: ev.icon, text: ev.text })
        } else if (ev.type === 'done') {
          done = true
          setAgents((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: 'idle', lastRunAt: new Date().toISOString(), lastRunStatus: 'ok' } : x)))
          endActivity(actId, 'Finished')
        } else if (ev.type === 'error') {
          done = true
          setAgents((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: 'idle', lastRunStatus: 'error' } : x)))
          setError(ev.error)
          endActivity(actId, 'Failed', '✗')
        }
      }
      if (!done) {
        setAgents((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: 'idle' } : x)))
        endActivity(actId, 'Finished')
      }
    } catch (err) {
      // A user-initiated stop aborts the stream — treat it as stopped, not error.
      if (ctrl.signal.aborted) {
        setAgents((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: 'idle' } : x)))
        endActivity(actId, 'Stopped', '■')
      } else {
        setAgents((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: 'idle', lastRunStatus: 'error' } : x)))
        setError(err instanceof Error ? err.message : 'Agent run failed.')
        endActivity(actId, 'Failed', '✗')
      }
    } finally {
      delete runCtrls.current[a.id]
    }
  }

  // Stop a running agent. Abort the local stream AND tell the server to cancel
  // the run (which forces status idle), so it can't reappear as running on poll.
  async function stop(a: Agent) {
    runCtrls.current[a.id]?.abort()
    endActivity(`agent-${a.id}`, 'Stopped', '■')
    setAgents((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: 'idle' } : x)))
    try {
      const t = await getAccessToken()
      if (t) await stopAgent(t, orgId, a.id)
    } catch { /* best-effort — local state already idle */ }
  }

  function set(patch: Partial<EditDraft>) {
    setDraft((d) => ({ ...d, ...patch }))
  }

  function toggleTool(name: string) {
    setDraft((d) => ({
      ...d,
      tools: d.tools.includes(name) ? d.tools.filter((t) => t !== name) : [...d.tools, name],
    }))
  }

  return (
    <main className="wrap studio">
      <header className="studio-head">
        <div>
          <h1><span className="grad-text">Agents</span></h1>
          <p className="studio-lead">
            Create named AI agents with their own system prompt, model, and optional schedule.
            Attach an agent to any Block or report to control how it generates content.
          </p>
        </div>
        <div className="agents-head-actions">
          <button type="button" className="btn btn-secondary agents-generate-btn" onClick={() => setShowGenerate(true)}>
            ✨ Generate AI team
          </button>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            + New agent
          </button>
        </div>
      </header>

      {error && <div className="studio-error">{error}</div>}

      <Orchestrator />

      {loading ? (
        <div className="studio-empty">Loading agents…</div>
      ) : (
        <div className="studio-grid">
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              busy={busyId === a.id}
              orgId={orgId}
              onEdit={() => openEdit(a)}
              onDelete={() => void remove(a)}
              onRun={() => void run(a)}
              onStop={() => void stop(a)}
            />
          ))}
          <button type="button" className="studio-card studio-card-new" onClick={openCreate}>
            <span className="plus">+</span>
            New agent
          </button>
        </div>
      )}

      <Skills />

      <ExternalAgents orgId={orgId} getToken={async () => {
        const t = await getAccessToken()
        if (!t) throw new Error('Session expired — please sign in again.')
        return t
      }} />

      {showModal && (
        <div className="studio-modal-backdrop" onClick={() => !saving && setShowModal(false)}>
          <form className="studio-modal agents-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
            <h2>{editing ? 'Edit agent' : 'New agent'}</h2>

            <label className="studio-field">
              <span>Name</span>
              <input
                ref={nameRef}
                className="studio-input"
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Sales Analyst"
              />
            </label>

            <label className="studio-field">
              <span>Description <span className="agents-optional">(optional)</span></span>
              <input
                className="studio-input"
                value={draft.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="What this agent does"
              />
            </label>

            <label className="studio-field">
              <span>Model</span>
              <select className="studio-select" value={draft.model} onChange={(e) => set({ model: e.target.value })}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>

            <label className="studio-field">
              <span>System prompt</span>
              <textarea
                className="studio-input agents-prompt"
                value={draft.systemPrompt}
                onChange={(e) => set({ systemPrompt: e.target.value })}
                placeholder="You are a data analyst specialising in… Always respond with…"
                rows={6}
              />
            </label>

            <div className="studio-field">
              <span>Tools <span className="agents-optional">(what this agent can do)</span></span>
              <div className="agents-tools">
                {AGENT_TOOLS.map((t) => {
                  const on = draft.tools.includes(t.name)
                  return (
                    <button
                      type="button"
                      key={t.name}
                      className={`agents-tool${on ? ' is-on' : ''}`}
                      onClick={() => toggleTool(t.name)}
                      title={t.description}
                      aria-pressed={on}
                    >
                      <span className="agents-tool-ic">{t.icon}</span>
                      <span className="agents-tool-text">
                        <span className="agents-tool-name">{t.label}</span>
                        <span className="agents-tool-desc">{t.description}</span>
                      </span>
                      <span className="agents-tool-check">{on ? '✓' : ''}</span>
                    </button>
                  )
                })}
              </div>
              <span className="agents-cron-hint">
                The agent can only call the tools you enable here. Memory recall &amp; workspace context are always available.
              </span>
            </div>

            <label className="studio-field">
              <span>Schedule <span className="agents-optional">(optional)</span></span>
              <select
                className="studio-select"
                value={draft.schedule}
                onChange={(e) => set({ schedule: e.target.value })}
              >
                {SCHEDULES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>

            {draft.schedule === 'custom' && (
              <label className="studio-field">
                <span>Cron expression</span>
                <input
                  className="studio-input"
                  value={draft.customCron}
                  onChange={(e) => set({ customCron: e.target.value })}
                  placeholder="0 9 * * 1-5"
                  spellCheck={false}
                />
                <span className="agents-cron-hint">
                  min hour day month weekday — e.g. <code>0 9 * * 1-5</code> = weekdays at 9 AM
                </span>
              </label>
            )}

            {formError && <div className="studio-error">{formError}</div>}

            <div className="studio-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving || !draft.name.trim()}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create agent'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showGenerate && (
        <GenerateTeamModal
          orgId={orgId}
          getAccessToken={getAccessToken}
          onClose={() => setShowGenerate(false)}
          onCreated={(created) => {
            setAgents((prev) => [...created, ...prev])
            setShowGenerate(false)
          }}
        />
      )}
    </main>
  )
}

// ---------------------------------------------------------------------------
// Generate AI team — website → extrapolated business → proposed team → create
// ---------------------------------------------------------------------------

type GenStep = 'input' | 'analyzing' | 'review'

function GenerateTeamModal({
  orgId, getAccessToken, onClose, onCreated,
}: {
  orgId: string
  getAccessToken: () => Promise<string | null>
  onClose: () => void
  onCreated: (created: Agent[]) => void
}) {
  const [step, setStep] = useState<GenStep>('input')
  const [url, setUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [summary, setSummary] = useState('')
  const [usedAI, setUsedAI] = useState(true)
  const [proposed, setProposed] = useState<ProposedAgent[]>([])
  const [selected, setSelected] = useState<boolean[]>([])
  const [creating, setCreating] = useState(false)

  async function analyze(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!url.trim()) { setError('Enter your website URL.'); return }
    setStep('analyzing')
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const res = await suggestAgentTeam(t, orgId, { url: url.trim(), notes: notes.trim() })
      setSummary(res.businessSummary)
      setUsedAI(res.usedAI)
      setProposed(res.agents)
      setSelected(res.agents.map(() => true))
      setStep('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not analyze that site.')
      setStep('input')
    }
  }

  function patchAgent(i: number, patch: Partial<ProposedAgent>) {
    setProposed((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  }

  async function create() {
    const chosen = proposed.filter((_, i) => selected[i])
    if (chosen.length === 0) { setError('Select at least one agent to create.'); return }
    setCreating(true)
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const created = await createAgentsBulk(t, orgId, chosen)
      onCreated(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agents.')
      setCreating(false)
    }
  }

  const selectedCount = selected.filter(Boolean).length

  return (
    <div className="studio-modal-backdrop" onClick={() => !creating && step !== 'analyzing' && onClose()}>
      <div
        className="studio-modal agents-gen-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>✨ Generate an AI team</h2>

        {step === 'input' && (
          <form onSubmit={analyze}>
            <p className="agents-gen-lead">
              Paste your website and we’ll read it, figure out what your business does, and
              propose a team of AI agents tailored to you. You can edit everything before creating.
            </p>
            <label className="studio-field">
              <span>Website URL</span>
              <input
                className="studio-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="acme.com"
                autoFocus
                spellCheck={false}
              />
            </label>
            <label className="studio-field">
              <span>Anything else? <span className="agents-optional">(optional)</span></span>
              <textarea
                className="studio-input agents-prompt"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. We care most about churn and weekly revenue reporting. Our data lives in Postgres + Stripe."
                rows={3}
              />
            </label>
            {error && <div className="studio-error">{error}</div>}
            <div className="studio-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={!url.trim()}>
                Analyze my site →
              </button>
            </div>
          </form>
        )}

        {step === 'analyzing' && (
          <div className="agents-gen-analyzing">
            <div className="dl-spinner" />
            <p>Reading <strong>{url.trim()}</strong> and designing your team…</p>
            <span className="agents-optional">This can take a few seconds.</span>
          </div>
        )}

        {step === 'review' && (
          <div className="agents-gen-review">
            <div className={`agents-gen-summary${usedAI ? '' : ' is-template'}`}>
              <span className="agents-gen-summary-label">{usedAI ? 'What we understood' : 'Heads up'}</span>
              <p>{summary}</p>
            </div>

            <div className="agents-gen-list">
              {proposed.map((a, i) => (
                <div key={i} className={`agents-gen-card${selected[i] ? ' is-selected' : ''}`}>
                  <label className="agents-gen-card-head">
                    <input
                      type="checkbox"
                      checked={selected[i]}
                      onChange={(e) => setSelected((prev) => prev.map((v, idx) => (idx === i ? e.target.checked : v)))}
                    />
                    <input
                      className="agents-gen-name"
                      value={a.name}
                      onChange={(e) => patchAgent(i, { name: e.target.value })}
                    />
                    <select
                      className="agents-gen-model"
                      value={a.model}
                      onChange={(e) => patchAgent(i, { model: e.target.value })}
                    >
                      {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label.split(' (')[0]}</option>)}
                    </select>
                  </label>
                  <input
                    className="agents-gen-desc"
                    value={a.description}
                    onChange={(e) => patchAgent(i, { description: e.target.value })}
                    placeholder="What this agent does"
                  />
                  <details className="agents-gen-prompt-wrap">
                    <summary>System prompt</summary>
                    <textarea
                      className="studio-input agents-prompt"
                      value={a.systemPrompt}
                      onChange={(e) => patchAgent(i, { systemPrompt: e.target.value })}
                      rows={5}
                    />
                  </details>
                  <div className="agents-gen-card-foot">
                    <select
                      className="agents-gen-sched"
                      value={a.schedule ?? ''}
                      onChange={(e) => patchAgent(i, { schedule: e.target.value || null })}
                    >
                      {SCHEDULES.filter((s) => s.value !== 'custom').map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            {error && <div className="studio-error">{error}</div>}
            <div className="studio-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep('input')} disabled={creating}>
                ← Back
              </button>
              <button type="button" className="btn btn-primary" onClick={create} disabled={creating || selectedCount === 0}>
                {creating ? 'Creating…' : `Create ${selectedCount} agent${selectedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AgentCard({ agent, busy, orgId, onEdit, onDelete, onRun, onStop }: {
  agent: Agent
  busy: boolean
  orgId: string
  onEdit: () => void
  onDelete: () => void
  onRun: () => void
  onStop: () => void
}) {
  const running = agent.status === 'running'
  return (
    <div className={`studio-card agent-card${running ? ' agent-card--running' : ''}`} style={{ position: 'relative' }}>
      <button
        type="button"
        className={`agent-run-btn has-del${running ? ' agent-stop-btn' : ''}`}
        title={running ? 'Stop agent' : 'Run agent now'}
        onClick={(e) => { e.stopPropagation(); running ? onStop() : onRun() }}
      >
        {running ? '■' : '▶'}
      </button>
      <button
        type="button"
        className="sc-delete-btn agent-del-btn"
        disabled={busy}
        title="Delete agent"
        onClick={(e) => { e.stopPropagation(); onDelete() }}
      >
        ✕
      </button>
      <div className="studio-card-link agent-card-body" onClick={onEdit} style={{ cursor: 'pointer' }}>
        <h3>
          <span className={`agent-state-dot${running ? ' is-running' : ' is-idle'}`} aria-hidden />
          {agent.name}
        </h3>
        {agent.description && <p className="agent-card-desc">{agent.description}</p>}
        <div className="studio-card-meta" style={{ marginTop: 'auto' }}>
          <span className={`studio-pill ${running ? 'agent-pill-running' : 'agent-pill-idle'}`}>
            {running ? '● Running' : '○ Idle'}
          </span>
          <span className="studio-pill studio-pill-org">{modelLabel(agent.model)}</span>
          {agent.schedule && <span className="studio-pill studio-pill-private">⏱ Scheduled</span>}
        </div>
        <div className="agent-card-foot">
          <span>Updated {fmtDate(agent.updatedAt)}</span>
          {agent.lastRunAt && (
            <span>Last run {fmtDate(agent.lastRunAt)}{agent.lastRunStatus === 'error' ? ' · failed' : ''}</span>
          )}
          <Link
            className="agent-history-link"
            to={`/app/${orgId}/activity?agent=${agent.id}`}
            onClick={(e) => e.stopPropagation()}
          >
            View runs ↗
          </Link>
        </div>
      </div>
    </div>
  )
}

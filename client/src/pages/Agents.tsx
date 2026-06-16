import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  listAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  type Agent,
} from '../lib/api'
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
}

const BLANK: EditDraft = {
  name: '',
  description: '',
  model: 'claude-sonnet-4-6',
  systemPrompt: '',
  schedule: '',
  customCron: '',
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

  function set(patch: Partial<EditDraft>) {
    setDraft((d) => ({ ...d, ...patch }))
  }

  return (
    <main className="wrap studio">
      <header className="studio-head">
        <div>
          <h1><span className="grad-text">Agents</span></h1>
          <p className="studio-lead">
            Create named AI agents with their own system prompt, model, and optional schedule.
            Attach an agent to any widget or report to control how it generates content.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          + New agent
        </button>
      </header>

      {error && <div className="studio-error">{error}</div>}

      {loading ? (
        <div className="studio-empty">Loading agents…</div>
      ) : (
        <div className="studio-grid">
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              busy={busyId === a.id}
              onEdit={() => openEdit(a)}
              onDelete={() => void remove(a)}
            />
          ))}
          <button type="button" className="studio-card studio-card-new" onClick={openCreate}>
            <span className="plus">+</span>
            New agent
          </button>
        </div>
      )}

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
    </main>
  )
}

function AgentCard({ agent, busy, onEdit, onDelete }: {
  agent: Agent
  busy: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="studio-card agent-card" style={{ position: 'relative' }}>
      {agent.isOwner && (
        <button
          type="button"
          className="sc-delete-btn"
          disabled={busy}
          title="Delete agent"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
        >
          ✕
        </button>
      )}
      <div className="studio-card-link agent-card-body" onClick={onEdit} style={{ cursor: 'pointer' }}>
        <h3>{agent.name}</h3>
        {agent.description && <p className="agent-card-desc">{agent.description}</p>}
        <div className="studio-card-meta" style={{ marginTop: 'auto' }}>
          <span className="studio-pill studio-pill-org">{modelLabel(agent.model)}</span>
          {agent.schedule && <span className="studio-pill studio-pill-private">⏱ Scheduled</span>}
        </div>
        <div className="agent-card-foot">
          <span>Updated {fmtDate(agent.updatedAt)}</span>
          {agent.lastRunAt && <span>Last run {fmtDate(agent.lastRunAt)}</span>}
        </div>
      </div>
    </div>
  )
}

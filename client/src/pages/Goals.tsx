// Goals — define a business objective, let AI draft a plan + agent team, then
// edit and track it. Each goal shows its ordered plan and the agents that
// deliver it. CRUD lives in routes/goals.ts; drafting uses the org's AI key.

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  listGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  draftGoal,
  runGoalStream,
  type Goal,
  type GoalAgent,
} from '../lib/api'
import SuggestGoalsModal from '../components/goals/SuggestGoalsModal'
import { startActivity, updateActivity, endActivity } from '../lib/agentActivity'
import './goals.css'

interface Draft {
  title: string
  plan: string[]
  agents: GoalAgent[]
  status: Goal['status']
}
const BLANK: Draft = { title: '', plan: [], agents: [], status: 'active' }

const STATUS_LABEL: Record<Goal['status'], string> = { active: 'Active', done: 'Done', archived: 'Archived' }

export default function Goals() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()

  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // create / edit modal
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [saving, setSaving] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [showSuggest, setShowSuggest] = useState(false)
  const [runningGoal, setRunningGoal] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      setGoals(await listGoals(t, orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load goals.')
    } finally {
      setLoading(false)
    }
  }, [getAccessToken, orgId])

  useEffect(() => { setLoading(true); void load() }, [load])

  function openNew() {
    setEditing(null)
    setDraft(BLANK)
    setFormError(null)
    setShowModal(true)
  }
  function openEdit(g: Goal) {
    setEditing(g)
    setDraft({ title: g.title, plan: [...g.plan], agents: g.agents.map((a) => ({ ...a })), status: g.status })
    setFormError(null)
    setShowModal(true)
  }

  async function draftFor(title: string) {
    const clean = title.trim()
    if (!clean || drafting) return
    setDrafting(true)
    setFormError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const { plan, agents } = await draftGoal(t, orgId, clean)
      setDraft((d) => ({ ...d, plan, agents }))
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Drafting failed.')
    } finally {
      setDrafting(false)
    }
  }
  const runDraft = () => void draftFor(draft.title)

  // From the "✨ Generate" popup: open the editor pre-filled and auto-draft.
  async function useSuggestion(title: string) {
    setEditing(null)
    setDraft({ title, plan: [], agents: [], status: 'active' })
    setFormError(null)
    setShowModal(true)
    await draftFor(title)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.title.trim() || saving) return
    setSaving(true)
    setFormError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const body = {
        title: draft.title.trim(),
        plan: draft.plan.map((s) => s.trim()).filter(Boolean),
        agents: draft.agents.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), role: a.role.trim() })),
        status: draft.status,
      }
      if (editing) {
        const updated = await updateGoal(t, orgId, editing.id, body)
        setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)))
      } else {
        const created = await createGoal(t, orgId, body)
        setGoals((prev) => [created, ...prev])
      }
      setShowModal(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function setStatus(g: Goal, status: Goal['status']) {
    setBusyId(g.id)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const updated = await updateGoal(t, orgId, g.id, { status })
      setGoals((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed.')
    } finally {
      setBusyId(null)
    }
  }

  // Spin up & run the goal's agents, streaming live thoughts to the toast.
  async function runGoal(g: Goal) {
    if (runningGoal) return
    if (g.agents.length === 0) { setError(`"${g.title}" has no agents yet — edit it (or ✨ Draft) to add some.`); return }
    setRunningGoal(g.id)
    const actId = `goal-${g.id}`
    startActivity(actId, g.title, { icon: '🎯', text: 'Orchestrating…' })
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      let done = false
      for await (const ev of runGoalStream(t, orgId, g.id)) {
        if (ev.type === 'step') {
          updateActivity(actId, { icon: ev.icon, text: ev.text })
        } else if (ev.type === 'done') {
          done = true
          const ok = ev.results.filter((r) => r.ok).length
          endActivity(actId, `Ran ${ok}/${ev.results.length} agent${ev.results.length === 1 ? '' : 's'}`)
        } else if (ev.type === 'error') {
          done = true
          setError(ev.error)
          endActivity(actId, 'Failed', '✗')
        }
      }
      if (!done) endActivity(actId, 'Done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Goal run failed.')
      endActivity(actId, 'Failed', '✗')
    } finally {
      setRunningGoal(null)
    }
  }

  async function remove(g: Goal) {
    if (!confirm(`Delete the goal "${g.title}"? This cannot be undone.`)) return
    setBusyId(g.id)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      await deleteGoal(t, orgId, g.id)
      setGoals((prev) => prev.filter((x) => x.id !== g.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.')
    } finally {
      setBusyId(null)
    }
  }

  // ---- draft editing helpers ----
  const setStep = (i: number, v: string) => setDraft((d) => ({ ...d, plan: d.plan.map((s, j) => (j === i ? v : s)) }))
  const addStep = () => setDraft((d) => ({ ...d, plan: [...d.plan, ''] }))
  const removeStep = (i: number) => setDraft((d) => ({ ...d, plan: d.plan.filter((_, j) => j !== i) }))
  const setAgent = (i: number, patch: Partial<GoalAgent>) =>
    setDraft((d) => ({ ...d, agents: d.agents.map((a, j) => (j === i ? { ...a, ...patch } : a)) }))
  const addAgent = () => setDraft((d) => ({ ...d, agents: [...d.agents, { name: '', role: '' }] }))
  const removeAgent = (i: number) => setDraft((d) => ({ ...d, agents: d.agents.filter((_, j) => j !== i) }))

  return (
    <main className="wrap goals">
      <header className="goals-head">
        <div>
          <h1><span className="grad-text">Goals</span></h1>
          <p className="goals-lead">
            Set a business objective and let DeepLogic draft the plan and the agent team to deliver it.
          </p>
        </div>
        <div className="goals-head-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setShowSuggest(true)}>✨ Generate</button>
          <button type="button" className="btn btn-primary" onClick={openNew}>+ New goal</button>
        </div>
      </header>

      {error && <div className="goals-error">{error}</div>}

      {loading ? (
        <div className="goals-empty">Loading goals…</div>
      ) : goals.length === 0 ? (
        <div className="goals-empty">
          No goals yet. <button type="button" className="goals-linkbtn" onClick={openNew}>Set your first goal</button> —
          e.g. “Increase sales visibility” — and we’ll draft the plan and agents.
        </div>
      ) : (
        <div className="goals-grid">
          {goals.map((g) => (
            <article className={`goal-card status-${g.status}`} key={g.id}>
              <div className="goal-card-top">
                <h2 className="goal-title">🎯 {g.title}</h2>
                <span className={`goal-status goal-status-${g.status}`}>{STATUS_LABEL[g.status]}</span>
              </div>

              {g.plan.length > 0 && (
                <div className="goal-sec">
                  <h3>Plan</h3>
                  <ol className="goal-plan">
                    {g.plan.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                </div>
              )}

              {g.agents.length > 0 && (
                <div className="goal-sec">
                  <h3>Agents</h3>
                  <ul className="goal-agents">
                    {g.agents.map((a, i) => (
                      <li key={i} className="goal-agent" title={a.role}>
                        <span className="goal-agent-name">{a.name}</span>
                        {a.role && <span className="goal-agent-role">{a.role}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="goal-card-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-xs goal-run-btn"
                  disabled={runningGoal === g.id || g.agents.length === 0}
                  title={g.agents.length === 0 ? 'Add agents to this goal first' : 'Spin up & run this goal’s agents'}
                  onClick={() => void runGoal(g)}
                >
                  {runningGoal === g.id ? '⏳ Running…' : '▶ Run'}
                </button>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => openEdit(g)}>Edit</button>
                {g.status !== 'done' ? (
                  <button type="button" className="btn btn-ghost btn-xs" disabled={busyId === g.id} onClick={() => void setStatus(g, 'done')}>Mark done</button>
                ) : (
                  <button type="button" className="btn btn-ghost btn-xs" disabled={busyId === g.id} onClick={() => void setStatus(g, 'active')}>Reopen</button>
                )}
                <button type="button" className="goal-del" title="Delete goal" disabled={busyId === g.id} onClick={() => void remove(g)}>✕</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {showSuggest && (
        <SuggestGoalsModal orgId={orgId} onPick={useSuggestion} onClose={() => setShowSuggest(false)} />
      )}

      {showModal && (
        <div className="goals-modal-backdrop" onClick={() => !saving && !drafting && setShowModal(false)}>
          <form className="goals-modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <h2>{editing ? 'Edit goal' : 'New goal'}</h2>

            <label className="goals-field">
              <span>Goal</span>
              <div className="goals-title-row">
                <input
                  className="goals-input"
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="Increase sales visibility"
                  autoFocus
                />
                <button type="button" className="btn btn-ghost" disabled={!draft.title.trim() || drafting} onClick={() => void runDraft()}>
                  {drafting ? 'Drafting…' : '✨ Draft with AI'}
                </button>
              </div>
            </label>

            <div className="goals-field">
              <span className="goals-field-head">
                Plan
                <button type="button" className="goals-add" onClick={addStep}>+ Add step</button>
              </span>
              {draft.plan.length === 0 && <p className="goals-hint">No steps yet — add one, or draft with AI.</p>}
              <ol className="goals-steps">
                {draft.plan.map((s, i) => (
                  <li key={i}>
                    <input
                      className="goals-input"
                      value={s}
                      onChange={(e) => setStep(i, e.target.value)}
                      placeholder={`Step ${i + 1}`}
                    />
                    <button type="button" className="goals-row-del" title="Remove step" onClick={() => removeStep(i)}>✕</button>
                  </li>
                ))}
              </ol>
            </div>

            <div className="goals-field">
              <span className="goals-field-head">
                Agents
                <button type="button" className="goals-add" onClick={addAgent}>+ Add agent</button>
              </span>
              {draft.agents.length === 0 && <p className="goals-hint">No agents yet — add one, or draft with AI.</p>}
              <ul className="goals-agentrows">
                {draft.agents.map((a, i) => (
                  <li key={i}>
                    <input
                      className="goals-input goals-input-name"
                      value={a.name}
                      onChange={(e) => setAgent(i, { name: e.target.value })}
                      placeholder="KPI discovery agent"
                    />
                    <input
                      className="goals-input"
                      value={a.role}
                      onChange={(e) => setAgent(i, { role: e.target.value })}
                      placeholder="What this agent does"
                    />
                    <button type="button" className="goals-row-del" title="Remove agent" onClick={() => removeAgent(i)}>✕</button>
                  </li>
                ))}
              </ul>
            </div>

            {formError && <div className="goals-form-error">{formError}</div>}

            <div className="goals-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)} disabled={saving || drafting}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !draft.title.trim()}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create goal'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}

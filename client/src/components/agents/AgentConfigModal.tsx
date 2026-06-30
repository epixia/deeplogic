// AgentConfigModal — reconfigure a deployed agent: mission, budget caps,
// cadence and guardrails. Saves via PATCH /external-agents/:id.

import { useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { updateExternalAgent, type ExternalAgent, type AgentSettings } from '../../lib/api'
import './agent-config.css'

const CADENCES: { id: NonNullable<AgentSettings['cadence']>; label: string }[] = [
  { id: 'once', label: 'Once' }, { id: 'hourly', label: 'Hourly' },
  { id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' },
]

const numOrEmpty = (n?: number) => (n && n > 0 ? String(n) : '')

export default function AgentConfigModal({ orgId, agent, onClose, onSaved }: {
  orgId: string
  agent: ExternalAgent
  onClose: () => void
  onSaved: (a: ExternalAgent) => void
}) {
  const { getAccessToken } = useAuth()
  const s = agent.settings ?? {}
  const [mission, setMission] = useState(agent.mission ?? '')
  const [reason, setReason] = useState(agent.reason ?? '')
  const [maxRuntimeMin, setRuntime] = useState(numOrEmpty(s.budget?.maxRuntimeMin))
  const [maxSteps, setSteps] = useState(numOrEmpty(s.budget?.maxSteps))
  const [maxSpendUsd, setSpend] = useState(numOrEmpty(s.budget?.maxSpendUsd))
  const [cadence, setCadence] = useState<AgentSettings['cadence']>(s.cadence ?? 'once')
  const [requireApproval, setRequireApproval] = useState(!!s.guardrails?.requireApproval)
  const [readOnly, setReadOnly] = useState(!!s.guardrails?.readOnly)
  const [allowedDomains, setAllowedDomains] = useState((s.guardrails?.allowedDomains ?? []).join(', '))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (saving) return
    setSaving(true); setError(null)
    try {
      const t = await getAccessToken(); if (!t) throw new Error('Session expired')
      const settings: AgentSettings = {
        budget: {
          maxRuntimeMin: Number(maxRuntimeMin) || undefined,
          maxSteps: Number(maxSteps) || undefined,
          maxSpendUsd: Number(maxSpendUsd) || undefined,
        },
        cadence,
        guardrails: {
          requireApproval, readOnly,
          allowedDomains: allowedDomains.split(',').map((d) => d.trim()).filter(Boolean),
        },
      }
      const updated = await updateExternalAgent(t, orgId, agent.id, { mission: mission.trim(), reason: reason.trim(), settings })
      onSaved(updated)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally { setSaving(false) }
  }

  return (
    <div className="acfg-backdrop" onClick={() => !saving && onClose()}>
      <div className="acfg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="acfg-head">
          <h2>⚙ Configure <span className="acfg-name">{agent.name}</span></h2>
          <button className="acfg-close" onClick={onClose} disabled={saving}>✕</button>
        </div>

        <div className="acfg-body">
          <label className="acfg-field">
            <span>Mission</span>
            <textarea value={mission} onChange={(e) => setMission(e.target.value)} rows={3} placeholder="What should this agent accomplish?" />
          </label>
          <label className="acfg-field">
            <span>Why <em>(reason)</em></span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this agent is running" />
          </label>

          <div className="acfg-sec">💰 Budget caps <em>— the agent is told to stop when it hits any cap</em></div>
          <div className="acfg-row3">
            <label className="acfg-field"><span>Max runtime (min)</span>
              <input type="number" min={1} value={maxRuntimeMin} onChange={(e) => setRuntime(e.target.value)} placeholder="∞" />
            </label>
            <label className="acfg-field"><span>Max steps</span>
              <input type="number" min={1} value={maxSteps} onChange={(e) => setSteps(e.target.value)} placeholder="∞" />
            </label>
            <label className="acfg-field"><span>Max spend (USD)</span>
              <input type="number" min={1} value={maxSpendUsd} onChange={(e) => setSpend(e.target.value)} placeholder="∞" />
            </label>
          </div>

          <div className="acfg-sec">🔁 Cadence</div>
          <div className="acfg-seg">
            {CADENCES.map((c) => (
              <button key={c.id} type="button" className={`acfg-seg-btn${cadence === c.id ? ' active' : ''}`} onClick={() => setCadence(c.id)}>{c.label}</button>
            ))}
          </div>

          <div className="acfg-sec">🛡 Guardrails</div>
          <label className="acfg-check"><input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} /> Require approval before sending outbound messages</label>
          <label className="acfg-check"><input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only — research &amp; report only (no outbound actions)</label>
          <label className="acfg-field"><span>Allowed domains <em>(comma-separated; blank = no restriction)</em></span>
            <input value={allowedDomains} onChange={(e) => setAllowedDomains(e.target.value)} placeholder="example.com, linkedin.com" />
          </label>
        </div>

        {error && <div className="acfg-error">{error}</div>}
        <div className="acfg-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save configuration'}</button>
        </div>
      </div>
    </div>
  )
}

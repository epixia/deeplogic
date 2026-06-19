// SuggestGoalsModal — "✨ Generate" popup for the Goals page. On open it asks
// the server for valuable goals grounded in the org's Data Vault. Picking one
// hands its title back so the goal can be drafted & created.

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { suggestGoals, type GoalSuggestion } from '../../lib/api'
import './suggest-goals-modal.css'

export default function SuggestGoalsModal({
  orgId,
  onPick,
  onClose,
}: {
  orgId: string
  onPick: (title: string) => void | Promise<void>
  onClose: () => void
}) {
  const { getAccessToken } = useAuth()
  const [goals, setGoals] = useState<GoalSuggestion[]>([])
  const [usedAI, setUsedAI] = useState(true)
  const [inventoryCount, setInventoryCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyIdx, setBusyIdx] = useState<number | null>(null)
  const ranRef = useRef(false)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired — please sign in again.')
      const res = await suggestGoals(t, orgId)
      setGoals(res.goals)
      setUsedAI(res.usedAI)
      setInventoryCount(res.inventoryCount)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to suggest goals.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function pick(g: GoalSuggestion, i: number) {
    if (busyIdx !== null) return
    setBusyIdx(i)
    try {
      await onPick(g.title)
      onClose()
    } finally {
      setBusyIdx(null)
    }
  }

  return (
    <div className="sg-backdrop" onClick={onClose}>
      <div className="sg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sg-head">
          <h2>✨ Goal ideas</h2>
          <button className="sg-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sg-sub">Grounded in your Data Vault. Pick one — we’ll draft its plan and agents.</div>

        {loading && (
          <div className="sg-loading">
            <span className="chat-working-dots"><span /><span /><span /></span>
            Reading your Data Vault and brainstorming…
          </div>
        )}

        {error && <div className="sg-error">{error}</div>}

        {!loading && !error && (
          <>
            {!usedAI && (
              <div className="sg-note">AI is not configured — showing starter goals. Add a provider in Settings → AI providers for goals tailored to your data.</div>
            )}
            {usedAI && inventoryCount === 0 && (
              <div className="sg-note">Your Data Vault is empty — connect data or add files for sharper, data-specific goals.</div>
            )}
            <div className="sg-list">
              {goals.map((g, i) => (
                <button
                  key={i}
                  type="button"
                  className="sg-card"
                  onClick={() => void pick(g, i)}
                  disabled={busyIdx !== null}
                  title="Use this goal"
                >
                  <span className="sg-card-ic" aria-hidden>🎯</span>
                  <span className="sg-card-body">
                    <span className="sg-card-title">{g.title}</span>
                    {g.reason && <span className="sg-card-reason">{g.reason}</span>}
                  </span>
                  <span className="sg-card-use">{busyIdx === i ? '…' : 'Use →'}</span>
                </button>
              ))}
            </div>
            <div className="sg-actions">
              <button className="btn btn-ghost btn-xs" onClick={() => void run()} disabled={loading}>↻ Regenerate</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

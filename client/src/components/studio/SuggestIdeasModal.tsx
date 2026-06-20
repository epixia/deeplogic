// SuggestIdeasModal — "✨ Ideas" popup for the report and widget builders.
// On open it asks the server for valuable reports/widgets grounded in the org's
// Data Vault. Picking an idea drops its ready-to-run prompt into the composer.

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { suggestIdeas, type Idea, type IdeaTarget, type IdeasResult, type WidgetType } from '../../lib/api'
import './suggest-ideas-modal.css'

const TYPE_ICON: Record<string, string> = {
  kpi: '📊', chart: '📈', table: '📋', insight: '💡', alert: '🔔', embed: '🔗', news: '📰',
}

export default function SuggestIdeasModal({
  orgId,
  target,
  widgetType,
  onPick,
  onClose,
  actionLabel = 'Use →',
  closeOnPick = true,
}: {
  orgId: string
  target: IdeaTarget
  widgetType?: WidgetType
  onPick: (idea: Idea) => void | Promise<void>
  onClose: () => void
  /** Text shown on each idea card's action affordance. */
  actionLabel?: string
  /** Close the modal after a pick resolves (default true). */
  closeOnPick?: boolean
}) {
  const { getAccessToken } = useAuth()
  const [result, setResult] = useState<IdeasResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyIdx, setBusyIdx] = useState<number | null>(null)
  const ranRef = useRef(false)

  async function pick(idea: Idea, i: number) {
    if (busyIdx !== null) return
    setBusyIdx(i)
    try {
      await onPick(idea)
      if (closeOnPick) onClose()
    } finally {
      setBusyIdx(null)
    }
  }

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired — please sign in again.')
      const res = await suggestIdeas(t, orgId, { target, widgetType })
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to suggest ideas.')
    } finally {
      setLoading(false)
    }
  }

  // Auto-run once on open.
  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const noun = target === 'widget' ? 'Block' : 'report'

  return (
    <div className="idea-backdrop" onClick={onClose}>
      <div className="idea-modal" onClick={(e) => e.stopPropagation()}>
        <div className="idea-head">
          <h2>✨ {noun === 'Block' ? 'Block' : 'Report'} ideas</h2>
          <button className="idea-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="idea-sub">
          Grounded in your Data Vault. Pick one to drop it into the prompt.
        </div>

        {loading && (
          <div className="idea-loading">
            <span className="chat-working-dots"><span /><span /><span /></span>
            Reading your Data Vault and brainstorming…
          </div>
        )}

        {error && <div className="idea-error">{error}</div>}

        {result && !loading && (
          <>
            {!result.usedAI && (
              <div className="idea-note">
                {result.aiError
                  ? `AI request failed (${result.aiError}). Showing starter ideas.`
                  : 'AI is not configured — showing starter ideas. Add a provider in Settings → AI providers for ideas tailored to your data.'}
              </div>
            )}
            {result.inventoryCount === 0 && (
              <div className="idea-note">
                Your Data Vault is empty — connect data or add files for sharper, data-specific ideas.
              </div>
            )}
            <div className="idea-list">
              {result.ideas.map((idea, i) => (
                <button
                  key={i}
                  type="button"
                  className="idea-card"
                  onClick={() => void pick(idea, i)}
                  disabled={busyIdx !== null}
                  title="Use this idea"
                >
                  <span className="idea-card-ic" aria-hidden>
                    {idea.widgetType ? (TYPE_ICON[idea.widgetType] ?? '✦') : '📄'}
                  </span>
                  <span className="idea-card-body">
                    <span className="idea-card-title">
                      {idea.title}
                      {idea.widgetType && <span className="idea-tag">{idea.widgetType}</span>}
                    </span>
                    <span className="idea-card-prompt">{idea.prompt}</span>
                    {idea.reason && <span className="idea-card-reason">{idea.reason}</span>}
                  </span>
                  <span className="idea-card-use">{busyIdx === i ? '…' : actionLabel}</span>
                </button>
              ))}
            </div>
            <div className="idea-actions">
              <button className="btn btn-ghost btn-xs" onClick={() => void run()} disabled={loading}>
                ↻ Regenerate
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

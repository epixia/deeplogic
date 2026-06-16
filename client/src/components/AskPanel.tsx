// Ask DeepLogic — compact NL question panel.
// Owned by the Ask panel agent (PRD §10). Self-contained: no new shared files.
// POSTs to /api/orgs/:orgId/models/:id/ask via the shared api client and renders
// the AskAnswer. Tenant-scoped: takes { orgId, modelId } and authes with the
// caller's access token.

import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ask, demoAsk } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import type { AskAnswer } from '../types'

const SUGGESTIONS = [
  'What is revenue?',
  'Why did churn change?',
  'How are active users trending?',
]

// Format a numeric value according to the AskAnswer.format hint.
function formatValue(value: number, format?: string): string {
  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: value >= 1000 ? 0 : 2,
      }).format(value)
    case 'percent':
      return `${(value * 100).toFixed(1)}%`
    default:
      return new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 2,
      }).format(value)
  }
}

export default function AskPanel(props: {
  orgId?: string
  modelId: string
  demoId?: string
}) {
  const { modelId, demoId } = props
  const params = useParams<{ orgId: string }>()
  const orgId = props.orgId ?? params.orgId ?? ''
  const { getAccessToken } = useAuth()
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<AskAnswer | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(q: string) {
    const text = q.trim()
    if (!text || loading) return
    setLoading(true)
    setError(null)
    try {
      // Public demo: no auth, query the ephemeral demo model.
      if (demoId) {
        setAnswer(await demoAsk(demoId, text))
        return
      }
      const token = await getAccessToken()
      if (!token) throw new Error('Your session has expired — please sign in again.')
      const res = await ask(token, orgId, modelId, text)
      setAnswer(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setAnswer(null)
    } finally {
      setLoading(false)
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    void submit(question)
  }

  function onSuggestion(q: string) {
    setQuestion(q)
    void submit(q)
  }

  return (
    <section className="ask-panel rounded-card">
      <style>{askStyles}</style>

      <header className="ask-head">
        <span className="ask-eyebrow">Ask DeepLogic</span>
        <p className="ask-sub">
          Natural-language questions over this model — number, trend &amp; cause.
        </p>
      </header>

      <form className="ask-form" onSubmit={onSubmit}>
        <input
          className="ask-input"
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about a KPI…"
          aria-label="Ask DeepLogic a question"
          disabled={loading}
        />
        <button
          className="btn btn-primary ask-send"
          type="submit"
          disabled={loading || !question.trim()}
        >
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      <div className="ask-suggestions" role="group" aria-label="Example questions">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className="ask-chip"
            onClick={() => onSuggestion(s)}
            disabled={loading}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <p className="ask-error">{error}</p>}

      {answer && !error && (
        <div className="ask-answer">
          {answer.value != null && (
            <div className="ask-value grad-text">
              {formatValue(answer.value, answer.format)}
            </div>
          )}
          <p className="ask-text">{answer.answer}</p>
          {answer.trend && (
            <p className="ask-trend">
              <span className="ask-trend-label">Trend</span>
              {answer.trend}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

const askStyles = `
.ask-panel {
  position: relative;
  z-index: 1;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ask-head { display: flex; flex-direction: column; gap: 4px; }
.ask-eyebrow { display: block; }
.ask-sub { color: var(--mut); font-size: 13px; }

.ask-form { display: flex; gap: 10px; }
.ask-input {
  flex: 1;
  height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--card2);
  color: var(--ink);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.ask-input::placeholder { color: var(--mut2); }
.ask-input:focus {
  border-color: var(--cyan);
  box-shadow: 0 0 0 3px rgba(111, 227, 240, 0.14);
}
.ask-input:disabled { opacity: 0.6; }
.ask-send { flex: 0 0 auto; }
.ask-send:disabled { opacity: 0.55; cursor: default; transform: none; }

.ask-suggestions { display: flex; flex-wrap: wrap; gap: 8px; }
.ask-chip {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--mut);
  font-size: 12.5px;
  padding: 5px 11px;
  border-radius: 999px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.ask-chip:hover:not(:disabled) {
  color: var(--ink);
  border-color: rgba(120, 180, 220, 0.32);
  background: rgba(255, 255, 255, 0.04);
}
[data-theme='light'] .ask-chip:hover:not(:disabled) {
  border-color: rgba(20, 55, 90, 0.3);
  background: rgba(20, 55, 90, 0.05);
}
.ask-chip:disabled { opacity: 0.5; cursor: default; }

.ask-error {
  color: var(--bad);
  font-size: 13px;
  border: 1px solid var(--line);
  background: var(--card2);
  border-radius: 10px;
  padding: 10px 12px;
}

.ask-answer {
  border-top: 1px solid var(--line);
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ask-value {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.ask-text { color: var(--ink); font-size: 14px; line-height: 1.5; }
.ask-trend {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--mut);
  font-size: 13px;
}
.ask-trend-label {
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--cyan);
}
`

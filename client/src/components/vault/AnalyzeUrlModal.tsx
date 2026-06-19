// AnalyzeUrlModal — "Analyse" popup for a Vault URL (website or connector).
// Pick one or more analysis lenses, run them through the workspace AI, then
// act on the results with one click: create a connector, create an agent, or
// save a profile/competitive note into the Vault.

import { useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import {
  analyzeUrl,
  createContext,
  createAgentsBulk,
  type AnalysisLens,
  type UrlAnalysis,
  type ProposedConnector,
  type ProposedAgent,
} from '../../lib/api'
import './analyze-url-modal.css'

const LENSES: { id: AnalysisLens; icon: string; label: string; blurb: string }[] = [
  { id: 'api', icon: '🔌', label: 'API & Integrations', blurb: 'Find APIs/SaaS this company exposes or uses — and propose connectors.' },
  { id: 'company', icon: '🏢', label: 'Company Profile', blurb: 'What they do, industry, size, products, business model.' },
  { id: 'competitive', icon: '⚔', label: 'Competitive Analysis', blurb: 'Competitors, positioning, strengths & weaknesses.' },
  { id: 'metrics', icon: '📊', label: 'Metrics & Agents', blurb: 'KPIs worth tracking and AI agents worth creating.' },
]

type CreateState = Record<string, 'idle' | 'saving' | 'done' | 'error'>

export default function AnalyzeUrlModal({
  orgId,
  url,
  title,
  onClose,
  onCreated,
}: {
  orgId: string
  url: string
  title?: string
  onClose: () => void
  onCreated?: () => void
}) {
  const { getAccessToken } = useAuth()
  const [selected, setSelected] = useState<Set<AnalysisLens>>(
    () => new Set(LENSES.map((l) => l.id)),
  )
  const [phase, setPhase] = useState<'pick' | 'loading' | 'done'>('pick')
  const [result, setResult] = useState<UrlAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreateState>({})

  function toggle(id: AnalysisLens) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function run() {
    if (selected.size === 0) return
    setPhase('loading')
    setError(null)
    setCreated({})
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired — please sign in again.')
      const res = await analyzeUrl(t, orgId, { url, lenses: [...selected] })
      setResult(res)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed.')
      setPhase('pick')
    }
  }

  async function withCreate(key: string, fn: () => Promise<void>) {
    if (created[key] === 'saving' || created[key] === 'done') return
    setCreated((p) => ({ ...p, [key]: 'saving' }))
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      await fn()
      setCreated((p) => ({ ...p, [key]: 'done' }))
      onCreated?.()
    } catch {
      setCreated((p) => ({ ...p, [key]: 'error' }))
    }
  }

  function createConnector(c: ProposedConnector, key: string) {
    return withCreate(key, async () => {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const content = [
        c.url ? `Endpoint: ${c.url}` : '',
        c.description ? `Description: ${c.description}` : '',
        c.reason ? `Why: ${c.reason}` : '',
        `Discovered by analysing ${url}`,
      ].filter(Boolean).join('\n')
      await createContext(t, orgId, {
        kind: 'mcp',
        name: c.name,
        content,
        meta: { url: c.url, description: c.description, connectorType: c.connectorType },
        scope: 'org',
      })
    })
  }

  function createAgent(a: ProposedAgent, key: string) {
    return withCreate(key, async () => {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      await createAgentsBulk(t, orgId, [a])
    })
  }

  function saveNote(name: string, content: string, key: string) {
    return withCreate(key, async () => {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      await createContext(t, orgId, { kind: 'note', name, content, scope: 'org' })
    })
  }

  const createLabel = (key: string, idle: string) =>
    created[key] === 'done' ? '✓ Added' :
    created[key] === 'saving' ? 'Adding…' :
    created[key] === 'error' ? '✕ Retry' : idle

  return (
    <div className="vault-modal-backdrop" onClick={onClose}>
      <div className="vault-modal analyze-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vault-modal-head">
          <h2>⚡ Analyse URL</h2>
          <button className="vault-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="analyze-url" title={url}>{title ? `${title} · ` : ''}{url}</div>

        {/* Lens picker */}
        <div className="analyze-lenses">
          {LENSES.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`analyze-lens${selected.has(l.id) ? ' is-on' : ''}`}
              onClick={() => toggle(l.id)}
              disabled={phase === 'loading'}
            >
              <span className="analyze-lens-check" aria-hidden>{selected.has(l.id) ? '✓' : ''}</span>
              <span className="analyze-lens-ic" aria-hidden>{l.icon}</span>
              <span className="analyze-lens-text">
                <span className="analyze-lens-label">{l.label}</span>
                <span className="analyze-lens-blurb">{l.blurb}</span>
              </span>
            </button>
          ))}
        </div>

        {error && <div className="vault-modal-error">{error}</div>}

        <div className="vault-modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button
            className="btn btn-primary"
            onClick={() => void run()}
            disabled={selected.size === 0 || phase === 'loading'}
          >
            {phase === 'loading' ? 'Analysing…' : phase === 'done' ? 'Re-analyse' : `Analyse (${selected.size})`}
          </button>
        </div>

        {/* Results */}
        {phase === 'loading' && (
          <div className="analyze-loading">Fetching the page and running {selected.size} {selected.size === 1 ? 'analysis' : 'analyses'}…</div>
        )}

        {result && phase === 'done' && (
          <div className="analyze-results">
            {!result.usedAI && (
              <div className="analyze-note analyze-note--warn">
                AI is not configured for this workspace, so these are heuristic results. Add a provider in
                Settings → AI providers for a full analysis.
                {result.aiError ? ` (${result.aiError})` : ''}
              </div>
            )}

            {/* API & Integrations */}
            {result.api && (
              <section className="analyze-card">
                <h3>🔌 API & Integrations</h3>
                {result.api.summary && <p className="analyze-summary">{result.api.summary}</p>}
                {result.api.connectors.length === 0 ? (
                  <div className="analyze-empty">No connectors proposed.</div>
                ) : (
                  result.api.connectors.map((c, i) => {
                    const key = `conn:${i}`
                    return (
                      <div className="analyze-item" key={key}>
                        <div className="analyze-item-main">
                          <div className="analyze-item-title">
                            {c.name} <span className="analyze-tag">{c.connectorType}</span>
                          </div>
                          {c.url && <div className="analyze-item-url">{c.url}</div>}
                          {c.reason && <div className="analyze-item-sub">{c.reason}</div>}
                        </div>
                        <button
                          className={`btn btn-xs ${created[key] === 'done' ? 'btn-ghost' : 'btn-primary'}`}
                          onClick={() => void createConnector(c, key)}
                          disabled={created[key] === 'saving' || created[key] === 'done'}
                        >
                          {createLabel(key, '+ Connector')}
                        </button>
                      </div>
                    )
                  })
                )}
              </section>
            )}

            {/* Company Profile */}
            {result.company && (
              <section className="analyze-card">
                <h3>🏢 Company Profile</h3>
                {result.company.summary && <p className="analyze-summary">{result.company.summary}</p>}
                {result.company.facts.length > 0 && (
                  <dl className="analyze-facts">
                    {result.company.facts.map((f, i) => (
                      <div className="analyze-fact" key={i}>
                        <dt>{f.label}</dt>
                        <dd>{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <button
                  className={`btn btn-xs ${created['note:company'] === 'done' ? 'btn-ghost' : 'btn-primary'}`}
                  onClick={() => void saveNote(
                    `Company profile — ${result.sourceTitle || url}`,
                    [result.company!.summary, ...result.company!.facts.map((f) => `${f.label}: ${f.value}`)].join('\n'),
                    'note:company',
                  )}
                  disabled={created['note:company'] === 'saving' || created['note:company'] === 'done'}
                >
                  {createLabel('note:company', '+ Save to Vault')}
                </button>
              </section>
            )}

            {/* Competitive Analysis */}
            {result.competitive && (
              <section className="analyze-card">
                <h3>⚔ Competitive Analysis</h3>
                {result.competitive.summary && <p className="analyze-summary">{result.competitive.summary}</p>}
                {result.competitive.competitors.length > 0 && (
                  <ul className="analyze-list">
                    {result.competitive.competitors.map((c, i) => (
                      <li key={i}><strong>{c.name}</strong>{c.note ? ` — ${c.note}` : ''}</li>
                    ))}
                  </ul>
                )}
                {(result.competitive.strengths.length > 0 || result.competitive.weaknesses.length > 0) && (
                  <div className="analyze-swot">
                    {result.competitive.strengths.length > 0 && (
                      <div>
                        <span className="analyze-swot-h analyze-swot-h--good">Strengths</span>
                        <ul>{result.competitive.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                      </div>
                    )}
                    {result.competitive.weaknesses.length > 0 && (
                      <div>
                        <span className="analyze-swot-h analyze-swot-h--bad">Weaknesses</span>
                        <ul>{result.competitive.weaknesses.map((s, i) => <li key={i}>{s}</li>)}</ul>
                      </div>
                    )}
                  </div>
                )}
                <button
                  className={`btn btn-xs ${created['note:comp'] === 'done' ? 'btn-ghost' : 'btn-primary'}`}
                  onClick={() => void saveNote(
                    `Competitive analysis — ${result.sourceTitle || url}`,
                    [
                      result.competitive!.summary,
                      ...result.competitive!.competitors.map((c) => `Competitor: ${c.name} — ${c.note}`),
                      ...result.competitive!.strengths.map((s) => `Strength: ${s}`),
                      ...result.competitive!.weaknesses.map((s) => `Weakness: ${s}`),
                    ].filter(Boolean).join('\n'),
                    'note:comp',
                  )}
                  disabled={created['note:comp'] === 'saving' || created['note:comp'] === 'done'}
                >
                  {createLabel('note:comp', '+ Save to Vault')}
                </button>
              </section>
            )}

            {/* Metrics & Agents */}
            {result.metrics && (
              <section className="analyze-card">
                <h3>📊 Metrics & Agents</h3>
                {result.metrics.summary && <p className="analyze-summary">{result.metrics.summary}</p>}
                {result.metrics.kpis.length > 0 && (
                  <ul className="analyze-list">
                    {result.metrics.kpis.map((k, i) => <li key={i}>{k}</li>)}
                  </ul>
                )}
                {result.metrics.agents.length > 0 && (
                  <>
                    <div className="analyze-subhead">Suggested agents</div>
                    {result.metrics.agents.map((a, i) => {
                      const key = `agent:${i}`
                      return (
                        <div className="analyze-item" key={key}>
                          <div className="analyze-item-main">
                            <div className="analyze-item-title">{a.name}</div>
                            {a.description && <div className="analyze-item-sub">{a.description}</div>}
                          </div>
                          <button
                            className={`btn btn-xs ${created[key] === 'done' ? 'btn-ghost' : 'btn-primary'}`}
                            onClick={() => void createAgent(a, key)}
                            disabled={created[key] === 'saving' || created[key] === 'done'}
                          >
                            {createLabel(key, '+ Agent')}
                          </button>
                        </div>
                      )
                    })}
                  </>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Orchestrator — the lead agent that turns a Goal into a plan and coordinates
// the specialist agents that deliver it. Presentational: it explains the
// orchestrator's role, capabilities and how it delegates, so users understand
// the agent that sits above the rest. Pairs with the Goals page.

import './orchestrator.css'

interface Capability { icon: string; name: string; blurb: string }

const CAPABILITIES: Capability[] = [
  { icon: '🧩', name: 'Goal decomposition', blurb: 'Breaks a business goal into an ordered, actionable plan.' },
  { icon: '🧭', name: 'Task routing', blurb: 'Matches each step to the specialist agent best suited to it.' },
  { icon: '🤝', name: 'Agent delegation', blurb: 'Spins up and dispatches the agent team, in sequence or parallel.' },
  { icon: '📡', name: 'Progress monitoring', blurb: 'Tracks each agent’s status and detects stalls or failures.' },
  { icon: '🧮', name: 'Result synthesis', blurb: 'Merges every agent’s output into one coherent summary.' },
  { icon: '🛡', name: 'Guardrails', blurb: 'Keeps work scoped to the goal and flags risky or stale data.' },
]

const COORDINATES: { icon: string; name: string }[] = [
  { icon: '📈', name: 'KPI discovery agent' },
  { icon: '🔌', name: 'Connector scanner agent' },
  { icon: '🗄', name: 'DataVault mapping agent' },
  { icon: '⚠️', name: 'Risk agent' },
  { icon: '📝', name: 'Summary agent' },
]

const FLOW: string[] = [
  'Read the goal and the Data Vault context',
  'Draft a step-by-step plan',
  'Assign each step to a specialist agent',
  'Run the team and monitor progress',
  'Synthesise results into a summary',
]

export default function Orchestrator() {
  return (
    <section className="orch-wrap">
      <div className="orch-card">
        <div className="orch-main">
          <div className="orch-id">
            <span className="orch-avatar" aria-hidden>🎛</span>
            <div>
              <div className="orch-titlerow">
                <h2 className="orch-name">Orchestrator Agent</h2>
                <span className="orch-badge">Lead agent</span>
                <span className="orch-status">● Active</span>
              </div>
              <p className="orch-desc">
                The orchestrator sits above your agent team. Give it a <strong>goal</strong> and it drafts the
                plan, delegates each step to the right specialist agent, monitors their progress, and
                synthesises everything into a single result.
              </p>
            </div>
          </div>

          <div className="orch-cols">
            <div className="orch-col">
              <h3 className="orch-h3">Skills</h3>
              <div className="orch-caps">
                {CAPABILITIES.map((c) => (
                  <div className="orch-cap" key={c.name} title={c.blurb}>
                    <span className="orch-cap-ic">{c.icon}</span>
                    <div className="orch-cap-txt">
                      <span className="orch-cap-name">{c.name}</span>
                      <span className="orch-cap-blurb">{c.blurb}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="orch-col orch-col--side">
              <h3 className="orch-h3">Coordinates</h3>
              <ul className="orch-coord">
                {COORDINATES.map((a) => (
                  <li key={a.name}><span aria-hidden>{a.icon}</span>{a.name}</li>
                ))}
              </ul>

              <h3 className="orch-h3 orch-h3--flow">How it works</h3>
              <ol className="orch-flow">
                {FLOW.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

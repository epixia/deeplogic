// Pitch — a full-screen, keyboard-navigable leadership deck presenting the
// DeepLogic concept and its value proposition for the Retail and Enterprise
// sectors. Standalone (fixed overlay over the app chrome). Route: /pitch.
//   ← / →  · Space     navigate        Home / End  first / last      Esc  exit
// F (or the ⤢ button) toggles fullscreen.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import './pitch.css'

interface Slide { tag?: string; title: ReactNode; body: ReactNode; kind?: 'cover' | 'standard' }

const SLIDES: Slide[] = [
  {
    kind: 'cover',
    title: <>Agentic Mission Control<br />for Business Intelligence</>,
    body: (
      <>
        <p className="pp-cover-sub">Turn your reports and data into AI agents that work 24/7 — understanding your numbers, watching for risk, and acting on opportunity.</p>
        <p className="pp-cover-meta">Concept &amp; value proposition · Retail &amp; Enterprise · Leadership review</p>
      </>
    ),
  },
  {
    tag: 'The problem',
    title: <>BI stops at the dashboard. The work doesn’t.</>,
    body: (
      <ul className="pp-bullets">
        <li><b>Dashboards are static.</b> They show what happened; someone still has to notice, interpret, and act.</li>
        <li><b>Insight lags reality.</b> By the time a number is reviewed, the moment to act has often passed.</li>
        <li><b>Analysts are the bottleneck.</b> Every new question is a new ticket, a new report, a new delay.</li>
        <li><b>Data is fragmented.</b> Power BI here, a CRM there, spreadsheets everywhere — no single brain.</li>
      </ul>
    ),
  },
  {
    tag: 'The concept',
    title: <>One brain. A fleet of agents. Always on.</>,
    body: (
      <>
        <p className="pp-lead">DeepLogic ingests your data and documents, builds a living understanding of your business, and stands up <b>autonomous AI agents</b> on top of it — all from one mission-control surface.</p>
        <div className="pp-grid pp-grid-3">
          <div className="pp-card"><div className="pp-card-ic">🧠</div><h3>Understands</h3><p>A bi-temporal memory graph of your entities, metrics &amp; relationships — not just charts.</p></div>
          <div className="pp-card"><div className="pp-card-ic">🤖</div><h3>Acts</h3><p>Agents run real missions on cloud VMs — research, outreach, monitoring — and report back.</p></div>
          <div className="pp-card"><div className="pp-card-ic">🔔</div><h3>Alerts</h3><p>Always-on triggers watch KPIs, uptime, keywords &amp; thresholds and notify the right people.</p></div>
        </div>
      </>
    ),
  },
  {
    tag: 'How it works',
    title: <>From raw data to autonomous action in five steps</>,
    body: (
      <ol className="pp-steps">
        <li><span className="pp-step-n">1</span><div><b>Connect</b><p>Websites, databases, Power BI, CRMs, files — via a growing connector library.</p></div></li>
        <li><span className="pp-step-n">2</span><div><b>Understand</b><p>AI extracts entities, products, competitors &amp; KPIs into a memory graph.</p></div></li>
        <li><span className="pp-step-n">3</span><div><b>Build</b><p>No-code Blocks &amp; dashboards assembled automatically — or by prompt.</p></div></li>
        <li><span className="pp-step-n">4</span><div><b>Deploy</b><p>Spin up autonomous agents with a budget, mission &amp; guardrails.</p></div></li>
        <li><span className="pp-step-n">5</span><div><b>Act</b><p>Alerts fire, agents execute, results flow back to mission control.</p></div></li>
      </ol>
    ),
  },
  {
    tag: 'Value · Retail',
    title: <>For Retail: protect margin, never miss a shift in demand</>,
    body: (
      <div className="pp-grid pp-grid-2">
        <div className="pp-card"><h3>🛒 Demand &amp; inventory</h3><p>Agents watch sell-through and flag stockouts &amp; overstock before they cost you.</p></div>
        <div className="pp-card"><h3>🏷 Competitor price monitoring</h3><p>Track rivals’ pricing &amp; promotions automatically; alert on undercuts.</p></div>
        <div className="pp-card"><h3>📈 Store &amp; channel KPIs</h3><p>Unified view across stores, e-comm &amp; regions — margin, returns, conversion.</p></div>
        <div className="pp-card"><h3>🎯 Promotions &amp; churn</h3><p>Spot underperforming SKUs and at-risk customers, with the next best action.</p></div>
      </div>
    ),
  },
  {
    tag: 'Value · Enterprise',
    title: <>For Enterprise: unify the silos, govern the autonomy</>,
    body: (
      <div className="pp-grid pp-grid-2">
        <div className="pp-card"><h3>🔗 One source of truth</h3><p>Connect Power BI, data warehouses, CRMs (Odoo) &amp; docs into one memory graph.</p></div>
        <div className="pp-card"><h3>🛡 Governed agents</h3><p>Budgets, approval gates, read-only modes &amp; allowed-domain guardrails on every agent.</p></div>
        <div className="pp-card"><h3>🏢 Multi-tenant &amp; secure</h3><p>Org isolation, role-based access, audit logs — built for many teams.</p></div>
        <div className="pp-card"><h3>⚙ Fits your stack</h3><p>Bring-your-own model keys, SMTP, databases &amp; integrations — no rip-and-replace.</p></div>
      </div>
    ),
  },
  {
    tag: 'Why it wins',
    title: <>What makes DeepLogic different</>,
    body: (
      <div className="pp-grid pp-grid-2">
        <div className="pp-card"><h3>Agents on real computers</h3><p>Not just chat — agents provision real cloud VMs and do multi-step work.</p></div>
        <div className="pp-card"><h3>A living memory graph</h3><p>Bi-temporal knowledge that stays current and explains the “why”.</p></div>
        <div className="pp-card"><h3>No-code Blocks</h3><p>Anyone assembles dashboards &amp; data apps from a gallery — minutes, not sprints.</p></div>
        <div className="pp-card"><h3>Open by design</h3><p>Connector library + native integrations (Power BI, databases, Odoo CRM).</p></div>
      </div>
    ),
  },
  {
    tag: 'Proof',
    title: <>Live, working — not a mockup</>,
    body: (
      <>
        <p className="pp-lead">A full <b>Cannara Biotech</b> demo runs today: a cannabis-production mission-control workspace with live sensor data, sales, competitor intel, agents &amp; alerts — generated from a single website.</p>
        <ul className="pp-bullets">
          <li>Onboards a real company from just a URL in under a minute.</li>
          <li>Deploys autonomous Hermes / OpenClaw agents to real Orgo VMs.</li>
          <li>Integrated CRM (Odoo), Power BI ingestion &amp; database analysis.</li>
        </ul>
      </>
    ),
  },
  {
    tag: 'Opportunity',
    title: <>A wedge into two large, urgent markets</>,
    body: (
      <div className="pp-grid pp-grid-2">
        <div className="pp-card"><h3>Retail</h3><p>Thin margins + fast-moving demand = high willingness to pay for always-on monitoring &amp; price intelligence.</p></div>
        <div className="pp-card"><h3>Enterprise</h3><p>Every org is under pressure to “do something with AI”. We turn existing BI investments into autonomous action.</p></div>
        <div className="pp-card pp-card--wide"><h3>The wedge</h3><p>Land with self-serve onboarding &amp; a starter dashboard; expand into agents, integrations &amp; org-wide deployment.</p></div>
      </div>
    ),
  },
  {
    tag: 'Direction',
    title: <>Where we take it next</>,
    body: (
      <div className="pp-road">
        <div className="pp-road-col"><span className="pp-road-when">Now</span><ul><li>Onboarding → dashboards → agents</li><li>Alerts, connectors, CRM &amp; Power BI</li><li>Live Cannara demo</li></ul></div>
        <div className="pp-road-col"><span className="pp-road-when">Next</span><ul><li>Agent marketplace &amp; templates</li><li>Deeper retail packs (pricing, inventory)</li><li>SSO, advanced governance &amp; audit</li></ul></div>
        <div className="pp-road-col"><span className="pp-road-when">Later</span><ul><li>Vertical editions (retail, mfg, finance)</li><li>Multi-agent orchestration at scale</li><li>Partner &amp; reseller ecosystem</li></ul></div>
      </div>
    ),
  },
  {
    tag: 'The ask',
    title: <>Greenlight the next phase</>,
    body: (
      <>
        <p className="pp-lead">We’re asking leadership to back DeepLogic as a strategic direction — with the focus and resources to win in Retail and Enterprise.</p>
        <div className="pp-grid pp-grid-3">
          <div className="pp-card"><div className="pp-card-ic">✅</div><h3>Commit</h3><p>Endorse the agentic-BI direction.</p></div>
          <div className="pp-card"><div className="pp-card-ic">👥</div><h3>Resource</h3><p>Team to harden, integrate &amp; sell.</p></div>
          <div className="pp-card"><div className="pp-card-ic">🎯</div><h3>Measure</h3><p>Pilot with 2–3 design partners next quarter.</p></div>
        </div>
      </>
    ),
  },
]

export default function Pitch() {
  const navigate = useNavigate()
  const [i, setI] = useState(0)
  const n = SLIDES.length

  const go = useCallback((d: number) => setI((c) => Math.min(n - 1, Math.max(0, c + d))), [n])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(1) }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1) }
      else if (e.key === 'Home') setI(0)
      else if (e.key === 'End') setI(n - 1)
      else if (e.key === 'Escape') navigate('/')
      else if (e.key.toLowerCase() === 'f') toggleFs()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, n, navigate])

  function toggleFs() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.()
  }

  const s = SLIDES[i]
  return (
    <div className="pp-deck">
      <div className="pp-bgglow" />
      <header className="pp-top">
        <div className="pp-brand"><Logo size={26} /> <span className="grad-text">DeepLogic</span></div>
        <div className="pp-top-right">
          <button className="pp-iconbtn" title="Fullscreen (F)" onClick={toggleFs}>⤢</button>
          <button className="pp-iconbtn" title="Exit (Esc)" onClick={() => navigate('/')}>✕</button>
        </div>
      </header>

      <main className={`pp-slide${s.kind === 'cover' ? ' pp-slide--cover' : ''}`} key={i}>
        {s.kind === 'cover' ? (
          <div className="pp-cover">
            <Logo size={72} />
            <h1 className="pp-cover-title grad-text">{s.title}</h1>
            {s.body}
          </div>
        ) : (
          <div className="pp-slide-inner">
            {s.tag && <span className="pp-tag">{s.tag}</span>}
            <h2 className="pp-title">{s.title}</h2>
            <div className="pp-body">{s.body}</div>
          </div>
        )}
      </main>

      <footer className="pp-controls">
        <button className="pp-nav" onClick={() => go(-1)} disabled={i === 0}>‹ Prev</button>
        <div className="pp-dots">
          {SLIDES.map((_, k) => (
            <button key={k} className={`pp-dot${k === i ? ' on' : ''}`} onClick={() => setI(k)} aria-label={`Slide ${k + 1}`} />
          ))}
        </div>
        <div className="pp-count">{i + 1} / {n}</div>
        <button className="pp-nav" onClick={() => go(1)} disabled={i === n - 1}>Next ›</button>
      </footer>
    </div>
  )
}

// Home — condensed landing hero (§9) + a working, no-login DEMO section: pick a
// sample report or upload your own, and jump straight into a live demo.

import { Link } from 'react-router-dom'
import HeroOrchestration from '../components/HeroOrchestration'
import Footer from '../components/Footer'
import './home.css'
import './ingest.css'

export default function Home() {
  return (
    <main className="wrap dl-home">
      {/* ---------------- hero ---------------- */}
      <header className="dlh-hero">
        <div className="dlh-hero-copy">
          <span className="pill">
            <span className="dot" /> AI agents that work 24/7
          </span>
          <h1 className="dlh-h1">
            Turn your reports and data into{' '}
            <span className="grad-text">agents working for you 24/7</span>.
          </h1>
          <p className="dlh-sub">
            Connect your reports and data once. DeepLogic turns them into smart
            agents that work around the clock — finding answers, building charts,
            watching your numbers, and telling you what to do next.
          </p>
          <div className="dlh-cta">
            <Link to="/onboarding" className="btn btn-primary">
              Get Started →
            </Link>
          </div>
          <p className="dlh-micro">
            Start with your website — we'll read it, learn your business, find your
            competitors, and set up your workspace while you watch.
          </p>
        </div>

        {/* value-prop animation: orchestrator brain deploying agents around your data */}
        <HeroOrchestration />
      </header>

      {/* ---------------- partners ---------------- */}
      <section className="dlh-partners" aria-label="Technology partners">
        <span className="dlh-partners-label">In partnership with</span>
        <div className="dlh-partners-logos">
          {/* Microsoft */}
          <span className="dlh-logo" title="Microsoft partner">
            <svg viewBox="0 0 23 23" className="dlh-logo-mark" aria-hidden="true">
              <rect x="0" y="0" width="10.5" height="10.5" fill="#F25022" />
              <rect x="12.5" y="0" width="10.5" height="10.5" fill="#7FBA00" />
              <rect x="0" y="12.5" width="10.5" height="10.5" fill="#00A4EF" />
              <rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900" />
            </svg>
            <span className="dlh-logo-word">Microsoft</span>
          </span>

          {/* NVIDIA */}
          <span className="dlh-logo" title="NVIDIA partner">
            <span className="dlh-logo-word dlh-logo-word--nvidia">NVIDIA</span>
            <span className="dlh-logo-tm">Inception</span>
          </span>
        </div>
      </section>

      {/* ---------------- why / reassurance ---------------- */}
      <section className="dlh-how">
        <h2 className="dlh-h2">Agentic Mission Control for Business Intelligence</h2>
        <p className="dlh-lead">
          Turn your reports and data into AI agents that work 24/7 — understanding your
          numbers, watching for risk, and acting on opportunity.
        </p>
        <div className="dlh-steps">
          <div className="dlh-step">
            <div className="n">✓</div>
            <h3>Simple to start</h3>
            <p>No code. No IT project. Connect your data and you're up and running in minutes.</p>
          </div>
          <div className="dlh-step">
            <div className="n">🔒</div>
            <h3>Safe by design</h3>
            <p>Your data stays private. Agents follow your rules — and you approve anything important before it happens.</p>
          </div>
          <div className="dlh-step">
            <div className="n">⏰</div>
            <h3>Always on</h3>
            <p>Your agents keep working day and night — researching, watching your numbers, and flagging what needs you.</p>
          </div>
        </div>
      </section>

      {/* ---------------- how it works ---------------- */}
      <section id="how" className="dlh-how dlh-how--bare">
        <div className="dlh-steps">
          <div className="dlh-step">
            <div className="n">1</div>
            <h3>Add your data</h3>
            <p>
              Drop in a file or pick an example. DeepLogic reads it and learns
              your numbers — no setup needed.
            </p>
          </div>
          <div className="dlh-step">
            <div className="n">2</div>
            <h3>Get clear charts</h3>
            <p>
              It builds easy charts and one simple page that shows how your
              business is really doing.
            </p>
          </div>
          <div className="dlh-step">
            <div className="n">3</div>
            <h3>Your agents work 24/7</h3>
            <p>
              Your agents never clock out — they watch your numbers, flag
              problems, explain why, and tell you the next move.
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}

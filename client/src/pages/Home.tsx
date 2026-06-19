// Home — condensed landing hero (§9) + a working, no-login DEMO section: pick a
// sample report or upload your own, and jump straight into a live demo.

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import DropZone from '../components/ingest/DropZone'
import HeroOrchestration from '../components/HeroOrchestration'
import Footer from '../components/Footer'
import { demoIngestSample, demoIngestUpload, demoSamples } from '../lib/api'
import './home.css'
import './ingest.css'

const BLURBS: Record<string, string> = {
  'Atlas Retail':
    'Omnichannel retail — orders, revenue, margin and returns across regions and channels.',
  'Northwind SaaS':
    'B2B subscription — MRR, active seats, churn and NPS by plan and segment.',
}

export default function Home() {
  const navigate = useNavigate()
  const [samples, setSamples] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    demoSamples()
      .then((s) => alive && setSamples(s))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  async function startSample(sampleId: string) {
    if (busy) return
    setBusy(sampleId)
    setError(null)
    try {
      const { demoId } = await demoIngestSample(sampleId)
      navigate(`/demo/${demoId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the demo.')
      setBusy(null)
    }
  }

  async function startUpload(file: File) {
    if (busy) return
    setBusy('upload')
    setError(null)
    try {
      const { demoId } = await demoIngestUpload(file)
      navigate(`/demo/${demoId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the demo.')
      setBusy(null)
    }
  }

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
        <h2 className="dlh-h2">AI agents, without the risk or the rocket science.</h2>
        <p className="dlh-lead">
          You don't need to be technical. DeepLogic is the simple, secure way for
          business owners to put the new wave of AI agents to work.
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

      {/* ---------------- live demo ---------------- */}
      <section id="demo" className="dlh-demo">
        <h2 className="dlh-h2">See it for yourself.</h2>
        <p className="dlh-lead">
          Pick an example or add your own file. In a few seconds you'll get
          charts you can click around. No account needed.
        </p>

        {error && (
          <div className="dli-error" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}

        <div className="dlh-demo-grid">
          {/* sample chooser */}
          <div className="dli-samples">
            <div className="dli-section-head">
              <p className="dli-section-sub">
                Ready-made examples — open one in a click.
              </p>
            </div>
            <div className="dli-sample-grid">
              {samples.length === 0 ? (
                <>
                  <div className="dli-sample-card dli-skel" />
                  <div className="dli-sample-card dli-skel" />
                </>
              ) : (
                samples.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="dli-sample-card"
                    disabled={!!busy}
                    onClick={() => startSample(m.id)}
                  >
                    <div className="dli-sample-top">
                      <span className="dli-sample-badge">Report</span>
                      <span className="dli-sample-src">sample</span>
                    </div>
                    <h3 className="dli-sample-name">{m.name}</h3>
                    <p className="dli-sample-blurb">
                      {BLURBS[m.name] ?? 'Bundled semantic model.'}
                    </p>
                    <span className="dli-sample-cta">
                      {busy === m.id ? 'Generating…' : 'See the demo →'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* upload */}
          <DropZone onFile={startUpload} disabled={!!busy} busy={busy === 'upload'} />
        </div>
      </section>

      {/* ---------------- how it works ---------------- */}
      <section id="how" className="dlh-how">
        <h2 className="dlh-h2">
          How it works
        </h2>
        <p className="dlh-lead">
          Three easy steps. No setup headaches — start with what you already have.
        </p>
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

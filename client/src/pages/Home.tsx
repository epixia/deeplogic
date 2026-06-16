// Home — condensed landing hero (§9) + a working, no-login DEMO section: pick a
// sample report or upload your own, and jump straight into a live demo.

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import DropZone from '../components/ingest/DropZone'
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
            <span className="dot" /> Agentic analytics for your own company data
          </span>
          <h1 className="dlh-h1">
            From reports to a{' '}
            <span className="grad-text">control room that thinks</span>.
          </h1>
          <p className="dlh-sub">
            DeepLogic reads your reports and data, learns your connectors and
            KPIs, and automatically builds an interactive dashboard and a live
            mission control center — driven by an agentic workflow that watches,
            explains, and acts.
          </p>
          <div className="dlh-cta">
            <a href="#demo" className="btn btn-primary">
              Try the demo →
            </a>
            <Link to="/app" className="btn btn-ghost">
              Open the product
            </Link>
          </div>
          <p className="dlh-micro">
            No sign-up needed — pick a sample report or upload your own, and
            watch a mission control center generate in seconds.
          </p>
        </div>

        {/* live console mockup (decorative) */}
        <div className="console" aria-hidden="true">
          <div className="con-top">
            <i className="dot-r" />
            <i className="dot-y" />
            <i className="dot-g" />
            <span className="con-title">DeepLogic · Mission Control</span>
          </div>
          <div className="grid2">
            <div className="kpi">
              <div className="k">Revenue</div>
              <div className="v up">$4.2M</div>
              <div className="d">▲ 12.4%</div>
            </div>
            <div className="kpi">
              <div className="k">Active</div>
              <div className="v">18.6k</div>
              <div className="d">▲ 5.1%</div>
            </div>
            <div className="kpi">
              <div className="k">Churn</div>
              <div className="v">2.3%</div>
              <div className="d">▼ 0.4%</div>
            </div>
            <div className="kpi">
              <div className="k">NPS</div>
              <div className="v up">61</div>
              <div className="d">▲ 3</div>
            </div>

            <div className="panel half">
              <div className="ph">
                <span>Pipeline by stage</span>
                <span>Q2</span>
              </div>
              <div className="bars">
                <b style={{ height: '40%' }} />
                <b style={{ height: '62%' }} />
                <b style={{ height: '48%' }} />
                <b style={{ height: '78%' }} />
                <b style={{ height: '90%' }} />
                <b style={{ height: '66%' }} />
                <b style={{ height: '84%' }} />
              </div>
            </div>
            <div className="panel half">
              <div className="ph">
                <span>Agentic workflow</span>
                <span style={{ color: 'var(--cyan)' }}>● live</span>
              </div>
              <div className="agent">
                <span className="ic">1</span> Ingested report model{' '}
                <span className="ok">done</span>
              </div>
              <div className="agent">
                <span className="ic">2</span> Mapped 14 connectors{' '}
                <span className="ok">done</span>
              </div>
              <div className="agent">
                <span className="ic">3</span> Detected KPI anomaly{' '}
                <span className="run">running</span>
              </div>
              <div className="agent">
                <span className="ic">4</span> Drafting action brief{' '}
                <span className="run">running</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ---------------- live demo ---------------- */}
      <section id="demo" className="dlh-demo">
        <h2 className="dlh-h2">See your mission control center generate.</h2>
        <p className="dlh-lead">
          Use a sample report, or bring your own. DeepLogic analyzes it,
          maps the KPIs, and spins up an interactive mission control you can click
          through — instantly, no account required.
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
                Pre-built sample reports — ingested instantly.
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
          From a report to a thinking control center.
        </h2>
        <p className="dlh-lead">
          No re-platforming, no rebuilding your stack. DeepLogic starts from
          what you already have and layers intelligence on top.
        </p>
        <div className="dlh-steps">
          <div className="dlh-step">
            <div className="n">1</div>
            <h3>Ingest &amp; understand</h3>
            <p>
              Drop in a report or pick a sample. DeepLogic parses the
              data model, relationships, measures and visuals to understand your
              connectors and KPIs.
            </p>
          </div>
          <div className="dlh-step">
            <div className="n">2</div>
            <h3>Generate dashboards</h3>
            <p>
              It automatically assembles clean, interactive dashboards — the
              right charts for the right metrics — and a unified mission control
              view across every connected system.
            </p>
          </div>
          <div className="dlh-step">
            <div className="n">3</div>
            <h3>Deploy agents</h3>
            <p>
              An agentic workflow monitors KPIs, surfaces anomalies, explains
              the "why," and recommends or triggers the next action — so the
              dashboard works for you.
            </p>
          </div>
        </div>

        <div className="dlh-bottom-cta">
          <Link to="/signup" className="btn btn-primary">
            Get started free →
          </Link>
        </div>
      </section>
    </main>
  )
}

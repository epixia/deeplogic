// Public, no-login DEMO experience (homepage "see a demo"). Loads an ephemeral
// demo model, animates the ingest pipeline, then reveals a full dashboard +
// Mission Control + Ask — all via the public /api/demo/* endpoints. A banner
// invites the visitor to sign up to use their own data.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type {
  AgentEvent,
  Anomaly,
  AuditEntry,
  SemanticModel,
} from '../types'
import {
  demoAnomalies,
  demoApprove,
  demoAudit,
  demoGetModel,
  openDemoIngestStream,
  openDemoMissionStream,
} from '../lib/api'
import Logo from '../components/Logo'
import AskPanel from '../components/AskPanel'
import ConnectorsStrip from '../components/dashboard/ConnectorsStrip'
import Filters, { type DateRange } from '../components/dashboard/Filters'
import KpiCards from '../components/dashboard/KpiCards'
import TimeSeriesChart from '../components/dashboard/TimeSeriesChart'
import DimensionBreakdown from '../components/dashboard/DimensionBreakdown'
import { shortDate } from '../components/dashboard/format'
import AnomalyCard from '../components/mission/AnomalyCard'
import AuditLog from '../components/mission/AuditLog'
import LiveFeed from '../components/mission/LiveFeed'
import '../components/dashboard/dashboard.css'
import '../components/mission/mission.css'

const MAX_FEED = 40

export default function Demo() {
  const { demoId = '' } = useParams<{ demoId: string }>()

  const [model, setModel] = useState<SemanticModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'ingesting' | 'ready'>('ingesting')

  const [anomalyList, setAnomalyList] = useState<Anomaly[]>([])
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [pipeline, setPipeline] = useState<AgentEvent[]>([])
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set())

  // dashboard filters
  const [selectedKpiId, setSelectedKpiId] = useState('')
  const [selectedDimensionId, setSelectedDimensionId] = useState('')
  const [range, setRange] = useState<DateRange>({ start: '', end: '' })

  const missionRef = useRef<EventSource | null>(null)

  /* ---- load the demo model + anomalies + audit ---- */
  useEffect(() => {
    if (!demoId) return
    let alive = true
    demoGetModel(demoId)
      .then((m) => {
        if (!alive) return
        setModel(m)
        setSelectedKpiId(m.kpis[0]?.id ?? '')
        setSelectedDimensionId(m.dimensions[0]?.id ?? '')
        setRange({ start: m.dateRange.start, end: m.dateRange.end })
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'This demo has expired.'),
      )
    demoAnomalies(demoId)
      .then((a) => alive && setAnomalyList(a))
      .catch(() => undefined)
    demoAudit(demoId)
      .then((a) => alive && setAuditEntries(a))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [demoId])

  /* ---- run the ingest pipeline animation ---- */
  useEffect(() => {
    if (!demoId) return
    const reveal = () => setPhase('ready')
    const es = openDemoIngestStream(demoId, {
      onEvent: (evt) => setPipeline((prev) => [...prev, evt]),
      onDone: reveal,
      onError: () => undefined,
    })
    // Safety net: reveal even if the 'done' event is missed.
    const fallback = setTimeout(reveal, 11000)
    return () => {
      es.close()
      clearTimeout(fallback)
    }
  }, [demoId])

  /* ---- mission live feed once revealed ---- */
  useEffect(() => {
    if (phase !== 'ready' || !demoId) return
    const es = openDemoMissionStream(demoId, {
      onEvent: (evt) => {
        setConnected(true)
        setEvents((prev) => [evt, ...prev].slice(0, MAX_FEED))
      },
      onError: () => setConnected(false),
    })
    missionRef.current = es
    return () => {
      es.close()
      missionRef.current = null
      setConnected(false)
    }
  }, [phase, demoId])

  const selectedKpi = useMemo(
    () => model?.kpis.find((k) => k.id === selectedKpiId) ?? model?.kpis[0],
    [model, selectedKpiId],
  )
  const selectedDimension = useMemo(
    () =>
      model?.dimensions.find((d) => d.id === selectedDimensionId) ??
      model?.dimensions[0],
    [model, selectedDimensionId],
  )
  const seriesInRange = useMemo(() => {
    if (!selectedKpi) return []
    const { start, end } = range
    return selectedKpi.series.filter(
      (p) => (!start || p.date >= start) && (!end || p.date <= end),
    )
  }, [selectedKpi, range])
  const breakdown = useMemo(() => {
    if (!selectedKpi || !selectedDimension) return []
    return selectedKpi.byDimension[selectedDimension.id] ?? []
  }, [selectedKpi, selectedDimension])

  const handleApprove = useCallback(
    async (anomaly: Anomaly) => {
      const entry = await demoApprove(demoId, anomaly.id)
      setAuditEntries((prev) => [entry, ...prev])
      setApprovedIds((prev) => new Set(prev).add(anomaly.id))
    },
    [demoId],
  )

  function handleReset() {
    if (!model) return
    setSelectedKpiId(model.kpis[0]?.id ?? '')
    setSelectedDimensionId(model.dimensions[0]?.id ?? '')
    setRange({ start: model.dateRange.start, end: model.dateRange.end })
  }

  const kpiFormat = (kpiId: string) => model?.kpis.find((k) => k.id === kpiId)?.format

  if (error) {
    return (
      <main className="wrap">
        <div className="dl-dash__state">
          <h2>This demo has expired</h2>
          <p>{error}</p>
          <Link className="btn btn-primary" to="/#demo">
            Start a new demo
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="wrap dl-dash">
      <style>{demoStyles}</style>

      {/* demo banner */}
      <div className="demo-banner rounded-card">
        <div>
          <span className="eyebrow" style={{ color: 'var(--cyan)' }}>
            Live demo
          </span>
          <p>
            You're exploring DeepLogic on{' '}
            {model ? <strong>{model.name}</strong> : 'a sample model'}. Nothing is
            saved — sign up to connect your own data.
          </p>
        </div>
        <div className="demo-banner-cta">
          <Link className="btn btn-ghost" to="/#demo">
            Try another
          </Link>
          <Link className="btn btn-primary" to="/signup">
            Sign up free →
          </Link>
        </div>
      </div>

      {/* ingest pipeline animation */}
      {phase === 'ingesting' && (
        <section className="demo-pipeline rounded-card">
          <div className="demo-pipeline-head">
            <Logo size={34} title="DeepLogic" />
            <div>
              <span className="eyebrow">Generating your mission control</span>
              <h2>{model ? model.name : 'Reading the model…'}</h2>
            </div>
            <span className="mc-live">
              <span className="dot" /> working
            </span>
          </div>
          <div className="demo-pipeline-feed">
            {pipeline.length === 0 && (
              <div className="demo-pipe-row muted">Connecting to the agent crew…</div>
            )}
            {pipeline.map((e) => (
              <div className={`demo-pipe-row ${e.status}`} key={e.id}>
                <span className="demo-pipe-stage">{e.stage}</span>
                <span className="demo-pipe-msg">{e.message}</span>
                <span className="demo-pipe-status">{e.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* revealed dashboard + mission */}
      {phase === 'ready' && model && (
        <>
          <header className="dl-dash__header">
            <div className="dl-dash__title">
              <Logo size={40} className="mark" title="DeepLogic" />
              <div>
                <h1>{model.name}</h1>
                <div className="dl-dash__sub">
                  {model.source === 'sample' ? 'Sample model' : 'Uploaded model'} ·{' '}
                  {model.kpis.length} KPIs · {model.connectors.length} connectors ·{' '}
                  {shortDate(model.dateRange.start)} – {shortDate(model.dateRange.end)}
                </div>
              </div>
            </div>
          </header>

          <ConnectorsStrip connectors={model.connectors} />

          <Filters
            kpis={model.kpis}
            dimensions={model.dimensions}
            selectedKpiId={selectedKpi?.id ?? ''}
            selectedDimensionId={selectedDimension?.id ?? ''}
            range={range}
            bounds={{ start: model.dateRange.start, end: model.dateRange.end }}
            onKpiChange={setSelectedKpiId}
            onDimensionChange={setSelectedDimensionId}
            onRangeChange={setRange}
            onReset={handleReset}
          />

          <KpiCards
            kpis={model.kpis}
            selectedKpiId={selectedKpi?.id ?? ''}
            onSelect={setSelectedKpiId}
          />

          {selectedKpi && (
            <div className="dl-charts">
              <TimeSeriesChart kpi={selectedKpi} data={seriesInRange} />
              <DimensionBreakdown
                kpi={selectedKpi}
                dimensionName={selectedDimension?.name ?? 'segment'}
                data={breakdown}
              />
            </div>
          )}

          {/* mission control band */}
          <div className="demo-mc-head">
            <span className="eyebrow">Mission Control</span>
            <span className={`mc-live${connected ? '' : ' off'}`}>
              <span className="dot" />
              {connected ? 'Live' : 'Standby'}
            </span>
          </div>

          <div className="mc-grid">
            <div className="mc-col">
              <section>
                <div className="demo-alerts-head">
                  <span className="eyebrow">Anomaly Alerts</span>
                  <span style={{ fontSize: 12, color: 'var(--mut2)' }}>
                    {anomalyList.length} active
                  </span>
                </div>
                {anomalyList.length === 0 ? (
                  <div className="rounded-card mc-empty">
                    All KPIs nominal — no anomalies detected.
                  </div>
                ) : (
                  <div className="mc-alerts">
                    {anomalyList.map((a) => (
                      <AnomalyCard
                        key={a.id}
                        anomaly={a}
                        format={kpiFormat(a.kpiId)}
                        approved={approvedIds.has(a.id)}
                        onApprove={handleApprove}
                      />
                    ))}
                  </div>
                )}
              </section>

              <AskPanel demoId={demoId} modelId={demoId} />
            </div>

            <div className="mc-col">
              <LiveFeed events={events} connected={connected} />
              <AuditLog entries={auditEntries} />
            </div>
          </div>

          <div className="demo-bottom-cta rounded-card">
            <div>
              <h2>Run this on your own data.</h2>
              <p>Create a free workspace and connect your own data in minutes.</p>
            </div>
            <Link className="btn btn-primary" to="/signup">
              Sign up free →
            </Link>
          </div>
        </>
      )}
    </main>
  )
}

const demoStyles = `
.demo-banner {
  display: flex; align-items: center; justify-content: space-between; gap: 18px;
  padding: 16px 20px; margin: 18px 0;
  background: radial-gradient(600px 200px at 90% -40%, rgba(63,134,224,.16), transparent), var(--card);
}
.demo-banner p { color: var(--mut); font-size: 14px; margin-top: 2px; }
.demo-banner strong { color: var(--ink); }
.demo-banner-cta { display: flex; gap: 10px; flex: none; }

.demo-pipeline { padding: 22px; margin-bottom: 20px; }
.demo-pipeline-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.demo-pipeline-head h2 { font-size: 20px; }
.demo-pipeline-head .mc-live { margin-left: auto; }
.demo-pipeline-feed { display: flex; flex-direction: column; gap: 2px; }
.demo-pipe-row {
  display: grid; grid-template-columns: 110px 1fr auto; gap: 12px; align-items: center;
  padding: 10px 12px; border-bottom: 1px dashed var(--line); font-size: 13.5px;
  animation: demoFade .35s ease both;
}
.demo-pipe-row:last-child { border-bottom: 0; }
.demo-pipe-row.muted { color: var(--mut2); }
.demo-pipe-stage {
  font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700;
  color: var(--cyan);
}
.demo-pipe-msg { color: var(--ink); }
.demo-pipe-status { font-size: 11px; color: var(--mut); }
.demo-pipe-row.done .demo-pipe-status { color: #5fcf8a; }
.demo-pipe-row.alert .demo-pipe-status { color: #f6c552; }
@keyframes demoFade { from { opacity: 0; transform: translateY(4px); } }

.demo-mc-head { display: flex; align-items: center; justify-content: space-between; margin: 28px 0 14px; }
.demo-alerts-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }

.demo-bottom-cta {
  display: flex; align-items: center; justify-content: space-between; gap: 20px;
  padding: 26px; margin: 28px 0 12px;
  background: radial-gradient(600px 240px at 50% -60%, rgba(111,227,240,.14), transparent), var(--card);
}
.demo-bottom-cta h2 { font-size: 22px; }
.demo-bottom-cta p { color: var(--mut); margin-top: 4px; }
@media (max-width: 720px) {
  .demo-banner, .demo-bottom-cta { flex-direction: column; align-items: flex-start; }
  .demo-pipe-row { grid-template-columns: 88px 1fr; }
  .demo-pipe-status { display: none; }
}
`

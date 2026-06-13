// Mission Control — live agentic command center for one semantic model.
//
// Renders: KPI strip · live SSE agent feed · anomaly alert cards (with
// root-cause briefs + one-click approve → audit log) · Ask DeepLogic panel.
// Cleans up the EventSource on unmount.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import AskPanel from '../components/AskPanel'
import AnomalyCard from '../components/mission/AnomalyCard'
import AuditLog from '../components/mission/AuditLog'
import KpiStrip from '../components/mission/KpiStrip'
import LiveFeed from '../components/mission/LiveFeed'
import '../components/mission/mission.css'
import {
  anomalies as fetchAnomalies,
  approveAction,
  audit as fetchAudit,
  getModel,
  openMissionStream,
} from '../lib/api'
import type {
  AgentEvent,
  Anomaly,
  AuditEntry,
  SemanticModel,
} from '../types'

const MAX_FEED = 40

export default function Mission() {
  const { orgId = '', modelId } = useParams<{ orgId: string; modelId: string }>()
  const { getAccessToken } = useAuth()

  const [model, setModel] = useState<SemanticModel | null>(null)
  const [anomalyList, setAnomalyList] = useState<Anomaly[]>([])
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set())

  const esRef = useRef<EventSource | null>(null)

  /* ---------------- initial data load ---------------- */
  useEffect(() => {
    if (!modelId) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)

    getAccessToken()
      .then((token) => {
        if (!token) throw new Error('Your session has expired — please sign in again.')
        return Promise.all([
          getModel(token, orgId, modelId),
          fetchAnomalies(token, orgId, modelId).catch(() => [] as Anomaly[]),
          fetchAudit(token, orgId, modelId).catch(() => [] as AuditEntry[]),
        ])
      })
      .then(([m, a, au]) => {
        if (cancelled) return
        setModel(m)
        setAnomalyList(a)
        setAuditEntries(au)
        // Seed approved set from any audit entries referencing an anomaly id.
        const seeded = new Set<string>()
        for (const an of a) {
          if (au.some((e) => e.summary.includes(an.id))) seeded.add(an.id)
        }
        setApprovedIds(seeded)
      })
      .catch((err) => {
        if (!cancelled)
          setLoadError(
            err instanceof Error ? err.message : 'Failed to load model',
          )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [orgId, modelId, getAccessToken])

  /* ---------------- mission SSE stream ---------------- */
  useEffect(() => {
    if (!modelId) return

    let cancelled = false

    void getAccessToken().then((token) => {
      if (cancelled || !token) return
      const es = openMissionStream(token, orgId, modelId, {
        onEvent: (evt) => {
          setConnected(true)
          setEvents((prev) => [evt, ...prev].slice(0, MAX_FEED))
        },
        onError: () => setConnected(false),
      })
      esRef.current = es
    })

    return () => {
      cancelled = true
      esRef.current?.close()
      esRef.current = null
      setConnected(false)
    }
  }, [orgId, modelId, getAccessToken])

  /* ---------------- approve a recommendation ---------------- */
  const handleApprove = useCallback(
    async (anomaly: Anomaly) => {
      if (!modelId) return
      const token = await getAccessToken()
      if (!token) throw new Error('Your session has expired — please sign in again.')
      const entry = await approveAction(token, orgId, modelId, anomaly.id)
      setAuditEntries((prev) => [entry, ...prev])
      setApprovedIds((prev) => new Set(prev).add(anomaly.id))
    },
    [orgId, modelId, getAccessToken],
  )

  /* ---------------- render ---------------- */
  if (!modelId) {
    return (
      <main className="wrap">
        <div className="placeholder-panel">
          <span className="eyebrow">Mission Control</span>
          <h2>No model selected</h2>
          <p>
            Choose a model from{' '}
            <Link to={`/app/${orgId}/ingest`}>ingestion</Link> first.
          </p>
        </div>
      </main>
    )
  }

  const kpiFormat = (kpiId: string): 'currency' | 'percent' | 'number' | undefined =>
    model?.kpis.find((k) => k.id === kpiId)?.format

  return (
    <main className="wrap">
      <div className="mc-page">
        {/* header */}
        <div className="mc-head">
          <div>
            <span className="eyebrow">Mission Control</span>
            <h1>{model ? model.name : 'Loading…'}</h1>
            <div className="mc-sub">
              Always-on agent crew watching {model?.kpis.length ?? 0} KPIs
              {model && (
                <>
                  {' · '}
                  <Link
                    to={`/app/${orgId}/dashboard/${encodeURIComponent(modelId)}`}
                    style={{ color: 'var(--cyan)' }}
                  >
                    View dashboard →
                  </Link>
                </>
              )}
            </div>
          </div>
          <span className={`mc-live${connected ? '' : ' off'}`}>
            <span className="dot" />
            {connected ? 'Live' : 'Standby'}
          </span>
        </div>

        {loadError && (
          <div
            className="rounded-card"
            style={{ padding: 16, color: 'var(--bad)', marginBottom: 18 }}
          >
            {loadError}
          </div>
        )}

        {/* KPI strip */}
        {model && <KpiStrip kpis={model.kpis} />}

        {/* main two-column grid */}
        <div className="mc-grid">
          <div className="mc-col">
            {/* anomaly alerts */}
            <section>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <span className="eyebrow">Anomaly Alerts</span>
                <span style={{ fontSize: 12, color: 'var(--mut2)' }}>
                  {anomalyList.length} active
                </span>
              </div>

              {loading ? (
                <div className="mc-alerts">
                  <div className="mc-skel" />
                  <div className="mc-skel" />
                </div>
              ) : anomalyList.length === 0 ? (
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

            {/* Ask DeepLogic */}
            <AskPanel orgId={orgId} modelId={modelId} />
          </div>

          {/* right rail: live feed + audit log */}
          <div className="mc-col">
            <LiveFeed events={events} connected={connected} />
            <AuditLog entries={auditEntries} />
          </div>
        </div>
      </div>
    </main>
  )
}

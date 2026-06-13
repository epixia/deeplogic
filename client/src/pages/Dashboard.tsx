// Auto-generated dashboard for a semantic model (PRD §3.2, §4).
// Header (model name + connectors strip) · KPI cards · time-series chart for the
// selected KPI · dimension-breakdown bar chart · filters (KPI + dimension +
// date range). Embeds <AskPanel/> and links to Mission Control.

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { SemanticModel } from '../types'
import { getModel } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import AskPanel from '../components/AskPanel'
import Logo from '../components/Logo'
import ConnectorsStrip from '../components/dashboard/ConnectorsStrip'
import Filters, { type DateRange } from '../components/dashboard/Filters'
import KpiCards from '../components/dashboard/KpiCards'
import TimeSeriesChart from '../components/dashboard/TimeSeriesChart'
import DimensionBreakdown from '../components/dashboard/DimensionBreakdown'
import { shortDate } from '../components/dashboard/format'
import '../components/dashboard/dashboard.css'

export default function Dashboard() {
  const { orgId = '', modelId = '' } = useParams<{
    orgId: string
    modelId: string
  }>()
  const { getAccessToken } = useAuth()

  const [model, setModel] = useState<SemanticModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Filter state
  const [selectedKpiId, setSelectedKpiId] = useState('')
  const [selectedDimensionId, setSelectedDimensionId] = useState('')
  const [range, setRange] = useState<DateRange>({ start: '', end: '' })

  // ---- fetch the model ----
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    getAccessToken()
      .then((token) => {
        if (!token) throw new Error('Your session has expired — please sign in again.')
        return getModel(token, orgId, modelId)
      })
      .then((m) => {
        if (!alive) return
        setModel(m)
        setSelectedKpiId(m.kpis[0]?.id ?? '')
        setSelectedDimensionId(m.dimensions[0]?.id ?? '')
        setRange({ start: m.dateRange.start, end: m.dateRange.end })
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'Failed to load model.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [orgId, modelId, getAccessToken])

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

  // Filter the series by the active date range.
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

  function handleReset() {
    if (!model) return
    setSelectedKpiId(model.kpis[0]?.id ?? '')
    setSelectedDimensionId(model.dimensions[0]?.id ?? '')
    setRange({ start: model.dateRange.start, end: model.dateRange.end })
  }

  // ---- states ----
  if (loading) {
    return (
      <main className="wrap">
        <div className="dl-dash__state">
          <div className="dl-spinner" />
          <h2>Loading dashboard…</h2>
          <p>Resolving the semantic model and its KPIs.</p>
        </div>
      </main>
    )
  }

  if (error || !model) {
    return (
      <main className="wrap">
        <div className="dl-dash__state">
          <h2>Couldn’t load this model</h2>
          <p>{error ?? 'The requested model was not found.'}</p>
          <Link className="btn btn-primary" to={`/app/${orgId}/ingest`}>
            Back to ingestion
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="wrap dl-dash">
      {/* header */}
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
        <div className="dl-dash__actions">
          <Link className="btn btn-ghost" to={`/app/${orgId}/ingest`}>
            New ingestion
          </Link>
          <Link
            className="btn btn-primary"
            to={`/app/${orgId}/mission/${model.id}`}
          >
            Open Mission Control →
          </Link>
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

      <div className="dl-ask-slot">
        <AskPanel orgId={orgId} modelId={model.id} />
      </div>
    </main>
  )
}

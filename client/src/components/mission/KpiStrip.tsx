// Top KPI strip for Mission Control — value + signed delta per KPI.

import type { KPI } from '../../types'
import { deltaPct, formatValue, isGoodDelta } from './format'

interface KpiStripProps {
  kpis: KPI[]
}

export default function KpiStrip({ kpis }: KpiStripProps) {
  if (!kpis.length) return null

  return (
    <div className="mc-kpis">
      {kpis.map((kpi) => {
        const pct = deltaPct(kpi.current, kpi.previous)
        const good = isGoodDelta(kpi.current, kpi.previous, kpi.goodDirection)
        const arrow = kpi.current >= kpi.previous ? '▲' : '▼'
        return (
          <div className="mc-kpi" key={kpi.id}>
            <div className="k">{kpi.name}</div>
            <div className={`v${good ? ' up' : ''}`}>
              {formatValue(kpi.current, kpi.format)}
            </div>
            <div className={`d ${good ? 'good' : 'bad'}`}>
              {arrow} {Math.abs(pct).toFixed(1)}%
            </div>
          </div>
        )
      })}
    </div>
  )
}

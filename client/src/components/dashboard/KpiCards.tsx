// KPI card grid. Each card shows the formatted current value (KPI.format) and
// the delta vs previous, colored green/red by whether the move is "good" given
// goodDirection. Clicking a card selects it as the active series.

import type { KPI } from '../../types'
import { computeDelta, formatValue } from './format'

interface KpiCardsProps {
  kpis: KPI[]
  selectedKpiId: string
  onSelect: (id: string) => void
}

export default function KpiCards({
  kpis,
  selectedKpiId,
  onSelect,
}: KpiCardsProps) {
  return (
    <div className="dl-kpis">
      {kpis.map((kpi) => {
        const delta = computeDelta(kpi)
        const active = kpi.id === selectedKpiId
        return (
          <button
            type="button"
            key={kpi.id}
            className={`dl-kpi-card rounded-card${active ? ' is-active' : ''}`}
            onClick={() => onSelect(kpi.id)}
            aria-pressed={active}
          >
            <div className="dl-kpi-card__name">{kpi.name}</div>
            <div className="dl-kpi-card__value">
              {formatValue(kpi.current, kpi.format)}
            </div>
            <div
              className="dl-kpi-card__delta"
              style={{
                color: delta.isGood ? 'var(--good)' : 'var(--bad)',
              }}
            >
              {delta.label}
              <span className="dl-kpi-card__delta-cmp">
                {' '}
                vs {formatValue(kpi.previous, kpi.format)}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

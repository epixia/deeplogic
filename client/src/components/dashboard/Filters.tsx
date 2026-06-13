// Dashboard filter bar: KPI selector + dimension selector + date-range.
// Controlled component — parent owns the state.

import type { Dimension, KPI } from '../../types'

export interface DateRange {
  start: string
  end: string
}

interface FiltersProps {
  kpis: KPI[]
  dimensions: Dimension[]
  selectedKpiId: string
  selectedDimensionId: string
  range: DateRange
  bounds: DateRange
  onKpiChange: (id: string) => void
  onDimensionChange: (id: string) => void
  onRangeChange: (range: DateRange) => void
  onReset: () => void
}

export default function Filters({
  kpis,
  dimensions,
  selectedKpiId,
  selectedDimensionId,
  range,
  bounds,
  onKpiChange,
  onDimensionChange,
  onRangeChange,
  onReset,
}: FiltersProps) {
  return (
    <div className="dl-filters rounded-card">
      <div className="dl-filter">
        <label htmlFor="dl-f-kpi">KPI</label>
        <select
          id="dl-f-kpi"
          className="dl-select"
          value={selectedKpiId}
          onChange={(e) => onKpiChange(e.target.value)}
        >
          {kpis.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
      </div>

      <div className="dl-filter">
        <label htmlFor="dl-f-dim">Break down by</label>
        <select
          id="dl-f-dim"
          className="dl-select"
          value={selectedDimensionId}
          onChange={(e) => onDimensionChange(e.target.value)}
        >
          {dimensions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="dl-filter">
        <label htmlFor="dl-f-start">From</label>
        <input
          id="dl-f-start"
          type="date"
          className="dl-select"
          value={range.start}
          min={bounds.start}
          max={range.end}
          onChange={(e) => onRangeChange({ ...range, start: e.target.value })}
        />
      </div>

      <div className="dl-filter">
        <label htmlFor="dl-f-end">To</label>
        <input
          id="dl-f-end"
          type="date"
          className="dl-select"
          value={range.end}
          min={range.start}
          max={bounds.end}
          onChange={(e) => onRangeChange({ ...range, end: e.target.value })}
        />
      </div>

      <button type="button" className="btn btn-ghost dl-filters__reset" onClick={onReset}>
        Reset
      </button>
    </div>
  )
}

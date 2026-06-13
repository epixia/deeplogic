// Dimension-breakdown bar chart for the selected KPI + dimension.
// Horizontal bars (good for category labels), cyan->blue gradient fill.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { KPI } from '../../types'
import { formatValue } from './format'

interface DimensionBreakdownProps {
  kpi: KPI
  dimensionName: string
  data: { label: string; value: number }[]
}

let gid = 0

export default function DimensionBreakdown({
  kpi,
  dimensionName,
  data,
}: DimensionBreakdownProps) {
  const fillId = `dl-bar-${(gid += 1)}`
  // Sort descending by value so the dominant member reads first.
  const sorted = [...data].sort((a, b) => b.value - a.value)

  return (
    <div className="dl-chart-card rounded-card">
      <div className="dl-chart-card__head">
        <div>
          <span className="eyebrow">Breakdown</span>
          <h3 className="dl-chart-card__title">
            {kpi.name} by {dimensionName}
          </h3>
        </div>
        <div className="dl-chart-card__meta">
          {sorted.length} segment{sorted.length === 1 ? '' : 's'}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="dl-chart-empty">
          No breakdown available for this dimension.
        </div>
      ) : (
        <ResponsiveContainer
          width="100%"
          height={Math.max(220, sorted.length * 42)}
        >
          <BarChart
            layout="vertical"
            data={sorted}
            margin={{ top: 8, right: 20, left: 8, bottom: 4 }}
          >
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#6fe3f0" />
                <stop offset="55%" stopColor="#49a0e6" />
                <stop offset="100%" stopColor="#5560e8" />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--line)"
              horizontal={false}
            />
            <XAxis
              type="number"
              tickFormatter={(v: number) => formatValue(v, kpi.format)}
              tick={{ fill: 'var(--mut2)', fontSize: 11 }}
              stroke="var(--line)"
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fill: 'var(--mut)', fontSize: 12 }}
              stroke="var(--line)"
              width={120}
            />
            <Tooltip
              cursor={{ fill: 'rgba(111,227,240,0.06)' }}
              contentStyle={{
                background: 'var(--card2)',
                border: '1px solid var(--line)',
                borderRadius: 10,
                color: 'var(--ink)',
                fontSize: 13,
              }}
              formatter={(value) => [
                formatValue(Number(value), kpi.format),
                kpi.name,
              ]}
            />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={26}>
              {sorted.map((entry) => (
                <Cell key={entry.label} fill={`url(#${fillId})`} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

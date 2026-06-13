// Time-series chart for the selected KPI (Recharts). Cyan->blue gradient stroke
// matching the landing page --grad direction, with a soft area fill underneath.

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { KPI } from '../../types'
import { formatValue, shortDate } from './format'

interface TimeSeriesChartProps {
  kpi: KPI
  data: { date: string; value: number }[]
}

// Unique gradient ids so multiple charts don't collide.
let gid = 0

export default function TimeSeriesChart({ kpi, data }: TimeSeriesChartProps) {
  const idBase = `dl-ts-${(gid += 1)}`
  const strokeId = `${idBase}-stroke`
  const fillId = `${idBase}-fill`

  return (
    <div className="dl-chart-card rounded-card">
      <div className="dl-chart-card__head">
        <div>
          <span className="eyebrow">Trend</span>
          <h3 className="dl-chart-card__title">{kpi.name} over time</h3>
        </div>
        <div className="dl-chart-card__meta">
          {data.length} day{data.length === 1 ? '' : 's'}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="dl-chart-empty">No data points in the selected range.</div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart
            data={data}
            margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
          >
            <defs>
              {/* horizontal cyan -> blue gradient stroke (matches --grad) */}
              <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#6fe3f0" />
                <stop offset="45%" stopColor="#49a0e6" />
                <stop offset="100%" stopColor="#5560e8" />
              </linearGradient>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#49a0e6" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#49a0e6" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--line)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tick={{ fill: 'var(--mut2)', fontSize: 11 }}
              stroke="var(--line)"
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v: number) => formatValue(v, kpi.format)}
              tick={{ fill: 'var(--mut2)', fontSize: 11 }}
              stroke="var(--line)"
              width={64}
            />
            <Tooltip
              cursor={{ stroke: 'var(--cyan)', strokeWidth: 1, strokeOpacity: 0.4 }}
              contentStyle={{
                background: 'var(--card2)',
                border: '1px solid var(--line)',
                borderRadius: 10,
                color: 'var(--ink)',
                fontSize: 13,
              }}
              labelFormatter={(label) => shortDate(String(label))}
              formatter={(value) => [
                formatValue(Number(value), kpi.format),
                kpi.name,
              ]}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={`url(#${strokeId})`}
              strokeWidth={2.5}
              fill={`url(#${fillId})`}
              dot={false}
              activeDot={{ r: 4, fill: 'var(--cyan)', stroke: 'var(--bg)' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// TrendChart — a lightweight multi-line SVG chart for competitor public-interest
// series (Wikipedia pageviews). No chart library: a shared Y axis so series are
// directly comparable, a legend that's honest about which article was matched.

import { useMemo } from 'react'
import type { CompetitorTrends } from '../../lib/api'
import './trend-chart.css'

const COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#facc15', '#4ade80']
const W = 720
const H = 260
const PAD = { top: 16, right: 16, bottom: 34, left: 52 }

export default function TrendChart({ data }: { data: CompetitorTrends }) {
  const model = useMemo(() => {
    const withData = data.series.filter((s) => s.points.length > 0)
    const dates = Array.from(new Set(withData.flatMap((s) => s.points.map((p) => p.date)))).sort()
    const max = Math.max(1, ...withData.flatMap((s) => s.points.map((p) => p.value)))
    const x = (i: number) => PAD.left + (dates.length <= 1 ? 0 : (i / (dates.length - 1)) * (W - PAD.left - PAD.right))
    const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom)
    const lines = withData.map((s) => {
      const byDate = new Map(s.points.map((p) => [p.date, p.value]))
      const pts = dates
        .map((d, i) => (byDate.has(d) ? `${x(i)},${y(byDate.get(d)!)}` : null))
        .filter(Boolean)
        .join(' ')
      return { term: s.term, pts, last: s.points[s.points.length - 1]?.value ?? 0 }
    })
    return { dates, max, x, y, lines, withData }
  }, [data])

  const niceNum = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`)
  const fmtMonth = (d: string) => {
    const [yr, mo] = d.split('-')
    return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mo) - 1]} ’${yr.slice(2)}`
  }

  const matched = data.series.filter((s) => s.points.length > 0)
  const empty = data.series.filter((s) => s.points.length === 0)
  const ticks = [0, 0.5, 1].map((f) => Math.round(model.max * f))
  // Show ~6 x labels max
  const step = Math.max(1, Math.ceil(model.dates.length / 6))

  if (matched.length === 0) {
    return (
      <div className="tc-empty">
        No public-interest data found for these companies on Wikipedia. Smaller / private companies often have no article.
        {empty.length > 0 && <> Tried: {empty.map((s) => s.term).join(', ')}.</>}
      </div>
    )
  }

  return (
    <div className="tc">
      <svg className="tc-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Competitor interest over time">
        {/* gridlines + y labels */}
        {ticks.map((t, i) => {
          const yy = model.y(t)
          return (
            <g key={i}>
              <line className="tc-grid" x1={PAD.left} x2={W - PAD.right} y1={yy} y2={yy} />
              <text className="tc-ylabel" x={PAD.left - 8} y={yy + 4} textAnchor="end">{niceNum(t)}</text>
            </g>
          )
        })}
        {/* x labels */}
        {model.dates.map((d, i) =>
          i % step === 0 ? (
            <text className="tc-xlabel" key={d} x={model.x(i)} y={H - PAD.bottom + 20} textAnchor="middle">{fmtMonth(d)}</text>
          ) : null,
        )}
        {/* lines */}
        {model.lines.map((l, i) => (
          <polyline key={l.term} className="tc-line" points={l.pts} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} />
        ))}
      </svg>

      <ul className="tc-legend">
        {matched.map((s, i) => (
          <li key={s.term} className="tc-leg">
            <span className="tc-swatch" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="tc-leg-term">{s.term}</span>
            {s.title && s.title.toLowerCase() !== s.term.toLowerCase() && (
              <span className={`tc-leg-match ${s.confident ? '' : 'tc-leg-warn'}`} title={s.confident ? 'Matched Wikipedia article' : 'Best-guess match — verify'}>
                {s.confident ? `↳ ${s.title}` : `⚠ matched “${s.title}” — verify`}
              </span>
            )}
          </li>
        ))}
      </ul>

      {empty.length > 0 && (
        <p className="tc-note">No Wikipedia article found for: {empty.map((s) => s.term).join(', ')}.</p>
      )}
      <p className="tc-note tc-source">
        Source: {data.unit} (last {data.months} months). A free proxy for public interest — not actual website visits.
        Real traffic needs a paid provider (SimilarWeb / Semrush).
      </p>
    </div>
  )
}

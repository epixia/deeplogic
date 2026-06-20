// IntelTrafficChart — a compact single-series area chart of a domain's monthly
// estimated organic traffic (DataForSEO historical_rank_overview). No chart lib.

import { useMemo } from 'react'
import './intel-traffic-chart.css'

type Point = { date: string; organicTraffic: number | null; organicKeywords: number | null }

const W = 720
const H = 200
const PAD = { top: 14, right: 16, bottom: 28, left: 50 }

const niceNum = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : `${Math.round(n)}`
const fmtMonth = (d: string) => {
  const [yr, mo] = d.split('-')
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mo) - 1]} ’${yr.slice(2)}`
}

export default function IntelTrafficChart({ points }: { points: Point[] }) {
  const model = useMemo(() => {
    const pts = points.filter((p) => p.organicTraffic != null)
    const max = Math.max(1, ...pts.map((p) => p.organicTraffic ?? 0))
    const x = (i: number) => PAD.left + (pts.length <= 1 ? 0 : (i / (pts.length - 1)) * (W - PAD.left - PAD.right))
    const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom)
    const line = pts.map((p, i) => `${x(i)},${y(p.organicTraffic ?? 0)}`).join(' ')
    const area =
      pts.length > 0
        ? `${PAD.left},${y(0)} ${line} ${x(pts.length - 1)},${y(0)}`
        : ''
    return { pts, max, x, y, line, area }
  }, [points])

  if (model.pts.length < 2) {
    return <div className="itc-empty">Not enough history to chart yet — DataForSEO returned no monthly traffic series for this domain.</div>
  }

  const ticks = [0, 0.5, 1].map((f) => Math.round(model.max * f))
  const step = Math.max(1, Math.ceil(model.pts.length / 6))
  const last = model.pts[model.pts.length - 1]

  return (
    <div className="itc">
      <svg className="itc-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Estimated organic traffic over time">
        <defs>
          <linearGradient id="itc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => {
          const yy = model.y(t)
          return (
            <g key={i}>
              <line className="itc-grid" x1={PAD.left} x2={W - PAD.right} y1={yy} y2={yy} />
              <text className="itc-ylabel" x={PAD.left - 8} y={yy + 4} textAnchor="end">{niceNum(t)}</text>
            </g>
          )
        })}
        {model.pts.map((p, i) =>
          i % step === 0 ? (
            <text className="itc-xlabel" key={p.date} x={model.x(i)} y={H - PAD.bottom + 18} textAnchor="middle">{fmtMonth(p.date)}</text>
          ) : null,
        )}
        <polygon className="itc-area" points={model.area} fill="url(#itc-fill)" />
        <polyline className="itc-line" points={model.line} fill="none" stroke="#22d3ee" strokeWidth={2.5} />
      </svg>
      <p className="itc-foot">
        Latest: <strong>{niceNum(last.organicTraffic ?? 0)}</strong> est. organic visits/mo · {model.pts.length} months · DataForSEO
      </p>
    </div>
  )
}

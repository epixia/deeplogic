// Value / delta formatting helpers for the dashboard.
// Formats numbers according to a KPI's `format` field (PRD §6).

import type { KPI } from '../../types'

type Fmt = KPI['format']

/** Format a single value according to a KPI format. */
export function formatValue(value: number, format: Fmt): string {
  if (!Number.isFinite(value)) return '—'
  switch (format) {
    case 'currency':
      return formatCurrency(value)
    case 'percent':
      // values are stored as actual percentages (e.g. 2.3 => "2.3%")
      return `${trimNum(value, value % 1 === 0 ? 0 : 1)}%`
    case 'number':
    default:
      return formatCompactNumber(value)
  }
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}$${trimNum(abs / 1_000_000_000, 2)}B`
  if (abs >= 1_000_000) return `${sign}$${trimNum(abs / 1_000_000, 2)}M`
  if (abs >= 1_000) return `${sign}$${trimNum(abs / 1_000, 1)}K`
  return `${sign}$${trimNum(abs, abs % 1 === 0 ? 0 : 2)}`
}

function formatCompactNumber(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}${trimNum(abs / 1_000_000_000, 2)}B`
  if (abs >= 1_000_000) return `${sign}${trimNum(abs / 1_000_000, 2)}M`
  if (abs >= 1_000) return `${sign}${trimNum(abs / 1_000, 1)}k`
  return `${sign}${trimNum(abs, abs % 1 === 0 ? 0 : 1)}`
}

/** Round to n decimals and strip trailing zeros, with thousands separators. */
function trimNum(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(decimals))
  return rounded.toLocaleString('en-US', { maximumFractionDigits: decimals })
}

export interface DeltaInfo {
  /** Signed percentage change vs previous (e.g. +12.4). */
  pct: number
  /** Formatted label e.g. "▲ 12.4%" / "▼ 0.4%". */
  label: string
  /** 'up' | 'down' | 'flat' — direction of the raw change. */
  direction: 'up' | 'down' | 'flat'
  /** True if the change is good given KPI.goodDirection. */
  isGood: boolean
}

/** Compute delta vs previous and whether it is "good" given goodDirection. */
export function computeDelta(kpi: KPI): DeltaInfo {
  const { current, previous, goodDirection } = kpi
  const raw = current - previous
  const pct = previous !== 0 ? (raw / Math.abs(previous)) * 100 : 0
  const direction: DeltaInfo['direction'] =
    raw > 0.0000001 ? 'up' : raw < -0.0000001 ? 'down' : 'flat'

  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '—'
  const label =
    direction === 'flat'
      ? '▬ 0%'
      : `${arrow} ${trimNum(Math.abs(pct), Math.abs(pct) < 10 ? 1 : 0)}%`

  const isGood =
    direction === 'flat'
      ? true
      : goodDirection === 'up'
        ? direction === 'up'
        : direction === 'down'

  return { pct, label, direction, isGood }
}

/** Short, human date label for axes/tooltips. */
export function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

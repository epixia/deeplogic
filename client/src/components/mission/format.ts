// Shared value formatting helpers for Mission Control.

export type ValueFormat = 'currency' | 'percent' | 'number' | string | undefined

/** Format a numeric value per a KPI / answer format hint. */
export function formatValue(value: number, format: ValueFormat): string {
  if (value == null || Number.isNaN(value)) return '—'
  switch (format) {
    case 'currency':
      return formatCurrency(value)
    case 'percent':
      return `${trimNum(value)}%`
    default:
      return formatNumber(value)
  }
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${trimNum(value / 1_000_000)}M`
  if (abs >= 1_000) return `$${trimNum(value / 1_000)}k`
  return `$${trimNum(value)}`
}

function formatNumber(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${trimNum(value / 1_000_000)}M`
  if (abs >= 1_000) return `${trimNum(value / 1_000)}k`
  return trimNum(value)
}

function trimNum(value: number): string {
  // Up to 1 decimal place, no trailing zeros.
  return Number(value.toFixed(1)).toLocaleString('en-US')
}

/** Percent delta between current and previous (signed). */
export function deltaPct(current: number, previous: number): number {
  if (!previous) return 0
  return ((current - previous) / Math.abs(previous)) * 100
}

/** A delta is "good" when it moves in the KPI's good direction. */
export function isGoodDelta(
  current: number,
  previous: number,
  goodDirection: 'up' | 'down',
): boolean {
  const up = current >= previous
  return goodDirection === 'up' ? up : !up
}

/** Render an ISO timestamp as a compact local time string. */
export function formatTs(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Render an ISO date (yyyy-mm-dd) as a readable date. */
export function formatDate(date: string): string {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

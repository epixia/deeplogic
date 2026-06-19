import { Spinner } from '@deeplogic/ui'

export function Sizes() {
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
      <Spinner size="sm" />
      <Spinner size="md" />
      <Spinner size="lg" />
    </div>
  )
}

export function Inline() {
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 14, color: 'var(--mut)' }}>
      <Spinner size="sm" /> Analysing your business…
    </span>
  )
}

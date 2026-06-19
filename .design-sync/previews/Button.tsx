import { Button } from '@deeplogic/ui'

export function Primary() {
  return <Button variant="primary">Get Started →</Button>
}

export function Ghost() {
  return <Button variant="ghost">Cancel</Button>
}

export function Sizes() {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <Button variant="primary" size="xs">Extra small</Button>
      <Button variant="primary" size="sm">Small</Button>
      <Button variant="primary" size="md">Medium</Button>
    </div>
  )
}

export function Icon() {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <Button variant="icon" aria-label="Settings">⚙</Button>
      <Button variant="icon" aria-label="Refresh">↻</Button>
    </div>
  )
}

export function Loading() {
  return <Button variant="primary" loading>Saving…</Button>
}

export function Disabled() {
  return <Button variant="ghost" disabled>Unavailable</Button>
}

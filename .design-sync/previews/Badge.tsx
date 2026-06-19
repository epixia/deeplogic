import { Badge } from '@deeplogic/ui'

export function Tones() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Badge>Draft</Badge>
      <Badge tone="accent">New</Badge>
      <Badge tone="good">Active</Badge>
      <Badge tone="warn">Pending</Badge>
      <Badge tone="bad">Failed</Badge>
    </div>
  )
}

export function WithStatusDot() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Badge tone="good" dot>Running</Badge>
      <Badge tone="warn" dot>Provisioning</Badge>
      <Badge tone="bad" dot>Stopped</Badge>
    </div>
  )
}

export function Count() {
  return <Badge tone="accent">7 competitors</Badge>
}

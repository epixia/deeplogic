import { StatusPill } from '@deeplogic/ui'

// StatusPill is an alias of Badge — best read for live, changing status.
export function AgentStatus() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <StatusPill tone="warn" dot>Provisioning</StatusPill>
      <StatusPill tone="good" dot>Running</StatusPill>
      <StatusPill tone="bad" dot>Failed</StatusPill>
    </div>
  )
}

export function MissionStatus() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <StatusPill>Pending</StatusPill>
      <StatusPill tone="accent">On mission</StatusPill>
      <StatusPill tone="good">Complete</StatusPill>
    </div>
  )
}

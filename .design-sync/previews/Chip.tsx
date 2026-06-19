import { Chip } from '@deeplogic/ui'

export function Tags() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Chip>cannabis</Chip>
      <Chip>SaaS</Chip>
      <Chip>fintech</Chip>
    </div>
  )
}

export function Selectable() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Chip active onClick={() => {}}>Last 12 months</Chip>
      <Chip onClick={() => {}}>Last 30 days</Chip>
      <Chip onClick={() => {}}>All time</Chip>
    </div>
  )
}

export function Removable() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Chip onRemove={() => {}}>report.pbit</Chip>
      <Chip onRemove={() => {}}>sales.xlsx</Chip>
    </div>
  )
}

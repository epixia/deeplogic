import { Card, Badge, Button } from '@deeplogic/ui'

export function Basic() {
  return (
    <Card style={{ maxWidth: 320 }}>
      <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>Monthly revenue</h3>
      <p style={{ fontSize: 13, color: 'var(--mut)', margin: 0 }}>Up 12% versus last month across all regions.</p>
    </Card>
  )
}

export function WithHeader() {
  return (
    <Card padded style={{ maxWidth: 340 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: 14 }}>Lead outreach</strong>
        <Badge tone="good" dot>Running</Badge>
      </div>
      <p style={{ fontSize: 13, color: 'var(--mut)', margin: '0 0 14px' }}>Contacting 50 prospects this week.</p>
      <Button variant="ghost" size="sm">View agent</Button>
    </Card>
  )
}

export function Hoverable() {
  return (
    <Card hover style={{ maxWidth: 280 }}>
      <strong style={{ fontSize: 14 }}>Clickable card</strong>
      <p style={{ fontSize: 13, color: 'var(--mut)', margin: '6px 0 0' }}>Lifts and accents its border on hover.</p>
    </Card>
  )
}

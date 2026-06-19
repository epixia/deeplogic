import { Wrap, Card } from '@deeplogic/ui'

export function PageContainer() {
  return (
    <Wrap>
      <div style={{ border: '1px dashed var(--line)', borderRadius: 12, padding: 16 }}>
        <strong style={{ fontSize: 14 }}>Centered page content</strong>
        <p style={{ fontSize: 13, color: 'var(--mut)', margin: '6px 0 0' }}>
          Max-width 1140px with consistent gutters — the standard page shell.
        </p>
      </div>
    </Wrap>
  )
}

export function WithCards() {
  return (
    <Wrap>
      <div style={{ display: 'flex', gap: 12 }}>
        <Card style={{ flex: 1 }}><strong style={{ fontSize: 13 }}>Revenue</strong></Card>
        <Card style={{ flex: 1 }}><strong style={{ fontSize: 13 }}>Pipeline</strong></Card>
      </div>
    </Wrap>
  )
}

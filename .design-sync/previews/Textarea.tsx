import { Textarea } from '@deeplogic/ui'

export function WithLabel() {
  return (
    <Textarea
      label="Mission"
      placeholder="Reach out to 50 dispensary buyers and book demo calls."
      rows={3}
      style={{ minWidth: 320 }}
    />
  )
}

export function WithHint() {
  return (
    <Textarea
      label="Notes"
      hint="Positioning, strengths, weaknesses…"
      rows={3}
      defaultValue="Premium cannabis cultivator focused on the Quebec market."
      style={{ minWidth: 320 }}
    />
  )
}

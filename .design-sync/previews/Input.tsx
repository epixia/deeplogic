import { Input } from '@deeplogic/ui'

export function WithLabel() {
  return <Input label="Work email" type="email" placeholder="you@company.com" defaultValue="" style={{ minWidth: 280 }} />
}

export function WithHint() {
  return <Input label="Website" placeholder="yourcompany.com" hint="We'll read it to learn your business." style={{ minWidth: 280 }} />
}

export function Invalid() {
  return <Input label="Email" defaultValue="not-an-email" invalid hint="Enter a valid email address." style={{ minWidth: 280 }} />
}

export function Bare() {
  return <Input placeholder="Search…" style={{ minWidth: 240 }} />
}

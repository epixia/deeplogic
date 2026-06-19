import { Switch } from '@deeplogic/ui'

export function On() {
  return (
    <label style={{ display: 'inline-flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
      <Switch checked onChange={() => {}} label="Web research" />
      <span>Web research on</span>
    </label>
  )
}

export function Off() {
  return (
    <label style={{ display: 'inline-flex', gap: 10, alignItems: 'center', fontSize: 14, color: 'var(--mut)' }}>
      <Switch checked={false} onChange={() => {}} label="Web research" />
      <span>Web research off</span>
    </label>
  )
}

export function Disabled() {
  return <Switch checked onChange={() => {}} disabled label="Locked setting" />
}

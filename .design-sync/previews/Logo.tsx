import { Logo } from '@deeplogic/ui'

export function Sizes() {
  return (
    <div style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
      <Logo size={28} />
      <Logo size={44} />
      <Logo size={64} />
    </div>
  )
}

export function Lockup() {
  return (
    <div style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
      <Logo size={40} />
      <span style={{ fontWeight: 700, letterSpacing: '0.14em', fontSize: 22, color: 'var(--ink)' }}>DEEPLOGIC</span>
    </div>
  )
}

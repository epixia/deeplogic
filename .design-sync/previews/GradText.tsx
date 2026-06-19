import { GradText } from '@deeplogic/ui'

export function Heading() {
  return (
    <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' }}>
      Your <GradText>intelligence</GradText> is ready
    </h1>
  )
}

export function Inline() {
  return (
    <p style={{ fontSize: 16 }}>
      Turn reports into <GradText>agents</GradText> working for you 24/7.
    </p>
  )
}

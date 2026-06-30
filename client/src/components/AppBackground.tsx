// AppBackground — a lightweight, CSS-only ambient backdrop behind the whole app.
// Renders only when a background is enabled in Admin → Appearance (falling back
// from any per-device Settings choice). The specific canvas animations are
// replaced by a single GPU-composited drifting aurora (transform/opacity only,
// no canvas or requestAnimationFrame) so it can never block the main thread.

import { useEffect, useState } from 'react'
import { readBg, BG_EVENT } from '../lib/bgPrefs'

export default function AppBackground() {
  const [on, setOn] = useState(() => readBg() !== 'none')

  useEffect(() => {
    const sync = () => setOn(readBg() !== 'none')
    sync() // re-check once the platform appearance / per-device choice has loaded
    window.addEventListener(BG_EVENT, sync)
    return () => window.removeEventListener(BG_EVENT, sync)
  }, [])

  if (!on) return null
  return (
    <div className="dl-css-bg" aria-hidden>
      <span className="dl-css-bg-blob dl-css-bg-blob--1" />
      <span className="dl-css-bg-blob dl-css-bg-blob--2" />
      <span className="dl-css-bg-blob dl-css-bg-blob--3" />
    </div>
  )
}

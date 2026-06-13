// ReportThumb — a faithful, scaled-down live preview of a report's HTML, used as
// a card thumbnail. Renders the report at a fixed design width in a sandboxed
// iframe and CSS-scales it to the card. Respects the app's light/dark theme.

import { useEffect, useRef, useState } from 'react'
import { applyReportTheme, useAppTheme } from './reportTheme'

const DESIGN_W = 1280
const DESIGN_H = 800

export default function ReportThumb({ html }: { html: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.25)
  const theme = useAppTheme()

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      if (w > 0) setScale(w / DESIGN_W)
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    update()
    return () => ro.disconnect()
  }, [])

  if (!html?.trim()) {
    return (
      <div className="studio-thumb studio-thumb-empty">
        <span>No preview yet — prompt to generate it</span>
      </div>
    )
  }

  return (
    <div
      className="studio-thumb"
      ref={wrapRef}
      style={{ height: DESIGN_H * scale }}
    >
      <iframe
        className="studio-thumb-frame"
        title="report preview"
        srcDoc={applyReportTheme(html, theme)}
        sandbox=""
        loading="lazy"
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          transform: `scale(${scale})`,
        }}
      />
    </div>
  )
}

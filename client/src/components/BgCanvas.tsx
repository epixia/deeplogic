// BgCanvas — renders one ambient background animation into a canvas sized to its
// own element. Reused as the full-screen homepage backdrop and as the live
// preview tile in Admin → Appearance. Reads the brand accent (--cyan/--blue) so
// it always matches the theme; refreshes colour on skin/brand changes.

import { useEffect, useRef } from 'react'
import { type BgId } from '../lib/bgPrefs'
import { SKIN_EVENT, BRAND_EVENT } from '../styles/skins'

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}
function toRGB(color: string): [number, number, number] {
  try {
    const c = document.createElement('canvas').getContext('2d')!
    c.fillStyle = color; const hex = c.fillStyle as string
    if (hex.startsWith('#')) {
      const n = parseInt(hex.slice(1), 16)
      return hex.length === 7 ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [136, 170, 200]
    }
    const m = hex.match(/(\d+),\s*(\d+),\s*(\d+)/)
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [136, 170, 200]
  } catch { return [136, 170, 200] }
}

export default function BgCanvas({ bg, className }: { bg: BgId; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bgRef = useRef<BgId>(bg)
  bgRef.current = bg

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let W = 0, H = 0, raf = 0, t = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    let colors = { cyan: [111, 227, 240] as [number, number, number], blue: [63, 134, 224] as [number, number, number] }
    const refresh = () => { colors = { cyan: toRGB(cssVar('--cyan', '#6fe3f0')), blue: toRGB(cssVar('--blue', '#3f86e0')) } }
    refresh()

    type P = { x: number; y: number; vx: number; vy: number }
    type S = { x: number; y: number; z: number }
    let pts: P[] = [], stars: S[] = []
    function size() {
      const w = canvas.clientWidth || canvas.offsetWidth || 300
      const h = canvas.clientHeight || canvas.offsetHeight || 150
      if (w === W && h === H) return // ignore spurious ResizeObserver callbacks (no real change)
      W = w; H = h
      canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      pts = Array.from({ length: Math.min(80, Math.floor((W * H) / 16000)) }, () => ({
        x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
      }))
      stars = Array.from({ length: 200 }, () => ({ x: (Math.random() - 0.5) * W, y: (Math.random() - 0.5) * H, z: Math.random() * (W || 300) }))
    }
    size()

    function draw() {
      const mode = bgRef.current
      ctx.clearRect(0, 0, W, H)
      const { cyan, blue } = colors
      const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

      if (mode === 'network') {
        for (const p of pts) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1 }
        for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d2 = dx * dx + dy * dy
          if (d2 < 130 * 130) { ctx.strokeStyle = rgba(blue, 0.12 * (1 - Math.sqrt(d2) / 130)); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke() }
        }
        for (const p of pts) { ctx.fillStyle = rgba(cyan, 0.6); ctx.beginPath(); ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2); ctx.fill() }
      } else if (mode === 'waves') {
        t += 0.012
        for (let k = 0; k < 4; k++) {
          ctx.beginPath(); const amp = 18 + k * 12, base = H * (0.35 + k * 0.13)
          for (let x = 0; x <= W; x += 8) { const y = base + Math.sin(x * 0.006 + t + k * 0.9) * amp + Math.sin(x * 0.013 + t * 1.4) * (amp * 0.4); x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) }
          ctx.strokeStyle = rgba(k % 2 ? blue : cyan, 0.22 - k * 0.03); ctx.lineWidth = 1.5; ctx.stroke()
        }
      } else if (mode === 'orbs') {
        t += 0.005
        const blobs = [
          { x: 0.25 + Math.sin(t) * 0.12, y: 0.3 + Math.cos(t * 0.8) * 0.1, c: cyan, r: 0.34 },
          { x: 0.75 + Math.cos(t * 0.7) * 0.12, y: 0.65 + Math.sin(t * 0.9) * 0.1, c: blue, r: 0.40 },
          { x: 0.55 + Math.sin(t * 1.1) * 0.1, y: 0.2 + Math.cos(t) * 0.08, c: blue, r: 0.28 },
        ]
        for (const b of blobs) { const cx = b.x * W, cy = b.y * H, rad = b.r * Math.min(W, H); const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, rgba(b.c, 0.22)); g.addColorStop(1, rgba(b.c, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill() }
      } else if (mode === 'wavefield') {
        t += 0.02
        const cols = Math.min(40, Math.max(10, Math.floor(W / 28))), rows = 14, gw = W / (cols - 1)
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const nz = Math.sin(c * 0.45 + t + r * 0.3) * 0.5 + Math.sin(c * 0.21 - t * 1.3 + r * 0.5) * 0.3 + Math.sin(r * 0.4 + t * 0.7) * 0.2
          const y = H * 0.16 + r * (H * 0.66 / rows) + nz * (H * 0.04)
          ctx.fillStyle = rgba(c % 2 ? blue : cyan, 0.18 + (nz + 1) * 0.14)
          ctx.beginPath(); ctx.arc(c * gw, y, 1.6, 0, Math.PI * 2); ctx.fill()
        }
      } else if (mode === 'mesh') {
        t += 0.015
        const rows = 16
        for (let r = 0; r < rows; r++) {
          ctx.beginPath(); const baseY = H * 0.2 + r * (H * 0.62 / rows)
          for (let x = 0; x <= W; x += 10) { const y = baseY + Math.sin(x * 0.012 + t + r * 0.4) * (H * 0.03) + Math.sin(x * 0.025 - t * 1.2 + r * 0.2) * (H * 0.02); x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) }
          ctx.strokeStyle = rgba(r % 2 ? blue : cyan, 0.16); ctx.lineWidth = 1; ctx.stroke()
        }
      } else if (mode === 'starfield') {
        for (const s of stars) {
          s.z -= 2.4
          if (s.z <= 1) { s.x = (Math.random() - 0.5) * W; s.y = (Math.random() - 0.5) * H; s.z = W || 300 }
          const k = 130 / s.z, px = W / 2 + s.x * k, py = H / 2 + s.y * k
          if (px < 0 || px > W || py < 0 || py > H) continue
          const depth = 1 - s.z / (W || 300)
          ctx.fillStyle = rgba(depth > 0.5 ? cyan : blue, Math.min(0.7, depth)); ctx.beginPath(); ctx.arc(px, py, Math.max(0.4, depth * 2.2), 0, Math.PI * 2); ctx.fill()
        }
      }
    }
    // Throttle to ~30fps (plenty for a subtle backdrop) and pause when the tab
    // is hidden — keeps the rAF handler cheap instead of running hot at 60fps.
    const FRAME_MS = 1000 / 30
    let last = 0
    function loop(now: number) {
      raf = requestAnimationFrame(loop)
      if (now - last < FRAME_MS) return
      last = now
      draw()
    }
    function start() { if (bgRef.current !== 'none' && !raf) raf = requestAnimationFrame(loop) }
    function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0 } }
    const onVis = () => { if (document.hidden) stop(); else start() }
    document.addEventListener('visibilitychange', onVis)
    start()

    const ro = new ResizeObserver(() => size())
    ro.observe(canvas)
    window.addEventListener(SKIN_EVENT, refresh)
    window.addEventListener(BRAND_EVENT, refresh)
    return () => { stop(); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); window.removeEventListener(SKIN_EVENT, refresh); window.removeEventListener(BRAND_EVENT, refresh) }
  }, [bg])

  return <canvas ref={canvasRef} className={className} aria-hidden />
}

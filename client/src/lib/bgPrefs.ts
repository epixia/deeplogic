// Animated background preference — a per-device choice of decorative canvas
// animation rendered behind the whole app. All animations read the active brand
// accent (--cyan / --blue) so they respect the chosen theme colour.

export type BgId = 'none' | 'network' | 'waves' | 'orbs' | 'wavefield' | 'mesh' | 'starfield'

export const BG_OPTIONS: { id: BgId; label: string; description: string }[] = [
  { id: 'none', label: 'None', description: 'Plain background — no animation.' },
  { id: 'network', label: 'Neural Network', description: 'Connected dots & lines drifting — big-data vibe.' },
  { id: 'waves', label: 'Waves', description: 'Soft flowing wave lines across the screen.' },
  { id: 'orbs', label: 'Aurora Orbs', description: 'Slow floating glow blobs in your accent colour.' },
  { id: 'wavefield', label: 'Wave Field', description: 'A field of dots rolling on value-noise waves.' },
  { id: 'mesh', label: 'Flow Mesh', description: 'Flowing wireframe lines, like a noise terrain.' },
  { id: 'starfield', label: 'Starfield', description: 'Particles drifting outward through space.' },
]

const BG_KEY = 'dl-bg'
export const BG_EVENT = 'dl-bg-change'
export const DEFAULT_BG: BgId = 'none'
const IDS: BgId[] = ['none', 'network', 'waves', 'orbs']

// The admin-set global default (homepage / platform-wide). A per-device choice
// (localStorage) overrides it; otherwise the global applies.
let globalBg: BgId | null = null
export function setGlobalBg(id: BgId): void {
  globalBg = (IDS as string[]).includes(id) ? id : 'none'
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BG_EVENT))
}

export function readBg(): BgId {
  try { const v = localStorage.getItem(BG_KEY); if (v && (IDS as string[]).includes(v)) return v as BgId } catch { /* ignore */ }
  return globalBg ?? DEFAULT_BG
}

export function saveBg(id: BgId): void {
  try { localStorage.setItem(BG_KEY, id) } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BG_EVENT))
}

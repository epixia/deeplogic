// Skins — named palettes that re-style the whole platform (and generated
// widgets/reports) for BOTH light and dark mode. A skin overrides the design
// tokens from theme.css by setting CSS variables inline on <html>; generated
// content reads the active skin via skinFrameCss() so it stays consistent.
//
// Persisted per-device in localStorage. Adding a skin = add an entry to SKINS.

export type ThemeMode = 'dark' | 'light'

export interface Palette {
  bg: string; bg2: string; card: string; card2: string; line: string
  cyan: string; blue: string; ink: string; mut: string; mut2: string
  grad: string; good: string; warn: string; bad: string
}

export interface Skin {
  id: string
  label: string
  description: string
  swatch: { bg: string; card: string; accent: string; ink: string }
  dark: Palette
  light: Palette
}

export const SKINS: Skin[] = [
  {
    id: 'aurora',
    label: 'Aurora',
    description: 'The signature DeepLogic blue — vivid cyan-to-indigo gradient.',
    swatch: { bg: '#070b12', card: '#0e1726', accent: '#6fe3f0', ink: '#eaf3fb' },
    dark: {
      bg: '#070b12', bg2: '#0b1220', card: '#0e1726', card2: '#101c30',
      line: 'rgba(120,180,220,0.14)', cyan: '#6fe3f0', blue: '#3f86e0',
      ink: '#eaf3fb', mut: '#8ea3b8', mut2: '#6b7e92',
      grad: 'linear-gradient(120deg,#6fe3f0 0%,#49a0e6 45%,#5560e8 100%)',
      good: '#5fcf8a', warn: '#febc2e', bad: '#ff5f57',
    },
    light: {
      bg: '#faf9f8', bg2: '#ffffff', card: '#ffffff', card2: '#f3f2f1',
      line: '#e1dfdd', cyan: '#0f6cbd', blue: '#0078d4',
      ink: '#201f1e', mut: '#605e5c', mut2: '#8a8886',
      grad: 'linear-gradient(120deg,#6fe3f0 0%,#49a0e6 45%,#5560e8 100%)',
      good: '#107c41', warn: '#c19c00', bad: '#d13438',
    },
  },
  {
    id: 'slate',
    label: 'Slate Minimal',
    description: 'Calm, low-saturation slate grays with a soft steel-blue accent.',
    swatch: { bg: '#0c0e12', card: '#16191f', accent: '#8fa6c4', ink: '#e6e8ec' },
    dark: {
      bg: '#0c0e12', bg2: '#13161c', card: '#16191f', card2: '#1b1f27',
      line: 'rgba(160,170,185,0.12)', cyan: '#8fa6c4', blue: '#6b7f9e',
      ink: '#e6e8ec', mut: '#9aa3b0', mut2: '#6b7280',
      // Flat grey — slate is intentionally minimal, no gradient.
      grad: 'linear-gradient(0deg,#aeb9c9,#aeb9c9)',
      good: '#7fb98a', warn: '#d6b25e', bad: '#d98a8a',
    },
    light: {
      bg: '#e3e5ea', bg2: '#ffffff', card: '#ffffff', card2: '#f1f3f5',
      line: '#e3e6ea', cyan: '#3f5670', blue: '#4a6080',
      ink: '#1f2329', mut: '#5b6370', mut2: '#8b929c',
      grad: 'linear-gradient(0deg,#5b6f8c,#5b6f8c)',
      good: '#3f7a4e', warn: '#9a7b2e', bad: '#b5575b',
    },
  },
]

export const DEFAULT_SKIN = 'aurora'
const SKIN_KEY = 'dl-skin'
export const SKIN_EVENT = 'dl-skin-change'

export function getSkin(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0]
}

// Admin-set global default skin (DB-stored; applies to the public site & as the
// platform default). A per-device choice overrides it; otherwise the global wins.
let globalSkin: string | null = null
export function setGlobalSkin(id: string): void {
  globalSkin = SKINS.some((s) => s.id === id) ? id : DEFAULT_SKIN
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SKIN_EVENT))
}

export function readSkin(): string {
  try {
    const v = localStorage.getItem(SKIN_KEY)
    if (v && SKINS.some((s) => s.id === v)) return v
  } catch { /* ignore */ }
  return globalSkin ?? DEFAULT_SKIN
}

export function saveSkin(id: string): void {
  try { localStorage.setItem(SKIN_KEY, id) } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SKIN_EVENT))
}

// --- Branding: accent + logo colour, layered on top of the active skin ---
export type BrandId = 'blue' | 'green' | 'grey'
const BRAND_KEY = 'dl-brand'
export const BRAND_EVENT = 'dl-brand-change'
export const DEFAULT_BRAND: BrandId = 'blue'
const BRAND_IDS: BrandId[] = ['blue', 'green', 'grey']

export const BRANDS: { id: BrandId; label: string; description: string; swatch: string }[] = [
  { id: 'blue', label: 'Blue', description: 'The signature DeepLogic blue accent & logo.', swatch: '#3f86e0' },
  { id: 'green', label: 'Green', description: 'A fresh green accent & logo.', swatch: '#16a34a' },
  { id: 'grey', label: 'Light Grey', description: 'A calm, minimalist neutral-grey accent & logo.', swatch: '#9aa7b8' },
]

type Accent = { cyan: string; blue: string; grad: string }
// Accent + logo gradient per brand & theme — applied on top of any skin so the
// accent stays consistent (e.g. Blue is the vivid Aurora blue even in Slate).
const ACCENTS: Record<BrandId, Record<ThemeMode, Accent>> = {
  blue: {
    dark: { cyan: '#6fe3f0', blue: '#3f86e0', grad: 'linear-gradient(120deg,#6fe3f0 0%,#49a0e6 45%,#5560e8 100%)' },
    light: { cyan: '#0f6cbd', blue: '#0078d4', grad: 'linear-gradient(120deg,#6fe3f0 0%,#49a0e6 45%,#5560e8 100%)' },
  },
  green: {
    dark: { cyan: '#5fe3b0', blue: '#34d399', grad: 'linear-gradient(120deg,#5fe3b0 0%,#34d399 45%,#10b981 100%)' },
    light: { cyan: '#0f7a3d', blue: '#16a34a', grad: 'linear-gradient(120deg,#34d399 0%,#16a34a 45%,#0e7a3a 100%)' },
  },
  grey: {
    dark: { cyan: '#cdd5e0', blue: '#9aa7b8', grad: 'linear-gradient(120deg,#dbe1ea 0%,#aab4c2 50%,#8b97a8 100%)' },
    light: { cyan: '#6b7280', blue: '#8a93a3', grad: 'linear-gradient(120deg,#aab4c2 0%,#6b7280 100%)' },
  },
}
function accentFor(brand: BrandId, theme: ThemeMode): Accent {
  return ACCENTS[brand]?.[theme] ?? ACCENTS.blue[theme]
}

// Admin-set global default brand (homepage / platform-wide). A per-device choice
// overrides it; otherwise the global applies.
let globalBrand: BrandId | null = null
export function setGlobalBrand(id: BrandId): void {
  globalBrand = (BRAND_IDS as string[]).includes(id) ? id : 'blue'
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BRAND_EVENT))
}

export function readBrand(): BrandId {
  try { const v = localStorage.getItem(BRAND_KEY); if (v && (BRAND_IDS as string[]).includes(v)) return v as BrandId } catch { /* ignore */ }
  return globalBrand ?? DEFAULT_BRAND
}

export function saveBrand(id: BrandId): void {
  try { localStorage.setItem(BRAND_KEY, id) } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BRAND_EVENT))
}

/** Override accent + logo CSS variables for the chosen brand (run after applySkin). */
export function applyBrand(brand: BrandId, theme: ThemeMode): void {
  if (typeof document === 'undefined') return
  const a = accentFor(brand, theme)
  const root = document.documentElement
  root.style.setProperty('--cyan', a.cyan)
  root.style.setProperty('--blue', a.blue)
  root.style.setProperty('--grad', a.grad)
  root.setAttribute('data-brand', brand)
}

/** Override the platform CSS variables on <html> for the given skin + theme. */
export function applySkin(skinId: string, theme: ThemeMode): void {
  if (typeof document === 'undefined') return
  const p = theme === 'light' ? getSkin(skinId).light : getSkin(skinId).dark
  const root = document.documentElement
  for (const [k, v] of Object.entries(p)) root.style.setProperty(`--${k}`, v)
  // Expose the skin id so CSS can target skin-specific tweaks (e.g. flat glow).
  root.setAttribute('data-skin', skinId)
}

/** CSS (both themes) for the active skin — injected into generated-content iframes. */
export function skinFrameCss(): string {
  const skin = getSkin(readSkin())
  const brand = readBrand()
  const block = (p: Palette, theme: ThemeMode) => {
    let s = Object.entries(p).map(([k, v]) => `--${k}:${v}`).join(';')
    const a = accentFor(brand, theme)
    if (a) s += `;--cyan:${a.cyan};--blue:${a.blue};--grad:${a.grad}`
    return s
  }
  return `:root{${block(skin.dark, 'dark')}} html[data-theme="light"]{${block(skin.light, 'light')}}`
}

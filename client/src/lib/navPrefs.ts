// Header navigation preferences — which org pages show in the top nav. Stored
// per-device in localStorage (like the skin), toggled in Settings → Appearance.
// Nav and Settings stay in sync via a window event.

export interface NavItemDef {
  key: string
  label: string
  path: string // suffix appended to /app/:orgId
}

// The full set of org pages, in nav order. Hiding one only removes it from the
// header — the route still works if visited directly.
export const NAV_ITEMS: NavItemDef[] = [
  { key: 'dashboards', label: 'Dashboards', path: '/dashboards/manage' },
  { key: 'reports', label: 'Reports', path: '/studio' },
  { key: 'innovation', label: 'Innovation', path: '/innovation' },
  { key: 'blocks', label: 'Blocks', path: '/widgets' },
  { key: 'alerts', label: 'Alerts', path: '/alerts' },
  { key: 'agents', label: 'Agents', path: '/agents' },
  { key: 'goals', label: 'Goals', path: '/goals' },
  { key: 'activity', label: 'Activity', path: '/activity' },
  { key: 'connectors', label: 'Connectors', path: '/connectors' },
  { key: 'datavault', label: 'DataVault', path: '/vault' },
  { key: 'company', label: 'Company', path: '/company' },
  { key: 'competitors', label: 'Competitors', path: '/competitors' },
  { key: 'memory', label: 'Memory', path: '/memory' },
  { key: 'interview', label: 'Interview', path: '/interview' },
]

const KEY = 'dl-nav-hidden'
export const NAV_PREFS_EVENT = 'dl-nav-prefs'

export function readHiddenNav(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export function saveHiddenNav(hidden: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...hidden]))
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(NAV_PREFS_EVENT))
}

// ---- Header order (drag-to-reorder) ----

const ORDER_KEY = 'dl-nav-order'

// Stored order, validated against known items, with any new pages appended.
export function readNavOrder(): string[] {
  let stored: string[] = []
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    stored = raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    stored = []
  }
  const known = new Set(NAV_ITEMS.map((i) => i.key))
  const ordered = stored.filter((k) => known.has(k))
  for (const it of NAV_ITEMS) if (!ordered.includes(it.key)) ordered.push(it.key)
  return ordered
}

export function saveNavOrder(order: string[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order))
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(NAV_PREFS_EVENT))
}

// The nav items to render: in the saved order, minus hidden ones.
export function orderedVisibleNav(order: string[], hidden: Set<string>): NavItemDef[] {
  const byKey = new Map(NAV_ITEMS.map((i) => [i.key, i]))
  return order
    .map((k) => byKey.get(k))
    .filter((i): i is NavItemDef => !!i && !hidden.has(i.key))
}

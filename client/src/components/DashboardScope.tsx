// DashboardScope — a per-page "which dashboard am I working in" selector, used
// to isolate the Widgets and Reports lists by dashboard. The chosen scope is
// remembered per org in localStorage. "All dashboards" shows everything.

import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { listDashboards, type DashboardListItem } from '../lib/api'

export const ALL_SCOPE = 'all'

/** Persisted (per org) dashboard scope. */
export function useDashboardScope(orgId: string): [string, (v: string) => void] {
  const key = `dl-scope-${orgId}`
  const [scope, setScopeState] = useState<string>(() => {
    try { return localStorage.getItem(key) || ALL_SCOPE } catch { return ALL_SCOPE }
  })
  const setScope = (v: string) => {
    setScopeState(v)
    try { localStorage.setItem(key, v) } catch { /* ignore */ }
  }
  return [scope, setScope]
}

export default function DashboardScopeBar({
  orgId,
  scope,
  onChange,
  noun = 'items',
}: {
  orgId: string
  scope: string
  onChange: (v: string) => void
  /** Plural noun for the helper text, e.g. "widgets" / "reports". */
  noun?: string
}) {
  const { getAccessToken } = useAuth()
  const [boards, setBoards] = useState<DashboardListItem[]>([])

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const t = await getAccessToken()
        if (!t || !active) return
        const list = await listDashboards(t, orgId)
        if (active) setBoards(list)
      } catch { /* ignore */ }
    })()
    return () => { active = false }
  }, [orgId, getAccessToken])

  // Group by dashboard group (Company first), ungrouped → Company.
  const groups = new Map<string, DashboardListItem[]>()
  for (const b of boards) {
    const g = b.group?.trim() || 'Company'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(b)
  }
  const order = (g: string) => (g === 'Company' ? 0 : 1)
  const grouped = [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))

  return (
    <div className="dl-scopebar">
      <span className="dl-scopebar-label">Show {noun} for</span>
      <select
        className="dl-scopebar-select"
        value={scope}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Filter ${noun} by dashboard`}
      >
        <option value={ALL_SCOPE}>All dashboards</option>
        {grouped.map(([g, items]) => (
          <optgroup key={g} label={g}>
            {items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

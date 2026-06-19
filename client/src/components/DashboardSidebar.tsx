// DashboardSidebar — left-hand navigation for the dashboard view. Lists the
// org's dashboards grouped under collapsible parent groups (Company first,
// Competitors next, custom groups, then ungrouped). The active dashboard is
// highlighted; clicking a dashboard navigates to it. Per-group collapse state
// is remembered per org in localStorage.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { listDashboards, type DashboardListItem } from '../lib/api'
import './dashboard-sidebar.css'

const GROUP_ICON: Record<string, string> = { Company: '🏢', Competitors: '⚔', Competitor: '⚔' }
const groupIcon = (g: string) => GROUP_ICON[g] ?? '▦'

export default function DashboardSidebar({
  orgId,
  activeId,
  refreshKey,
}: {
  orgId: string
  activeId?: string
  /** Bump to force a reload (e.g. after a board's group changes). */
  refreshKey?: string | number
}) {
  const { getAccessToken } = useAuth()
  const navigate = useNavigate()
  const [boards, setBoards] = useState<DashboardListItem[]>([])

  // Collapsed group names, remembered per org.
  const collapseKey = `dl-dashgroups-collapsed-${orgId}`
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(collapseKey)
      return new Set<string>(raw ? (JSON.parse(raw) as string[]) : [])
    } catch { return new Set() }
  })
  const toggleGroup = (g: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g); else next.add(g)
      try { localStorage.setItem(collapseKey, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  useEffect(() => {
    if (!orgId) return
    let active = true
    ;(async () => {
      try {
        const token = await getAccessToken()
        if (!token || !active) return
        const list = await listDashboards(token, orgId)
        if (active) setBoards(list)
      } catch { /* ignore */ }
    })()
    return () => { active = false }
  }, [orgId, getAccessToken, refreshKey])

  // Group; order Company first, custom groups next, ungrouped ("Other") last.
  const grouped = useMemo(() => {
    const map = new Map<string, DashboardListItem[]>()
    for (const b of boards) {
      const key = b.group?.trim() || 'Company'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(b)
    }
    const order = (g: string) => (g === 'Company' ? 0 : g === 'Other' ? 2 : 1)
    return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
  }, [boards])

  if (boards.length === 0) return null

  return (
    <aside className="dbsb">
      <div className="dbsb-head">
        Dashboards
        <Link className="dbsb-manage" to={`/app/${orgId}/dashboards/manage`} title="Add, organise or delete dashboards">Manage</Link>
      </div>
      <nav className="dbsb-groups">
        {grouped.map(([group, items]) => {
          const isCollapsed = collapsed.has(group)
          return (
            <div className="dbsb-group" key={group}>
              <button
                type="button"
                className="dbsb-group-head"
                onClick={() => toggleGroup(group)}
                aria-expanded={!isCollapsed}
              >
                <span className={`dbsb-chev${isCollapsed ? '' : ' open'}`} aria-hidden>▸</span>
                <span className="dbsb-group-icon" aria-hidden>{groupIcon(group)}</span>
                <span className="dbsb-group-name">{group}</span>
                <span className="dbsb-group-count">{items.length}</span>
              </button>
              {!isCollapsed && (
                <ul className="dbsb-items">
                  {items.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        className={`dbsb-item${b.id === activeId ? ' active' : ''}`}
                        onClick={() => { if (b.id !== activeId) navigate(`/app/${orgId}/dashboards/${b.id}`) }}
                        title={b.name}
                      >
                        <span className="dbsb-item-name">{b.name}</span>
                        <span className="dbsb-item-count">{b.widgetCount}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}

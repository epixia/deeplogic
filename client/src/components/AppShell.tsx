// AppShell — layout for all org-scoped pages: a persistent left dashboard
// sidebar + the routed page content. The sidebar derives the active org and
// dashboard from the URL, so it's visible (and in-context) on every page.

import { Outlet, useLocation } from 'react-router-dom'
import DashboardSidebar from './DashboardSidebar'
import './app-shell.css'

export default function AppShell() {
  const { pathname } = useLocation()
  const orgId = pathname.match(/^\/app\/([^/]+)/)?.[1]
  const dashId = pathname.match(/^\/app\/[^/]+\/dashboards\/([^/]+)/)?.[1]

  return (
    <div className="app-shell">
      {orgId && <DashboardSidebar orgId={orgId} activeId={dashId} refreshKey={pathname} />}
      <div className="app-shell-main">
        <Outlet />
      </div>
    </div>
  )
}

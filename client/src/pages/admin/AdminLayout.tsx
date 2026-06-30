// Admin shell — sidebar nav + main content area.
// Wrap each admin page with this component.

import { type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import './admin.css'

interface Props { children: ReactNode }

const NAV = [
  { to: '/admin',        label: 'Dashboard' },
  { to: '/admin/orgs',   label: 'Organizations' },
  { to: '/admin/users',  label: 'Users' },
  { to: '/admin/blocks', label: 'Blocks' },
  { to: '/admin/block-builder', label: 'Block Builder' },
  { to: '/admin/mail', label: 'Mail Server' },
  { to: '/admin/integrations', label: 'Integrations' },
  { to: '/admin/appearance', label: 'Appearance' },
  { to: '/admin/cannara-demo', label: '🌿 Cannara Demo ↗', newTab: true },
]

export default function AdminLayout({ children }: Props) {
  const { pathname } = useLocation()

  function isActive(to: string) {
    if (to === '/admin') return pathname === '/admin'
    return pathname.startsWith(to)
  }

  return (
    <div className="dl-admin">
      <aside className="dl-admin__sidebar">
        <div className="dl-admin__sidebar-label">Admin</div>
        {NAV.map((n) => (
          n.newTab ? (
            <a key={n.to} href={n.to} target="_blank" rel="noopener noreferrer" className="dl-admin__nav-link">
              {n.label}
            </a>
          ) : (
            <Link
              key={n.to}
              to={n.to}
              className={`dl-admin__nav-link${isActive(n.to) ? ' active' : ''}`}
            >
              {n.label}
            </Link>
          )
        ))}
        <div style={{ marginTop: 'auto', paddingTop: 24 }}>
          <Link to="/app" className="dl-admin__nav-link" style={{ fontSize: 13 }}>
            ← Back to app
          </Link>
        </div>
      </aside>

      <main className="dl-admin__main">{children}</main>
    </div>
  )
}

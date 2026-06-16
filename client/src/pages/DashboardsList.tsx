import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { listDashboards, createDashboard } from '../lib/api'
import '../components/studio/studio.css'

export default function DashboardsList() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken, orgs } = useAuth()
  const navigate = useNavigate()
  const orgName = orgs.find((o) => o.id === orgId)?.name ?? 'Dashboard'

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const token = await getAccessToken()
        if (!token || !active) return
        const boards = await listDashboards(token, orgId)
        let board = boards[0]
        if (!board) {
          board = await createDashboard(token, orgId, { name: orgName })
        }
        if (active) navigate(`/app/${orgId}/dashboards/${board.id}`, { replace: true })
      } catch (e) {
        console.error(e)
      }
    })()
    return () => { active = false }
  }, [orgId, orgName, getAccessToken, navigate])

  return (
    <main className="wrap studio">
      <div className="studio-empty">Loading dashboard…</div>
    </main>
  )
}

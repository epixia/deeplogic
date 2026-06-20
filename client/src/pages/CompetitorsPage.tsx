// Competitors — top-level page (header nav). Wraps the Competitors manager that
// also appears as the Data Vault → ⚔ Competitors tab, so tracked rivals and
// their DataForSEO SEO metrics get a dedicated destination.

import { useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import Competitors from '../components/vault/Competitors'

export default function CompetitorsPage() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()

  const getToken = async () => {
    const t = await getAccessToken()
    if (!t) throw new Error('Session expired — please sign in again.')
    return t
  }

  return (
    <main className="wrap cp-fullwidth">
      <Competitors orgId={orgId} getToken={getToken} />
    </main>
  )
}

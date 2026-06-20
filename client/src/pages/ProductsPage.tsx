// Products — top-level page (header nav). Wraps the Products manager: the
// company's own product/service catalogue, discovered from the company profile
// the same way competitors are.

import { useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import Products from '../components/vault/Products'

export default function ProductsPage() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()

  const getToken = async () => {
    const t = await getAccessToken()
    if (!t) throw new Error('Session expired — please sign in again.')
    return t
  }

  return (
    <main className="wrap">
      <Products orgId={orgId} getToken={getToken} />
    </main>
  )
}

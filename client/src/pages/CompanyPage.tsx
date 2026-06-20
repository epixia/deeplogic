// Company — intel about your OWN company, reusing the competitor detail view
// (overview, DataForSEO SEO intel, traffic history, products) pointed at your
// own website (from the Company profile). No auto-save to a competitor dashboard.

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { listContext, type ContextItem } from '../lib/api'
import SiteInsights from './SiteInsights'

export default function CompanyPage() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()
  const [website, setWebsite] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const t = await getAccessToken()
        if (!t) return
        const items = await listContext(t, orgId)
        const profile = items.find(
          (i: ContextItem) => (i.meta as Record<string, unknown> | undefined)?.companyProfile === true,
        )
        const meta = (profile?.meta ?? {}) as Record<string, unknown>
        const site = typeof meta.website === 'string' ? meta.website : ''
        const company = typeof meta.name === 'string' ? meta.name : ''
        if (!cancelled) { setWebsite(site || null); setName(company) }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [getAccessToken, orgId])

  if (loading) {
    return <main className="wrap si"><div className="si-empty">Loading your company…</div></main>
  }

  if (!website) {
    return (
      <main className="wrap si">
        <h1><span className="grad-text">Company</span></h1>
        <div className="si-empty">
          Set your company website in the <Link to={`/app/${orgId}/vault`}>Company profile</Link> (Data Vault → Company)
          to see intel about your own site.
        </div>
      </main>
    )
  }

  // Reuse the competitor detail view for our own website. No back link, and no
  // auto-save (that flow creates a competitor dashboard).
  return <SiteInsights urlOverride={website} nameOverride={name} backTo="" autoSave={false} />
}

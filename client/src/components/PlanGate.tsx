// PlanGate — renders an inline upgrade wall when the org's plan doesn't
// include a feature. Wrap gated UI: <PlanGate feature="byok" orgId={orgId}>
// Children render normally when the feature is available.

import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { getBillingSubscription, type BillingSubscription } from '../lib/api'
import { useAuth } from '../auth/AuthContext'

const FEATURE_LABELS: Record<string, string> = {
  byok:     'Bring Your Own Key',
  mcp:      'MCP connectors',
  auditLog: 'Audit log',
}

const FEATURE_PLAN: Record<string, string> = {
  byok:     'Business',
  mcp:      'Business',
  auditLog: 'Business',
}

interface Props {
  feature: keyof BillingSubscription['limits']
  orgId: string
  children: ReactNode
}

export default function PlanGate({ feature, orgId, children }: Props) {
  const { getAccessToken } = useAuth()
  const [sub, setSub] = useState<BillingSubscription | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    getAccessToken().then((token) => {
      if (!token) { setLoaded(true); return }
      getBillingSubscription(token, orgId)
        .then(setSub)
        .catch(() => null)
        .finally(() => setLoaded(true))
    })
  }, [orgId, getAccessToken])

  if (!loaded) return null

  // Feature is available — render children.
  const available = sub?.limits[feature]
  if (available || sub === null) return <>{children}</>

  const featureLabel = FEATURE_LABELS[feature as string] ?? String(feature)
  const requiredPlan = FEATURE_PLAN[feature as string] ?? 'a higher plan'

  return (
    <div className="plan-gate">
      <div className="plan-gate__icon">🔒</div>
      <div className="plan-gate__body">
        <strong>{featureLabel}</strong> requires the {requiredPlan} plan.
        <Link className="plan-gate__upgrade" to={`/app/${orgId}/settings?tab=billing`}>
          Upgrade
        </Link>
      </div>
    </div>
  )
}

// SamplePicker — lists the bundled sample semantic models (GET /api/models)
// and lets the user start ingestion from one of them.

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listModels } from '../../lib/api'
import { useAuth } from '../../auth/AuthContext'
import type { ModelListItem } from '../../types'

interface Props {
  onPick: (sampleId: string, name: string) => void
  disabled?: boolean
  busyId?: string | null
}

// Short marketing-style descriptions for the bundled neutral samples.
const BLURBS: Record<string, string> = {
  'Atlas Retail':
    'Omnichannel retail — orders, revenue, margin and fulfillment across regions.',
  'Northwind SaaS':
    'B2B subscription — MRR, active seats, churn and NPS by plan and segment.',
}

export default function SamplePicker({ onPick, disabled, busyId }: Props) {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()
  const [models, setModels] = useState<ModelListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void getAccessToken()
      .then((token) => {
        if (!token) throw new Error('Your session has expired — please sign in again.')
        return listModels(token, orgId)
      })
      .then((list) => {
        if (alive) setModels(list)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load samples')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [orgId, getAccessToken])

  return (
    <div className="dli-samples">
      <div className="dli-section-head">
        <p className="dli-section-sub">
          Pre-built sample reports — ingested instantly, no upload required.
        </p>
      </div>

      {loading ? (
        <div className="dli-sample-grid">
          <div className="dli-sample-card dli-skel" />
          <div className="dli-sample-card dli-skel" />
        </div>
      ) : error ? (
        <div className="dli-error">Could not load samples — {error}</div>
      ) : (
        <div className="dli-sample-grid">
          {models.map((m) => {
            const busy = busyId === m.id
            return (
              <button
                key={m.id}
                type="button"
                className="dli-sample-card"
                disabled={disabled}
                onClick={() => onPick(m.id, m.name)}
              >
                <div className="dli-sample-top">
                  <span className="dli-sample-badge">Report</span>
                  <span className="dli-sample-src">{m.source}</span>
                </div>
                <h3 className="dli-sample-name">{m.name}</h3>
                <p className="dli-sample-blurb">
                  {BLURBS[m.name] ?? 'Bundled semantic model.'}
                </p>
                <span className="dli-sample-cta">
                  {busy ? 'Starting…' : 'Ingest this model →'}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

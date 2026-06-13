// Anomaly alert card — severity, NL brief, root cause, recommended action,
// and an Approve button that POSTs the action and reports the new audit entry.

import { useState } from 'react'
import type { Anomaly } from '../../types'
import { formatDate, formatValue } from './format'

interface AnomalyCardProps {
  anomaly: Anomaly
  /** KPI value format for the observed/expected numbers (currency/percent/number). */
  format?: 'currency' | 'percent' | 'number'
  /** Already approved (e.g. an audit entry already exists for this anomaly). */
  approved: boolean
  /** Approve handler — resolves once the audit entry has been recorded. */
  onApprove: (anomaly: Anomaly) => Promise<void>
}

export default function AnomalyCard({
  anomaly,
  format,
  approved,
  onApprove,
}: AnomalyCardProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleApprove = async () => {
    setBusy(true)
    setError(null)
    try {
      await onApprove(anomaly)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed')
    } finally {
      setBusy(false)
    }
  }

  const rc = anomaly.rootCause
  const contribPct = (rc.contribution * 100).toFixed(0)

  return (
    <article className={`mc-alert sev-${anomaly.severity}`}>
      <div className="mc-alert-head">
        <div>
          <div className="title">{anomaly.kpiName} anomaly</div>
          <div className="sub">Detected {formatDate(anomaly.date)}</div>
        </div>
        <span className={`mc-sev ${anomaly.severity}`}>{anomaly.severity}</span>
      </div>

      <div className="mc-metrics">
        <div className="mc-metric">
          <div className="ml">Observed</div>
          <div className="mv">{formatValue(anomaly.observed, format)}</div>
        </div>
        <div className="mc-metric">
          <div className="ml">Expected</div>
          <div className="mv">{formatValue(anomaly.expected, format)}</div>
        </div>
        <div className="mc-metric">
          <div className="ml">Deviation</div>
          <div className="mv">{anomaly.deviation.toFixed(1)}σ</div>
        </div>
      </div>

      <p className="mc-brief">{anomaly.brief}</p>

      <div className="mc-root">
        <span>Root cause:</span>
        <b>{rc.dimensionName}</b>
        <span className="rc-chip">{rc.label}</span>
        <span>({contribPct}% of the change)</span>
      </div>

      <div className="mc-rec">
        <div className="rec-eyebrow">Recommended action</div>
        <div className="rec-title">{anomaly.recommendation.title}</div>
        <div className="rec-detail">{anomaly.recommendation.detail}</div>
        <div className="mc-rec-foot">
          <span className="action-code">{anomaly.recommendation.action}</span>
          {approved ? (
            <span className="mc-approved">✓ Approved · executed</span>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleApprove}
              disabled={busy}
            >
              {busy ? 'Approving…' : 'Approve'}
            </button>
          )}
          {error && (
            <span style={{ color: 'var(--bad)', fontSize: 12 }}>{error}</span>
          )}
        </div>
      </div>
    </article>
  )
}

// Audit log panel — chronological record of agent/user actions.
// Loaded on mount via GET audit; new entries are prepended on approve.

import type { AuditEntry } from '../../types'
import { formatTs } from './format'

interface AuditLogProps {
  entries: AuditEntry[]
}

export default function AuditLog({ entries }: AuditLogProps) {
  return (
    <div className="mc-panel">
      <div className="mc-panel-top">
        <i />
        <i />
        <i />
        <span className="mc-panel-title">DeepLogic · Audit Log</span>
        <span className="right">{entries.length} entries</span>
      </div>
      <div className="mc-panel-body">
        {entries.length === 0 ? (
          <div className="mc-empty">
            No actions recorded yet. Approve a recommendation to log it here.
          </div>
        ) : (
          <div className="mc-audit">
            {entries.map((entry) => (
              <div className="mc-audit-row" key={entry.id}>
                <span className={`who ${entry.actor}`}>{entry.actor}</span>
                <div className="a-body">
                  <div className="a-summary">{entry.summary}</div>
                  <div className="a-ts">{formatTs(entry.ts)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

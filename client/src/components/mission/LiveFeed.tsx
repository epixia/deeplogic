// Live agent activity feed — renders AgentEvent items from the mission SSE
// stream with running/done/alert status styling. Newest event on top.

import type { AgentEvent } from '../../types'
import { formatTs } from './format'

interface LiveFeedProps {
  events: AgentEvent[]
  connected: boolean
}

const STAGE_ICON: Record<string, string> = {
  ingest: '◆',
  connectors: '⛁',
  kpis: '∿',
  anomaly: '!',
  brief: '✎',
}

export default function LiveFeed({ events, connected }: LiveFeedProps) {
  return (
    <div className="mc-panel">
      <div className="mc-panel-top">
        <i />
        <i />
        <i />
        <span className="mc-panel-title">DeepLogic · Agent Activity</span>
        <span className="right">
          {connected ? (
            <span style={{ color: 'var(--cyan)' }}>● live</span>
          ) : (
            <span>○ offline</span>
          )}
        </span>
      </div>
      <div className="mc-panel-body">
        {events.length === 0 ? (
          <div className="mc-empty">
            {connected
              ? 'Waiting for the agent crew to report in…'
              : 'No live feed available.'}
          </div>
        ) : (
          <div className="mc-feed">
            {events.map((e) => (
              <div
                className={`mc-feed-row${e.status === 'alert' ? ' alert' : ''}`}
                key={e.id}
              >
                <span className="ic">{STAGE_ICON[e.stage] ?? '•'}</span>
                <div className="body">
                  <div>
                    <span className="agent">{e.agent}</span>{' '}
                    <span className="msg">{e.message}</span>
                  </div>
                  <div className="meta">
                    {e.stage} · {formatTs(e.ts)}
                  </div>
                </div>
                <span className={`mc-status ${e.status}`}>{e.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

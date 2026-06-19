// AgentActivityToasts — bottom-left toasts that surface live agent activity:
// which run is in flight and the action it's currently taking. Fed by the
// global agentActivity store, so it works for any chat / action run.

import { useAgentActivities } from '../lib/agentActivity'
import './agent-activity-toasts.css'

export default function AgentActivityToasts() {
  const activities = useAgentActivities()
  if (activities.length === 0) return null
  return (
    <div className="aat-wrap" aria-live="polite">
      {activities.map((a) => (
        <div key={a.id} className={`aat-toast${a.done ? ' aat-toast--done' : ''}`}>
          <span className="aat-spin" aria-hidden>
            {a.done ? <span className="aat-check">✓</span> : <span className="aat-dots"><span /><span /><span /></span>}
          </span>
          <div className="aat-body">
            <div className="aat-title">{a.title}{a.done ? '' : ' is working…'}</div>
            <div className="aat-step">
              <span className="aat-step-ic">{a.latest.icon}</span>
              <span className="aat-step-text">{a.latest.text}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

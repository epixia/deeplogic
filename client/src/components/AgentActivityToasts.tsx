// AgentActivityToasts — bottom-left toasts that surface live agent activity:
// which run is in flight and the action it's currently taking. Fed by the
// global agentActivity store, so it works for any chat / action run.

import { useEffect, useRef } from 'react'
import { useAgentActivities, type Activity, type ActivityStep } from '../lib/agentActivity'
import './agent-activity-toasts.css'

// Turn raw http(s) URLs inside step text into clickable links (new tab).
function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((p, i) =>
    /^https?:\/\//.test(p)
      ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="aat-link">{p}</a>
      : <span key={i}>{p}</span>,
  )
}

// Render a step's text: linkify inline URLs, and if the step carries a separate
// url (for site names without a raw URL) make the whole text a link.
function renderStepText(s: ActivityStep) {
  if (s.url) return <a href={s.url} target="_blank" rel="noopener noreferrer" className="aat-link">{s.text}</a>
  return linkify(s.text)
}

export default function AgentActivityToasts() {
  const activities = useAgentActivities()
  if (activities.length === 0) return null
  return (
    <div className="aat-wrap" aria-live="polite">
      {activities.map((a) => <ActivityToast key={a.id} a={a} />)}
    </div>
  )
}

function ActivityToast({ a }: { a: Activity }) {
  const logRef = useRef<HTMLDivElement | null>(null)
  // Keep the newest step in view as the log grows.
  useEffect(() => { logRef.current?.scrollTo({ top: 9e9 }) }, [a.steps.length])
  return (
    <div className={`aat-toast${a.done ? ' aat-toast--done' : ''}`}>
      <div className="aat-head">
        <span className="aat-spin" aria-hidden>
          {a.done ? <span className="aat-check">✓</span> : <span className="aat-dots"><span /><span /><span /></span>}
        </span>
        <div className="aat-title">{a.title}{a.done ? '' : ' is working…'}</div>
      </div>
      <div className="aat-log" ref={logRef}>
        {a.steps.map((s, i) => (
          <div key={i} className={`aat-step${i === a.steps.length - 1 ? ' aat-step--current' : ''}`}>
            <span className="aat-step-ic">{s.icon}</span>
            <span className="aat-step-text">{renderStepText(s)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

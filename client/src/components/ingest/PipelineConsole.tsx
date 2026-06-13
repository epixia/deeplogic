// PipelineConsole — opens the ingest SSE stream and animates the agent
// pipeline (ingest → connectors → kpis → anomaly → brief) with a live feed of
// AgentEvent rows + a progress bar. On the 'done' event it calls onDone so the
// page can navigate to the dashboard.

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { openIngestStream } from '../../lib/api'
import { useAuth } from '../../auth/AuthContext'
import type { AgentEvent, AgentStage } from '../../types'

const STAGES: { id: AgentStage; label: string }[] = [
  { id: 'ingest', label: 'Ingest' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'kpis', label: 'KPIs' },
  { id: 'anomaly', label: 'Anomaly' },
  { id: 'brief', label: 'Brief' },
]

interface Props {
  modelId: string
  modelName?: string
  onDone: () => void
}

export default function PipelineConsole({ modelId, modelName, onDone }: Props) {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [stageStatus, setStageStatus] = useState<
    Record<AgentStage, 'pending' | 'running' | 'done' | 'alert'>
  >({
    ingest: 'pending',
    connectors: 'pending',
    kpis: 'pending',
    anomaly: 'pending',
    brief: 'pending',
  })
  const [done, setDone] = useState(false)
  const feedRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let es: EventSource | null = null
    let cancelled = false

    void getAccessToken().then((token) => {
      if (cancelled || !token) return
      es = openIngestStream(token, orgId, modelId, {
        onEvent: (evt) => {
          setEvents((prev) => [...prev, evt])
          setStageStatus((prev) => {
            const next = { ...prev }
            // mark this stage with its latest status
            next[evt.stage] =
              evt.status === 'alert'
                ? 'alert'
                : evt.status === 'done'
                  ? 'done'
                  : prev[evt.stage] === 'done'
                    ? 'done'
                    : 'running'
            // any earlier stage that's still pending/running is complete
            const idx = STAGES.findIndex((s) => s.id === evt.stage)
            for (let i = 0; i < idx; i++) {
              const sid = STAGES[i].id
              if (next[sid] === 'pending' || next[sid] === 'running') {
                next[sid] = 'done'
              }
            }
            return next
          })
        },
        onDone: () => {
          setStageStatus((prev) => {
            const next = { ...prev }
            for (const s of STAGES) {
              if (next[s.id] === 'pending' || next[s.id] === 'running') {
                next[s.id] = 'done'
              }
            }
            return next
          })
          setDone(true)
          // small beat so the user sees the final "done" state before nav
          window.setTimeout(onDone, 900)
        },
        onError: () => {
          /* EventSource auto-retries; nothing user-facing needed here */
        },
      })
    })

    return () => {
      cancelled = true
      es?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, orgId])

  // keep the feed scrolled to the newest row
  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events])

  const completed = STAGES.filter((s) => stageStatus[s.id] === 'done').length
  const progress = Math.round((completed / STAGES.length) * 100)

  return (
    <div className="dli-console" aria-live="polite">
      <div className="dli-con-top">
        <i className="dli-dot dli-dot-r" />
        <i className="dli-dot dli-dot-y" />
        <i className="dli-dot dli-dot-g" />
        <span className="dli-con-title">
          DeepLogic · Agent pipeline
          {modelName ? ` — ${modelName}` : ''}
        </span>
        <span className={`dli-live ${done ? 'is-done' : ''}`}>
          {done ? '✓ ready' : '● running'}
        </span>
      </div>

      {/* stage chips */}
      <div className="dli-stages">
        {STAGES.map((s, i) => (
          <div key={s.id} className="dli-stage-wrap">
            <div className={`dli-stage st-${stageStatus[s.id]}`}>
              <span className="dli-stage-ic">
                {stageStatus[s.id] === 'done'
                  ? '✓'
                  : stageStatus[s.id] === 'alert'
                    ? '⚑'
                    : stageStatus[s.id] === 'running'
                      ? '◐'
                      : i + 1}
              </span>
              <span className="dli-stage-label">{s.label}</span>
            </div>
            {i < STAGES.length - 1 ? <span className="dli-stage-sep" /> : null}
          </div>
        ))}
      </div>

      {/* progress bar */}
      <div className="dli-progress" role="progressbar" aria-valuenow={progress}>
        <div className="dli-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* live event feed */}
      <div className="dli-feed" ref={feedRef}>
        {events.length === 0 ? (
          <div className="dli-feed-empty">Connecting to agent stream…</div>
        ) : (
          events.map((e) => (
            <div key={e.id} className="dli-row">
              <span className={`dli-row-ic st-${e.status}`}>
                {e.status === 'alert' ? '⚑' : e.status === 'done' ? '✓' : '◐'}
              </span>
              <span className="dli-row-agent">{e.agent}</span>
              <span className="dli-row-msg">{e.message}</span>
              <span className={`dli-row-status st-${e.status}`}>
                {e.status}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

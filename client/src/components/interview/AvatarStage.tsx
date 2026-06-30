// LiveAvatar streaming avatar — the face of the AI interviewer. Creates a
// LiveAvatar session from a short-lived server-minted token, attaches the video,
// and speaks each question our gap-driven brain produces via repeat() (say
// exactly this text — our brain controls the conversation, not LiveAvatar's).

import { useEffect, useRef, useState } from 'react'
import { LiveAvatarSession, SessionEvent } from '@heygen/liveavatar-web-sdk'
import { getInterviewToken } from '../../lib/api'

type Status = 'connecting' | 'ready' | 'error' | 'off'

export default function AvatarStage({ question, orgId, token, onError }: {
  question: string
  orgId: string
  token: () => Promise<string>
  onError?: (msg: string | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const sessionRef = useRef<LiveAvatarSession | null>(null)
  const lastSpoken = useRef<string>('')
  const [status, setStatus] = useState<Status>('connecting')
  const [error, setError] = useState<string | null>(null)

  // Connect once on mount; tear the session down on unmount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { token: sessToken } = await getInterviewToken(await token(), orgId)
        if (cancelled) return
        const session = new LiveAvatarSession(sessToken)
        sessionRef.current = session

        session.on(SessionEvent.SESSION_STREAM_READY, () => {
          if (videoRef.current) {
            session.attach(videoRef.current)
            void videoRef.current.play().catch(() => {})
          }
          if (!cancelled) setStatus('ready')
        })
        session.on(SessionEvent.SESSION_DISCONNECTED, () => { if (!cancelled) setStatus('off') })

        await session.start()
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'Could not start the avatar.'
        setStatus('error')
        setError(msg)
        onError?.(msg)
      }
    })()
    return () => {
      cancelled = true
      const s = sessionRef.current
      sessionRef.current = null
      void s?.stop().catch(() => {})
    }
  }, [orgId, token, onError])

  // Speak each new question once the session is live.
  useEffect(() => {
    const q = question.trim()
    if (status !== 'ready' || !q || q === lastSpoken.current || !sessionRef.current) return
    lastSpoken.current = q
    try { sessionRef.current.repeat(q) } catch { /* session may be reconnecting */ }
  }, [question, status])

  return (
    <div className="iv-avatar-ph iv-avatar-live">
      <video ref={videoRef} className="iv-avatar-video" autoPlay playsInline />
      {status !== 'ready' && (
        <div className="iv-avatar-overlay">
          <div className="iv-avatar-face">🧑‍💼</div>
          {status === 'connecting' && <div className="iv-avatar-note">Connecting the interviewer…</div>}
          {status === 'off' && <div className="iv-avatar-note">Avatar disconnected.</div>}
          {status === 'error' && <div className="iv-avatar-note iv-avatar-err">Avatar unavailable{error ? ' — details below ↓' : ''}</div>}
        </div>
      )}
      <div className="iv-avatar-cap">AI Interviewer</div>
    </div>
  )
}

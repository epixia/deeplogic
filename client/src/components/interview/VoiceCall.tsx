// In-browser voice mind-dump via the Vapi Web SDK. The Vapi voice agent runs the
// mind-dump persona; we capture the live transcript and, on end, compile it into
// Q&A pairs and save via interviewFinish (no phone number / public URL needed).

import { useCallback, useEffect, useRef, useState } from 'react'
import Vapi from '@vapi-ai/web'
import { getInterviewWebConfig, interviewFinish, type InterviewQA } from '../../lib/api'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Turn = { role: 'assistant' | 'user'; text: string }
type Status = 'connecting' | 'live' | 'saving' | 'error'

// Pair the turn stream into Q&A: each assistant turn is a question, the user
// turns that follow (until the next assistant turn) are the answer.
function toQA(turns: Turn[]): InterviewQA[] {
  const pairs: InterviewQA[] = []
  let q = ''
  let a: string[] = []
  const flush = () => { if (q || a.length) pairs.push({ q, a: a.join(' ').trim() }); q = ''; a = [] }
  for (const t of turns) {
    if (t.role === 'assistant') { flush(); q = t.text } else a.push(t.text)
  }
  flush()
  return pairs.filter((p) => p.q || p.a)
}

export default function VoiceCall({ orgId, token, name, role, topic, onSaved, onCancel }: {
  orgId: string
  token: () => Promise<string>
  name: string
  role: string
  topic: string
  onSaved: (r: { name: string; entities: number; facts: number; turns: number }) => void
  onCancel: () => void
}) {
  const vapiRef = useRef<Vapi | null>(null)
  const turnsRef = useRef<Turn[]>([])
  const [turns, setTurns] = useState<Turn[]>([])
  const [status, setStatus] = useState<Status>('connecting')
  const [interviewerSpeaking, setInterviewerSpeaking] = useState(false)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleMute() {
    const v = vapiRef.current
    if (!v) return
    const next = !muted
    try { v.setMuted(next); setMuted(next) } catch { /* not connected yet */ }
  }

  const save = useCallback(async () => {
    setStatus('saving')
    try {
      const t = turnsRef.current
      const r = await interviewFinish(await token(), orgId, {
        interviewee: name, role,
        topics: topic ? topic.split(',').map((s) => s.trim()).filter(Boolean) : [],
        transcript: toQA(t),
      })
      onSaved({ name: r.name, entities: r.entities, facts: r.facts, turns: t.length })
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Could not save the interview.')
    }
  }, [token, orgId, name, role, topic, onSaved])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { publicKey, assistant } = await getInterviewWebConfig(await token(), orgId, { interviewee: name, role, topic })
        if (cancelled) return
        const vapi = new Vapi(publicKey)
        vapiRef.current = vapi

        vapi.on('call-start', () => { if (!cancelled) setStatus('live') })
        // In the Vapi web SDK these fire for the ASSISTANT (the interviewer).
        vapi.on('speech-start', () => { if (!cancelled) setInterviewerSpeaking(true) })
        vapi.on('speech-end', () => { if (!cancelled) setInterviewerSpeaking(false) })
        vapi.on('message', (m: any) => {
          if (m?.type === 'transcript' && m.transcriptType === 'final' && m.transcript?.trim()) {
            const turn: Turn = { role: m.role === 'assistant' ? 'assistant' : 'user', text: m.transcript.trim() }
            turnsRef.current = [...turnsRef.current, turn]
            setTurns(turnsRef.current)
          }
        })
        vapi.on('error', (e: any) => {
          if (cancelled) return
          setStatus('error')
          setError(e?.errorMsg || e?.message || 'Voice call error.')
        })

        await vapi.start(assistant as any)
      } catch (e) {
        if (cancelled) return
        setStatus('error')
        setError(e instanceof Error ? e.message : 'Could not start the voice call.')
      }
    })()
    return () => {
      cancelled = true
      const v = vapiRef.current
      vapiRef.current = null
      try { v?.stop() } catch { /* noop */ }
    }
  }, [orgId, token, name, role, topic])

  async function endAndSave() {
    try { vapiRef.current?.stop() } catch { /* noop */ }
    await save()
  }

  return (
    <main className="wrap iv iv-voice">
      <header className="iv-live-head">
        <div className="iv-live-who"><strong>{name}</strong>{role && <span> · {role}</span>}</div>
        <div className="iv-voice-actions">
          <button type="button" className={`iv-mic-btn${muted ? ' is-muted' : ''}`} onClick={toggleMute}
            disabled={status !== 'live'} title={muted ? 'Unmute your mic' : 'Mute your mic'}>
            {muted ? '🔇 Muted' : '🎙 Mic on'}
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => { try { vapiRef.current?.stop() } catch { /* */ } onCancel() }}>Cancel</button>
          <button type="button" className="btn btn-primary btn-xs" onClick={() => void endAndSave()} disabled={status === 'saving' || turns.length === 0}>
            {status === 'saving' ? 'Saving…' : 'End & save ▸'}
          </button>
        </div>
      </header>

      <div className="iv-voice-stage">
        <div className={`iv-voice-orb${interviewerSpeaking ? ' is-speaking' : ''}${status === 'live' ? ' is-live' : ''}`}>
          {interviewerSpeaking
            ? <span className="iv-voice-bars" aria-hidden><i /><i /><i /><i /></span>
            : '🎙'}
        </div>
        <div className={`iv-voice-status${interviewerSpeaking ? ' is-speaking' : ''}`}>
          {status === 'connecting' && 'Connecting your voice interviewer…'}
          {status === 'live' && (
            interviewerSpeaking ? '🗣 Interviewer is speaking…'
              : muted ? 'You’re muted — unmute to answer'
              : 'Your turn — speak naturally'
          )}
          {status === 'saving' && 'Saving to your Data Vault…'}
          {status === 'error' && 'Voice call problem'}
        </div>
        {error && <div className="iv-error">{error}</div>}
      </div>

      <div className="iv-transcript iv-voice-transcript">
        {turns.length === 0 && status === 'live' && <div className="iv-chat-hint">Your conversation will appear here as you talk.</div>}
        {turns.map((t, i) => (
          <div key={i} className={`iv-vturn iv-vturn--${t.role}`}>
            <span className="iv-vturn-who">{t.role === 'assistant' ? 'Interviewer' : name.split(' ')[0] || 'You'}</span>
            {t.text}
          </div>
        ))}
      </div>
    </main>
  )
}

// Interview — an AI "brain dump" that captures a staff member's tacit knowledge
// straight into the Data Vault + memory graph. Text-first (type or speak); the
// HeyGen avatar drops into the avatar panel as a later visual layer.

import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { interviewNext, interviewFinish, startPhoneInterview, uploadInterviewVideo, listEmployees, type InterviewQA, type Employee } from '../lib/api'
import './interview.css'

// Lazy-loaded: these pull in heavy WebRTC SDKs (LiveAvatar, Vapi/Daily) whose
// module init isn't safe to run at app load — only load them when a live
// interview / voice call actually starts. Keeps them out of the main bundle.
const AvatarStage = lazy(() => import('../components/interview/AvatarStage'))
const VoiceCall = lazy(() => import('../components/interview/VoiceCall'))
const VideoRecorder = lazy(() => import('../components/interview/VideoRecorder'))

/* eslint-disable @typescript-eslint/no-explicit-any */
type Phase = 'setup' | 'live' | 'voice' | 'done'

// Remember interviewees across sessions so you don't retype them.
interface Recent { name: string; role: string }
const RECENTS_KEY = 'dl-interviewees'
function loadRecents(): Recent[] {
  try { const v = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); return Array.isArray(v) ? v : [] }
  catch { return [] }
}
function rememberInterviewee(name: string, role: string) {
  const n = name.trim()
  if (!n) return
  const list = loadRecents().filter((r) => r.name.toLowerCase() !== n.toLowerCase())
  list.unshift({ name: n, role: role.trim() })
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 12))) } catch { /* storage full/blocked */ }
}

export default function Interview() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()
  const token = useCallback(async () => {
    const t = await getAccessToken()
    if (!t) throw new Error('Session expired — please sign in again.')
    return t
  }, [getAccessToken])

  const [phase, setPhase] = useState<Phase>('setup')
  // Pre-fill with the last interviewee (name + role) — editable, no list.
  const [name, setName] = useState(() => loadRecents()[0]?.name ?? '')
  const [role, setRole] = useState(() => loadRecents()[0]?.role ?? '')
  const [topic, setTopic] = useState('')
  const [method, setMethod] = useState<'browser' | 'video' | 'voice' | 'phone'>('browser')
  const [videoMode, setVideoMode] = useState(false)
  const recorderApi = useRef<{ stop: () => Promise<Blob | null> } | null>(null)
  const [phone, setPhone] = useState('')
  const [calling, setCalling] = useState(false)
  const [callMsg, setCallMsg] = useState<string | null>(null)
  // Employees roster (Data Vault) to pick the interviewee from.
  const [emps, setEmps] = useState<Employee[]>([])
  useEffect(() => {
    void (async () => {
      try { setEmps((await listEmployees(await token(), orgId)).employees) } catch { /* roster optional */ }
    })()
  }, [orgId])  // eslint-disable-line react-hooks/exhaustive-deps

  async function startCall() {
    if (!name.trim()) { setError('Add who you’re interviewing.'); return }
    if (!phone.trim()) { setError('Enter their phone number.'); return }
    setCalling(true); setError(null); setCallMsg(null)
    try {
      rememberInterviewee(name, role)
      const r = await startPhoneInterview(await token(), orgId, { phoneNumber: phone.trim(), interviewee: name, role, topic })
      setCallMsg(r.transcriptCaptured
        ? `Calling ${phone.trim()} now. When the call ends, the transcript is saved to your Data Vault automatically.`
        : `Calling ${phone.trim()} now. ⚠ The transcript won’t auto-save until PUBLIC_API_URL is set (e.g. an ngrok URL) — so this is a call test only for now.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start the call.') }
    finally { setCalling(false) }
  }

  const [date] = useState(() => new Date().toISOString().slice(0, 10))

  const [transcript, setTranscript] = useState<InterviewQA[]>([])
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrapUp, setWrapUp] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ name: string; entities: number; facts: number; answers: number } | null>(null)
  function startVoice() {
    if (!name.trim()) { setError('Add who you’re interviewing.'); return }
    rememberInterviewee(name, role)
    setPhase('voice')
  }
  const recog = useRef<any>(null)

  const askNext = useCallback(async (tx: InterviewQA[]) => {
    setBusy(true); setError(null)
    try {
      const r = await interviewNext(await token(), orgId, { interviewee: name, role, topic, transcript: tx })
      if (r.done) { setWrapUp(true); setQuestion('') } else { setQuestion(r.question); setWrapUp(false) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not get the next question.') }
    finally { setBusy(false) }
  }, [token, orgId, name, role, topic])

  async function start() {
    if (!name.trim()) { setError('Add who you’re interviewing.'); return }
    rememberInterviewee(name, role)
    setVideoMode(method === 'video')
    setPhase('live'); setTranscript([]); setWrapUp(false)
    await askNext([])
  }

  async function submit() {
    if (!answer.trim() || busy) return
    stopMic()
    const tx = [...transcript, { q: question, a: answer.trim() }]
    setTranscript(tx); setAnswer('')
    await askNext(tx)
  }

  async function finish() {
    stopMic()
    // fold any unsent answer into the transcript
    const tx = answer.trim() ? [...transcript, { q: question, a: answer.trim() }] : transcript
    if (tx.length === 0) { setError('Answer at least one question first.'); return }
    setBusy(true); setError(null)
    try {
      let videoUrl: string | undefined
      if (videoMode && recorderApi.current) {
        try {
          const blob = await recorderApi.current.stop()
          if (blob && blob.size) { videoUrl = (await uploadInterviewVideo(await token(), orgId, blob)).url }
        } catch (e) { console.error('video upload failed', e) /* keep the transcript regardless */ }
      }
      const r = await interviewFinish(await token(), orgId, {
        interviewee: name, role, date,
        topics: topic ? topic.split(',').map((s) => s.trim()).filter(Boolean) : [],
        transcript: tx, videoUrl,
      })
      setResult({ name: r.name, entities: r.entities, facts: r.facts, answers: tx.length })
      setPhase('done')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the interview.') }
    finally { setBusy(false) }
  }

  function stopMic() { try { recog.current?.stop() } catch { /* noop */ } setListening(false) }
  function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { setError('Speech recognition needs Chrome/Edge — you can type your answer instead.'); return }
    if (listening) { stopMic(); return }
    const r = new SR()
    r.lang = 'en-US'; r.interimResults = true; r.continuous = true
    let base = answer ? answer + ' ' : ''
    r.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) base += t + ' '; else interim += t
      }
      setAnswer((base + interim).replace(/\s+/g, ' ').trimStart())
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    recog.current = r
    try { r.start(); setListening(true) } catch { /* already started */ }
  }

  // ---- setup ----
  if (phase === 'setup') {
    return (
      <main className="wrap iv">
        <header className="iv-head">
          <h1><span className="grad-text">Brain Dump Interview</span></h1>
          <p className="iv-lead">An AI interviewer pulls a teammate’s know-how into your Data Vault — it targets the gaps in your knowledge graph and saves everything with attribution.</p>
        </header>
        <div className="iv-setup">
          <div className="iv-method" role="tablist">
            <button type="button" className={`iv-method-opt${method === 'browser' ? ' is-on' : ''}`} onClick={() => { setMethod('browser'); setCallMsg(null) }}>💬 In browser</button>
            <button type="button" className={`iv-method-opt${method === 'video' ? ' is-on' : ''}`} onClick={() => { setMethod('video'); setCallMsg(null) }}>📹 Video</button>
            <button type="button" className={`iv-method-opt${method === 'voice' ? ' is-on' : ''}`} onClick={() => { setMethod('voice'); setCallMsg(null) }}>🎙 Voice call</button>
            <button type="button" className={`iv-method-opt${method === 'phone' ? ' is-on' : ''}`} onClick={() => { setMethod('phone'); setCallMsg(null) }}>☎ Phone call</button>
          </div>
          <label className="iv-field"><span>Who are you interviewing?</span>
            {emps.length > 0 && (
              <select className="iv-roster" value="" onChange={(e) => {
                const emp = emps.find((x) => x.id === e.target.value)
                if (emp) { setName(emp.name); if (emp.title) setRole(emp.title); if (emp.phone) setPhone(emp.phone) }
              }}>
                <option value="">📇 Pick from Employees roster…</option>
                {emps.map((x) => <option key={x.id} value={x.id}>{x.name}{x.title ? ` — ${x.title}` : ''}{x.status === 'interviewed' ? ' ✓' : ''}</option>)}
              </select>
            )}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maria Ortega" /></label>
          <label className="iv-field"><span>Their role <em>(optional)</em></span>
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Head of Operations" /></label>
          <label className="iv-field"><span>Focus topic <em>(optional)</em></span>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. order fulfilment, comma,separated,tags" /></label>
          {method === 'phone' && (
            <label className="iv-field"><span>Their phone number</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel"
                placeholder="+1 415 555 1234 (E.164)" /></label>
          )}
          {error && <div className="iv-error">{error}</div>}
          {callMsg && <div className="iv-callmsg">☎ {callMsg}</div>}
          {method === 'browser' ? (
            <button type="button" className="btn btn-primary" onClick={() => void start()}>Start interview →</button>
          ) : method === 'video' ? (
            <button type="button" className="btn btn-primary" onClick={() => void start()}>Start video interview 📹</button>
          ) : method === 'voice' ? (
            <button type="button" className="btn btn-primary" onClick={() => startVoice()}>Start voice call 🎙</button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => void startCall()} disabled={calling}>
              {calling ? 'Calling…' : 'Call now ☎'}
            </button>
          )}
          <p className="iv-hint">
            {method === 'browser'
              ? <>Answers can be typed or spoken (🎙 mic). The avatar layer connects once <code>HEYGEN_API_KEY</code> is set — the interview works without it.</>
              : method === 'video'
              ? <>Records the interviewee’s webcam while they answer (typed or 🎙 spoken). The video is saved to your Data Vault alongside the transcript when you finish.</>
              : method === 'voice'
              ? <>Talk to the AI interviewer right here in your browser (mic). The transcript saves to your Data Vault when you end the call. Requires <code>VAPI_PUBLIC_KEY</code> — no phone number or public URL needed.</>
              : <>Vapi calls the person, runs the same mind-dump, and the transcript saves to your Data Vault automatically when the call ends. Requires <code>VAPI_API_KEY</code>, a phone number &amp; <code>PUBLIC_API_URL</code>.</>}
          </p>
        </div>
      </main>
    )
  }

  // ---- in-browser voice call ----
  if (phase === 'voice') {
    return (
      <Suspense fallback={<main className="wrap iv"><div className="iv-voice-status" style={{ padding: '32px 0' }}>Loading voice call…</div></main>}>
        <VoiceCall
          orgId={orgId} token={token} name={name} role={role} topic={topic}
          onSaved={(r) => { setResult({ name: r.name, entities: r.entities, facts: r.facts, answers: r.turns }); setPhase('done') }}
          onCancel={() => setPhase('setup')}
        />
      </Suspense>
    )
  }

  // ---- done ----
  if (phase === 'done' && result) {
    return (
      <main className="wrap iv">
        <div className="iv-done">
          <div className="iv-done-ic">🧠✓</div>
          <h2>Saved to your Data Vault</h2>
          <p className="iv-done-name">“{result.name}”</p>
          <div className="iv-done-stats">
            <span><strong>{result.answers}</strong> answers</span>
            <span><strong>+{result.entities}</strong> entities</span>
            <span><strong>+{result.facts}</strong> facts</span>
          </div>
          <p className="iv-done-sub">It’s now searchable knowledge with attribution — your assistant can recall it and cite {name}.</p>
          <div className="iv-done-actions">
            <Link className="btn btn-ghost" to={`/app/${orgId}/memory`}>View in Memory graph</Link>
            <Link className="btn btn-ghost" to={`/app/${orgId}/vault`}>Open Data Vault</Link>
            <button type="button" className="btn btn-primary" onClick={() => { setResult(null); setTranscript([]); setQuestion(''); setAnswer(''); setPhase('setup') }}>New interview</button>
          </div>
        </div>
      </main>
    )
  }

  // ---- live ----
  return (
    <main className="wrap iv iv-live">
      <header className="iv-live-head">
        <div className="iv-live-who"><strong>{name}</strong>{role && <span> · {role}</span>}</div>
        <button type="button" className="btn btn-primary btn-xs" onClick={() => void finish()} disabled={busy}>Finish & save ▸</button>
      </header>

      <div className="iv-stage">
        {/* avatar panel — HeyGen streaming avatar speaks the questions */}
        <aside className="iv-avatar">
          {videoMode ? (
            <Suspense fallback={<div className="iv-avatar-ph"><div className="iv-avatar-note">Starting camera…</div></div>}>
              <VideoRecorder onError={setError} register={(api) => { recorderApi.current = api }} />
            </Suspense>
          ) : (
            <Suspense fallback={<div className="iv-avatar-ph"><div className="iv-avatar-note">Loading avatar…</div></div>}>
              <AvatarStage question={question} orgId={orgId} token={token} onError={setError} />
            </Suspense>
          )}
        </aside>

        {/* conversation */}
        <section className="iv-convo">
          <div className="iv-question">
            {busy && !question ? <span className="iv-thinking">Thinking of a question…</span>
              : wrapUp ? <span>That’s a great dump — I think we’ve covered plenty. <strong>Finish &amp; save</strong> when ready, or keep going.</span>
              : question || '…'}
          </div>

          {!wrapUp && (
            <div className="iv-answer">
              <textarea
                rows={4}
                placeholder="Speak or type the answer…"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                disabled={busy}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() } }}
              />
              <div className="iv-answer-row">
                <button type="button" className={`iv-mic${listening ? ' is-on' : ''}`} onClick={toggleMic} title="Speak your answer">
                  {listening ? '● Listening…' : '🎙 Speak'}
                </button>
                <button type="button" className="btn btn-primary btn-xs" onClick={() => void submit()} disabled={busy || !answer.trim()}>
                  {busy ? '…' : 'Next →'}
                </button>
              </div>
            </div>
          )}

          {error && <div className="iv-error">{error}</div>}

          {transcript.length > 0 && (
            <div className="iv-transcript">
              <div className="iv-transcript-head">Captured so far ({transcript.length})</div>
              {transcript.map((p, i) => (
                <div key={i} className="iv-qa">
                  <div className="iv-qa-q">{p.q}</div>
                  <div className="iv-qa-a">{p.a}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

// GlobalChat — a floating bottom-right assistant available on every signed-in,
// org-scoped page. Talks to the platform AI (POST /assistant/chat), grounded in
// the workspace Data Vault, with optional live web research for tasks like
// "research my competitors".

import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { assistantChatStream, createContext, generateMdTitle, type AssistantMessage, type AssistantStep, type SuggestedAction } from '../lib/api'
import { startActivity, updateActivity, endActivity } from '../lib/agentActivity'
import './global-chat.css'

// Derive a filename from a markdown reply (first heading or first line).
function mdTitle(text: string): string {
  const heading = text.split('\n').find((l) => /^#{1,6}\s/.test(l))
  const base = heading ? heading.replace(/^#{1,6}\s/, '') : (text.trim().split('\n')[0] || 'Assistant note')
  return base.replace(/[*_`#[\]]/g, '').trim().slice(0, 60) || 'Assistant note'
}

// A chat turn as shown in the panel — assistant turns may carry performed
// actions and the trace of "thinking" steps it took.
type ChatTurn = AssistantMessage & { actions?: string[]; suggestions?: SuggestedAction[]; steps?: AssistantStep[] }

// Only offer "Add to Vault as .md" for substantial, document-like answers
// (research write-ups). Short replies and action confirmations (e.g. "I created
// the widget") aren't documents — saving them as notes makes no sense.
function isSaveable(m: ChatTurn): boolean {
  if (m.role !== 'assistant' || !m.content) return false
  if (m.actions && m.actions.length > 0) return false        // an action was performed, not a document
  const lines = m.content.split('\n').filter((l) => l.trim()).length
  return m.content.length > 280 && lines >= 3                // multi-paragraph prose
}

// Pool of starter prompts — a random handful is shown each time the chat opens.
const QUICK_POOL = [
  'Research my competitors',
  'Summarise what data I have',
  'What reports should I build?',
  'Find new competitors in my market',
  'Draft a weekly competitor-watch agent',
  'What are the biggest risks to my business right now?',
  'Build a KPI dashboard for my company',
  'Generate 5 lead-gen ideas for my business',
  'What questions should I be asking of my data?',
  'Compare me against my top competitor',
  'Write a SWOT analysis for my company',
  'Suggest 3 agents I should deploy',
  'What trends are shaping my industry?',
  'Turn my latest data into a report',
]

// Random sample of n items (no repeats) — reshuffled each time the panel opens.
function sample<T>(pool: T[], n: number): T[] {
  const a = [...pool]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

// Render [label](url) links + preserve line breaks. Everything else is plain text.
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g
function render(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  let last = 0
  let m: RegExpExecArray | null
  LINK_RE.lastIndex = 0
  while ((m = LINK_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const href = m[2]
    parts.push(
      <a key={m.index} href={href} target="_blank" rel="noreferrer">{m[1]}</a>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

// Split a reply into segments at top-level numbered list items ("1. …", "2. …")
// so a per-item action button can be slotted under each. Text before the first
// item is a non-item lead segment.
function segmentByItems(text: string): { text: string; isItem: boolean }[] {
  const segs: { text: string; isItem: boolean }[] = []
  let cur: string[] = []
  let curIsItem = false
  const flush = () => { if (cur.length) segs.push({ text: cur.join('\n').replace(/\s+$/, ''), isItem: curIsItem }); cur = [] }
  for (const line of text.split('\n')) {
    if (/^\s{0,3}\d+\.\s/.test(line)) { flush(); curIsItem = true; cur = [line] }
    else cur.push(line)
  }
  flush()
  return segs.filter((s) => s.text.trim() || s.isItem)
}

export default function GlobalChat() {
  const { session, orgs, getAccessToken } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const orgId = pathname.match(/^\/app\/([^/]+)/)?.[1] ?? orgs[0]?.id

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [liveSteps, setLiveSteps] = useState<AssistantStep[]>([])
  const [webResearch, setWebResearch] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Record<number, { status: 'saving' | 'done'; id?: string; title?: string }>>({})
  // Action runner popup — confirm → live feedback → result.
  const [action, setAction] = useState<{
    label: string; prompt: string
    phase: 'confirm' | 'running' | 'done' | 'error'
    steps: AssistantStep[]; result?: string; error?: string
  } | null>(null)
  // Random starter prompts, reshuffled each time the chat is opened.
  const quickActions = useMemo(() => sample(QUICK_POOL, 4), [open])

  async function saveToVault(i: number, content: string) {
    if (!orgId || saved[i]) return
    setSaved((p) => ({ ...p, [i]: { status: 'saving' } }))
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      // Title derived from the CONTENT (AI titler, with a heuristic fallback).
      let title = mdTitle(content)
      try { title = (await generateMdTitle(t, orgId, content)).title || title } catch { /* keep fallback */ }
      title = title.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Assistant note'
      const fileName = title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Assistant note'
      const stamp = new Date().toLocaleString()
      // Wrap the reply as a proper, titled markdown document.
      const doc = `# ${title}\n\n${content.trim()}\n\n---\n*Saved from the DeepLogic assistant · ${stamp}*\n`
      const item = await createContext(t, orgId, {
        kind: 'doc',
        name: `${fileName}.md`,
        content: doc,
        meta: { format: 'md', source: 'assistant' },
        scope: 'org',
      })
      setSaved((p) => ({ ...p, [i]: { status: 'done', id: item.id, title } }))
    } catch {
      setSaved((p) => { const n = { ...p }; delete n[i]; return n })
    }
  }

  function openInMemory(id?: string) {
    if (!orgId) return
    setOpen(false)
    navigate(`/app/${orgId}/memory${id ? `?note=${id}` : ''}`)
  }
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending, liveSteps, open])

  // Hide on public pages / when signed out / before an org is known.
  if (!session || !orgId || !pathname.startsWith('/app')) return null

  async function send(text: string) {
    const content = text.trim()
    if (!content || sending) return
    setError(null)
    setDraft('')
    const next: ChatTurn[] = [...messages, { role: 'user', content }]
    setMessages(next)
    setSending(true)
    setLiveSteps([])
    const steps: AssistantStep[] = []
    const actId = `chat-${Date.now()}`
    startActivity(actId, 'Assistant', { icon: '✦', text: 'Thinking…' })
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired — please sign in again.')
      const history: AssistantMessage[] = next.map((m) => ({ role: m.role, content: m.content }))
      let answered = false
      for await (const ev of assistantChatStream(t, orgId!, { messages: history, webResearch })) {
        if (ev.type === 'step') {
          steps.push({ icon: ev.icon, text: ev.text })
          setLiveSteps([...steps])
          updateActivity(actId, { icon: ev.icon, text: ev.text })
        } else if (ev.type === 'done') {
          answered = true
          setMessages((prev) => [...prev, { role: 'assistant', content: ev.text, actions: ev.actions, suggestions: ev.suggestions, steps: [...steps] }])
          if (ev.aiError) setError(`AI error: ${ev.aiError}`)
        } else if (ev.type === 'error') {
          setError(ev.error)
        }
      }
      if (!answered && !steps.length) {
        setMessages((prev) => [...prev, { role: 'assistant', content: '⚠ Something went wrong. Please try again.' }])
      }
      endActivity(actId, 'Replied')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assistant request failed.')
      setMessages((prev) => [...prev, { role: 'assistant', content: '⚠ Something went wrong. Please try again.', steps: [...steps] }])
      endActivity(actId, 'Failed', '✗')
    } finally {
      setSending(false)
      setLiveSteps([])
    }
  }

  // Execute a confirmed action with live feedback in the popup, then fold the
  // result into the chat thread so the conversation stays coherent.
  async function runAction() {
    if (!action || action.phase === 'running') return
    setAction((a) => (a ? { ...a, phase: 'running', steps: [], result: undefined, error: undefined } : a))
    const prompt = action.prompt
    const title = action.label
    const steps: AssistantStep[] = []
    const actId = `action-${Date.now()}`
    startActivity(actId, title, { icon: '⚡', text: 'Starting…' })
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired — please sign in again.')
      const history: AssistantMessage[] = [...messages.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: prompt }]
      let answered = false
      for await (const ev of assistantChatStream(t, orgId!, { messages: history, webResearch })) {
        if (ev.type === 'step') {
          steps.push({ icon: ev.icon, text: ev.text })
          setAction((a) => (a ? { ...a, steps: [...steps] } : a))
          updateActivity(actId, { icon: ev.icon, text: ev.text })
        } else if (ev.type === 'done') {
          answered = true
          setAction((a) => (a ? { ...a, phase: 'done', result: ev.text, steps: [...steps] } : a))
          setMessages((prev) => [
            ...prev,
            { role: 'user', content: prompt },
            { role: 'assistant', content: ev.text, actions: ev.actions, suggestions: ev.suggestions, steps: [...steps] },
          ])
          endActivity(actId, 'Completed')
        } else if (ev.type === 'error') {
          setAction((a) => (a ? { ...a, phase: 'error', error: ev.error, steps: [...steps] } : a))
          endActivity(actId, 'Failed', '✗')
        }
      }
      if (!answered) {
        setAction((a) => (a && a.phase === 'running' ? { ...a, phase: 'error', error: 'No response — please try again.' } : a))
        endActivity(actId, 'Failed', '✗')
      }
    } catch (e) {
      setAction((a) => (a ? { ...a, phase: 'error', error: e instanceof Error ? e.message : 'Action failed.', steps: [...steps] } : a))
      endActivity(actId, 'Failed', '✗')
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(draft)
    }
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          className="gchat-fab"
          onClick={() => { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()) }}
          aria-label="Open assistant"
          title="Ask the DeepLogic assistant"
        >
          ✦
        </button>
      )}

      {open && (
        <div className="gchat-panel" role="dialog" aria-label="DeepLogic assistant">
          <div className="gchat-head">
            <span className="gchat-title"><span className="gchat-title-ic">✦</span> Assistant</span>
            <div className="gchat-head-actions">
              {messages.length > 0 && (
                <button type="button" className="gchat-head-btn" onClick={() => { setMessages([]); setError(null) }} title="New chat">＋</button>
              )}
              <button type="button" className="gchat-head-btn" onClick={() => setOpen(false)} aria-label="Minimise" title="Minimise">▾</button>
            </div>
          </div>

          <div className="gchat-body">
            {messages.length === 0 ? (
              <div className="gchat-welcome">
                <div className="gchat-welcome-ic">✦</div>
                <h4>How can I help?</h4>
                <p>I know your Data Vault and can research the web. Ask me anything, or try:</p>
                <div className="gchat-quick">
                  {quickActions.map((q) => (
                    <button key={q} type="button" className="gchat-quick-btn" onClick={() => void send(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="gchat-messages">
                {messages.map((m, i) => (
                  <div key={i} className={`gchat-msg gchat-msg--${m.role}`}>
                    {m.role === 'assistant' && <span className="gchat-msg-av">✦</span>}
                    <div className="gchat-msg-col">
                      {m.steps && m.steps.length > 0 && (
                        <details className="gchat-trace" open>
                          <summary>🧠 {m.steps.length} reasoning step{m.steps.length === 1 ? '' : 's'} — how I worked it out</summary>
                          {m.steps.map((s, j) => (
                            <div key={j} className="gchat-step"><span className="gchat-step-ic">{s.icon}</span>{s.text}</div>
                          ))}
                        </details>
                      )}
                      {(() => {
                        const sugg = m.suggestions ?? []
                        const sBtn = (s: SuggestedAction, key: number) => (
                          <button
                            key={key}
                            type="button"
                            className="gchat-suggestion"
                            disabled={sending || !!action}
                            title={s.prompt}
                            onClick={() => setAction({ label: s.label, prompt: s.prompt, phase: 'confirm', steps: [] })}
                          >
                            <span className="gchat-suggestion-ic">⚡</span>{s.label}
                          </button>
                        )
                        const segs = sugg.length ? segmentByItems(m.content) : []
                        const itemCount = segs.filter((s) => s.isItem).length
                        // Interleave one button per listed item when the reply is a
                        // numbered list; otherwise render the bubble then buttons.
                        if (itemCount > 0) {
                          let itemIdx = 0
                          return (
                            <div className="gchat-bubble">
                              {segs.map((seg, si) => {
                                const btn = seg.isItem ? sugg[itemIdx++] : undefined
                                return (
                                  <div key={si} className="gchat-seg">
                                    <div className="gchat-seg-text">{render(seg.text)}</div>
                                    {btn && <div className="gchat-suggestions gchat-suggestions--inline">{sBtn(btn, si)}</div>}
                                  </div>
                                )
                              })}
                              {itemIdx < sugg.length && (
                                <div className="gchat-suggestions">{sugg.slice(itemIdx).map((s, j) => sBtn(s, 1000 + j))}</div>
                              )}
                            </div>
                          )
                        }
                        return (
                          <>
                            <div className="gchat-bubble">{render(m.content)}</div>
                            {sugg.length > 0 && (
                              <div className="gchat-suggestions">{sugg.map((s, j) => sBtn(s, j))}</div>
                            )}
                          </>
                        )
                      })()}
                      {m.actions && m.actions.length > 0 && (
                        <div className="gchat-actions">
                          {m.actions.map((a, j) => (
                            <span key={j} className="gchat-action">✓ {a}</span>
                          ))}
                        </div>
                      )}
                      {(isSaveable(m) || saved[i]) && (
                        saved[i]?.status === 'done' ? (
                          <div className="gchat-saved">
                            <span className="gchat-saved-name" title={`${saved[i]!.title}.md`}>✓ {saved[i]!.title}.md</span>
                            <button type="button" className="gchat-saved-open" onClick={() => openInMemory(saved[i]!.id)}>Open ↗</button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="gchat-savevault"
                            disabled={saved[i]?.status === 'saving'}
                            onClick={() => void saveToVault(i, m.content)}
                          >
                            {saved[i]?.status === 'saving' ? 'Saving…' : '＋ Add to Vault as .md'}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="gchat-msg gchat-msg--assistant">
                    <span className="gchat-msg-av">✦</span>
                    <div className="gchat-msg-col">
                      <div className="gchat-live">
                        {liveSteps.map((s, j) => (
                          <div key={j} className={`gchat-step${j === liveSteps.length - 1 ? ' is-active' : ''}`}>
                            <span className="gchat-step-ic">{s.icon}</span>{s.text}
                          </div>
                        ))}
                        <div className="gchat-step is-active">
                          <span className="gchat-dots"><span /><span /><span /></span>
                          {liveSteps.length ? 'Working…' : webResearch ? 'Researching…' : 'Thinking…'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {error && <div className="gchat-error">{error}</div>}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <div className="gchat-composer">
            <button
              type="button"
              className={`gchat-web${webResearch ? ' is-on' : ''}`}
              onClick={() => setWebResearch((v) => !v)}
              title={webResearch ? 'Web research ON' : 'Web research OFF'}
            >
              🔍
            </button>
            <textarea
              ref={inputRef}
              className="gchat-input"
              rows={1}
              placeholder="Ask or assign a task…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={sending}
            />
            <button
              type="button"
              className={`gchat-send${draft.trim() && !sending ? ' is-on' : ''}`}
              onClick={() => void send(draft)}
              disabled={!draft.trim() || sending}
              title="Send"
            >
              {sending ? <span className="gchat-send-spinner" /> : '↑'}
            </button>
          </div>

          {action && (
            <div className="gchat-action-overlay">
              <div className="gchat-action-modal">
                <div className="gchat-action-head">
                  <span className="gchat-action-ic">⚡</span>
                  <span className="gchat-action-title">{action.label}</span>
                  {action.phase !== 'running' && (
                    <button type="button" className="gchat-action-x" onClick={() => setAction(null)} aria-label="Close">✕</button>
                  )}
                </div>

                {action.phase === 'confirm' && (
                  <>
                    <p className="gchat-action-desc">I’ll carry this out now:</p>
                    <div className="gchat-action-prompt">{action.prompt}</div>
                    <div className="gchat-action-actions">
                      <button type="button" className="gchat-action-btn ghost" onClick={() => setAction(null)}>Cancel</button>
                      <button type="button" className="gchat-action-btn primary" onClick={() => void runAction()}>Proceed →</button>
                    </div>
                  </>
                )}

                {(action.phase === 'running' || action.phase === 'done' || action.phase === 'error') && (
                  <div className="gchat-action-feed">
                    {action.steps.map((s, j) => (
                      <div key={j} className={`gchat-step${action.phase === 'running' && j === action.steps.length - 1 ? ' is-active' : ''}`}>
                        <span className="gchat-step-ic">{s.icon}</span>{s.text}
                      </div>
                    ))}
                    {action.phase === 'running' && (
                      <div className="gchat-step is-active">
                        <span className="gchat-dots"><span /><span /><span /></span>
                        {action.steps.length ? 'Working…' : 'Starting…'}
                      </div>
                    )}
                  </div>
                )}

                {action.phase === 'done' && (
                  <>
                    {action.result && <div className="gchat-action-result">{render(action.result)}</div>}
                    <div className="gchat-action-actions">
                      <button type="button" className="gchat-action-btn primary" onClick={() => setAction(null)}>Done</button>
                    </div>
                  </>
                )}

                {action.phase === 'error' && (
                  <>
                    <div className="gchat-action-error">{action.error}</div>
                    <div className="gchat-action-actions">
                      <button type="button" className="gchat-action-btn ghost" onClick={() => setAction(null)}>Close</button>
                      <button type="button" className="gchat-action-btn primary" onClick={() => void runAction()}>Retry</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

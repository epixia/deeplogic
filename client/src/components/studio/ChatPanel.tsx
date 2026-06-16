// ChatPanel — the LEFT pane of the Studio editor (owner only). Renders the
// message history (user/assistant bubbles), a generating indicator, the prompt
// composer, and a welcome/empty state with starter prompts.

import { useEffect, useRef, useState, useCallback, type ClipboardEvent, type DragEvent, type JSX, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { createContext } from '../../lib/api'
import type { ModelListItem } from '../../types'
import type { PromptAttachment, StudioMessage } from '../../lib/api'

const ATTACH_ACCEPT =
  'image/*,.pdf,.html,.htm,.txt,.md,.csv,.json,.xml,.yaml,.yml'
const MAX_ATTACH = 6
const MAX_BYTES = 10 * 1024 * 1024 // 10MB per file

const isImage = (f: File) => f.type.startsWith('image/')
const isPdf = (f: File) =>
  f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g
function renderWithLinks(text: string) {
  const parts: (string | JSX.Element)[] = []
  let last = 0
  let m: RegExpExecArray | null
  LINK_RE.lastIndex = 0
  while ((m = LINK_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(<Link key={m.index} to={m[2]}>{m[1]}</Link>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('read failed'))
    r.onload = () => {
      const res = String(r.result || '')
      resolve(res.includes(',') ? res.slice(res.indexOf(',') + 1) : res)
    }
    r.readAsDataURL(file)
  })
}

// Resize an image to at most maxPx on the longest side and re-encode.
// Keeps PNG for PNGs (to preserve transparency), uses JPEG for everything else.
// Result is typically 30–100KB, well within context-window limits.
function resizeImage(file: File, maxPx = 800, quality = 0.82): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const { naturalWidth: w, naturalHeight: h } = img
      const scale = w > maxPx || h > maxPx ? Math.min(maxPx / w, maxPx / h) : 1
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('canvas not supported')); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const mediaType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
      const dataUrl = canvas.toDataURL(mediaType, quality)
      resolve({ base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType })
    }
    img.onerror = () => reject(new Error('Image decode failed'))
    img.src = url
  })
}

async function fileToAttachment(file: File): Promise<PromptAttachment> {
  if (isImage(file)) {
    const { base64, mediaType } = await resizeImage(file)
    return { kind: 'image', name: file.name, mediaType, dataBase64: base64 }
  }
  if (isPdf(file)) {
    return {
      kind: 'pdf',
      name: file.name,
      mediaType: 'application/pdf',
      dataBase64: await readAsBase64(file),
    }
  }
  const text = await file.text()
  return { kind: 'text', name: file.name, text: text.slice(0, 60000) }
}

const STARTERS = [
  'Build a KPI dashboard with trend charts and an executive summary.',
  'Create a one-page board report from this data.',
  'Make a visual sales pipeline tracker with key metrics.',
  'Build a clean landing page for our product launch.',
]

interface Props {
  orgId: string
  messages: StudioMessage[]
  hasHtml: boolean
  generating: boolean
  pendingPrompt: string | null
  lastUsedAI: boolean | null
  models: ModelListItem[]
  modelId: string | null
  onModelChange: (modelId: string | null) => void
  onSend: (prompt: string, attachments: PromptAttachment[]) => void
  onShowContext: () => void
  error: string | null
}

export default function ChatPanel({
  orgId,
  messages,
  hasHtml,
  generating,
  pendingPrompt,
  onSend,
  error,
}: Props) {
  const { getAccessToken } = useAuth()
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<PromptAttachment[]>([])
  const [savedAtts, setSavedAtts] = useState<Set<number>>(new Set())
  const [savingAtts, setSavingAtts] = useState<Set<number>>(new Set())
  const [attachError, setAttachError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ---- voice input ----
  const [listening, setListening] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const voiceBaseRef = useRef('') // draft text before voice started

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SpeechRecognitionAPI: any =
    typeof window !== 'undefined'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition)
      : undefined

  const voiceSupported = !!SpeechRecognitionAPI

  const stopVoice = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setListening(false)
  }, [])

  function toggleVoice() {
    if (listening) { stopVoice(); return }
    if (!SpeechRecognitionAPI) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new SpeechRecognitionAPI() as any
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    voiceBaseRef.current = draft
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let interim = ''
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim += t
      }
      if (final) voiceBaseRef.current = (voiceBaseRef.current + ' ' + final).trim()
      const combined = interim
        ? (voiceBaseRef.current + ' ' + interim).trim()
        : voiceBaseRef.current
      setDraft(combined)
      autoResize()
    }
    rec.onerror = () => stopVoice()
    rec.onend = () => setListening(false)
    rec.start()
    recognitionRef.current = rec
    setListening(true)
  }

  // Stop voice on unmount
  useEffect(() => () => stopVoice(), [stopVoice])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, generating, pendingPrompt])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 180) + 'px'
  }

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setAttachError(null)
    const incoming = Array.from(files)
    const next: PromptAttachment[] = [...attachments]
    for (const f of incoming) {
      if (next.length >= MAX_ATTACH) {
        setAttachError(`Up to ${MAX_ATTACH} attachments per prompt.`)
        break
      }
      if (f.size > MAX_BYTES) {
        setAttachError(`"${f.name}" is over 10MB.`)
        continue
      }
      try {
        next.push(await fileToAttachment(f))
      } catch {
        setAttachError(`Couldn't read "${f.name}".`)
      }
    }
    setAttachments(next)
    if (fileRef.current) fileRef.current.value = ''
  }

  function removeAttachment(i: number) {
    setAttachments((prev) => prev.filter((_, idx) => idx !== i))
    setSavedAtts((prev) => { const s = new Set(prev); s.delete(i); return s })
    setSavingAtts((prev) => { const s = new Set(prev); s.delete(i); return s })
  }

  async function saveToLibrary(i: number, a: PromptAttachment) {
    if (!a.dataBase64 || savingAtts.has(i) || savedAtts.has(i)) return
    setSavingAtts((prev) => new Set(prev).add(i))
    try {
      const token = await getAccessToken()
      if (!token) return
      const mime = a.mediaType ?? 'image/png'
      await createContext(token, orgId, {
        kind: 'image',
        name: a.name,
        content: `data:${mime};base64,${a.dataBase64}`,
        scope: 'org',
      })
      setSavedAtts((prev) => new Set(prev).add(i))
    } catch { /* ignore */ } finally {
      setSavingAtts((prev) => { const s = new Set(prev); s.delete(i); return s })
    }
  }

  function send(text: string) {
    stopVoice()
    const prompt = text.trim()
    if ((!prompt && attachments.length === 0) || generating) return
    onSend(prompt || 'Use the attached file(s) to build/update this report.', attachments)
    setDraft('')
    setAttachments([])
    setAttachError(null)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(draft)
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = e.clipboardData?.files
    if (files && files.length > 0) {
      e.preventDefault()
      void addFiles(files)
    }
  }

  const [dragOver, setDragOver] = useState(false)
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files)
  }

  const showEmpty = !hasHtml && messages.length === 0 && !pendingPrompt
  const canSend = !generating && (!!draft.trim() || attachments.length > 0)

  return (
    <section className="studio-panel chat-col">
      <div className="studio-chat" ref={scrollRef}>
        {showEmpty ? (
          <div className="editor-empty">
            <div className="editor-empty-icon">✦</div>
            <h3>What do you want to build?</h3>
            <p>Describe it in plain language — I'll write the HTML. Drop in an image, PDF or file to build from it.</p>
            <div className="editor-starters">
              {STARTERS.map((s) => (
                <button key={s} type="button" className="editor-starter" onClick={() => send(s)} disabled={generating}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-messages">
            {messages.map((m, i) => {
              if (m.role === 'user') {
                return (
                  <div key={`${m.ts}-${i}`} className="chat-row chat-row--user">
                    <div className="chat-bubble user">{m.content}</div>
                  </div>
                )
              }
              return (
                <div key={`${m.ts}-${i}`} className="chat-row chat-row--ai">
                  <div className="chat-ai-avatar">✦</div>
                  <div className="chat-ai-body">
                    <div className="chat-bubble assistant">{renderWithLinks(m.content)}</div>
                  </div>
                </div>
              )
            })}
            {pendingPrompt && (
              <div className="chat-row chat-row--user">
                <div className="chat-bubble user is-pending">{pendingPrompt}</div>
              </div>
            )}
            {generating && (
              <div className="chat-row chat-row--ai">
                <div className="chat-ai-avatar">✦</div>
                <div className="chat-working">
                  <span className="chat-working-dots"><span /><span /><span /></span>
                  Building…
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <div className="studio-error chat-error">{error}</div>}

      <div className="chat-composer-wrap">
        <div
          className={`chat-composer ${dragOver ? 'is-drop' : ''}`}
          onDragOver={(e) => { e.preventDefault(); if (!generating) setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {dragOver && <div className="chat-drop-hint">Drop to attach</div>}
          {(attachments.length > 0 || attachError) && (
            <div className="chat-attachments">
              {attachments.map((a, i) => (
                <span className={`chat-att chat-att-${a.kind}`} key={`${a.name}-${i}`}>
                  <span className="chat-att-ic">
                    {a.kind === 'image' ? '🖼' : a.kind === 'pdf' ? '📕' : '📄'}
                  </span>
                  <span className="chat-att-name">{a.name}</span>
                  {a.kind === 'image' && a.dataBase64 && (
                    <button
                      type="button"
                      className={`chat-att-save${savedAtts.has(i) ? ' chat-att-save--done' : ''}`}
                      onClick={() => void saveToLibrary(i, a)}
                      disabled={savingAtts.has(i) || savedAtts.has(i)}
                      title={savedAtts.has(i) ? 'Saved to library' : 'Save to Context Library'}
                    >
                      {savedAtts.has(i) ? '✓' : savingAtts.has(i) ? '…' : '⊕'}
                    </button>
                  )}
                  <button type="button" className="chat-att-x" onClick={() => removeAttachment(i)} aria-label={`Remove ${a.name}`}>✕</button>
                </span>
              ))}
              {attachError && <span className="chat-att-err">{attachError}</span>}
            </div>
          )}
          <div className="chat-composer-inner">
            <input ref={fileRef} type="file" accept={ATTACH_ACCEPT} multiple style={{ display: 'none' }} onChange={(e) => void addFiles(e.target.files)} />
            <button
              type="button"
              className="chat-attach-btn"
              onClick={() => fileRef.current?.click()}
              disabled={generating || attachments.length >= MAX_ATTACH}
              title="Attach image, PDF, or file"
            >
              📎
            </button>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); autoResize() }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder={hasHtml ? 'Describe a change…' : 'Describe what to build…'}
              disabled={generating}
              rows={1}
            />
            {voiceSupported && (
              <button
                type="button"
                className={`chat-mic-btn${listening ? ' listening' : ''}`}
                onClick={toggleVoice}
                disabled={generating}
                title={listening ? 'Stop recording' : 'Speak your prompt'}
              >
                {listening ? '⏹' : '🎙'}
              </button>
            )}
            <button
              type="button"
              className={`chat-send-btn ${canSend ? 'active' : ''}`}
              onClick={() => send(draft)}
              disabled={!canSend}
              title={generating ? 'Building…' : hasHtml ? 'Update report' : 'Build report'}
            >
              {generating ? <span className="chat-send-spinner" /> : '↑'}
            </button>
          </div>
          <div className="chat-composer-hint">↵ send · ⇧↵ newline{voiceSupported ? ' · 🎙 voice' : ''}</div>
        </div>
      </div>
    </section>
  )
}

// ChatPanel — the LEFT pane of the Studio editor (owner only). Renders the
// message history (user/assistant/system bubbles), a "working" state while a
// generation is in flight, the context chips (link to Context Library + the
// grounding model picker), a "What the AI sees" trigger, the prompt composer,
// and — when there is no HTML yet — a friendly prompt-starter empty state.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import type { ModelListItem } from '../../types'
import type { PromptAttachment, StudioMessage } from '../../lib/api'

const ATTACH_ACCEPT =
  'image/*,.pdf,.html,.htm,.txt,.md,.csv,.json,.xml,.yaml,.yml'
const MAX_ATTACH = 6
const MAX_BYTES = 10 * 1024 * 1024 // 10MB per file

const isImage = (f: File) => f.type.startsWith('image/')
const isPdf = (f: File) =>
  f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

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

async function fileToAttachment(file: File): Promise<PromptAttachment> {
  if (isImage(file)) {
    return {
      kind: 'image',
      name: file.name,
      mediaType: file.type || 'image/png',
      dataBase64: await readAsBase64(file),
    }
  }
  if (isPdf(file)) {
    return {
      kind: 'pdf',
      name: file.name,
      mediaType: 'application/pdf',
      dataBase64: await readAsBase64(file),
    }
  }
  // html / text / markdown / csv / json → inline text
  const text = await file.text()
  return { kind: 'text', name: file.name, text: text.slice(0, 60000) }
}

const STARTERS = [
  'Build an executive summary of revenue and churn.',
  'Turn this into a one-page board report.',
  'Create a KPI dashboard with trend callouts and a short narrative.',
  'Summarize the highlights as a clean, printable brief.',
]

interface Props {
  orgId: string
  messages: StudioMessage[]
  hasHtml: boolean
  generating: boolean
  /** the user prompt currently in flight (shown optimistically) */
  pendingPrompt: string | null
  /** whether the last generation used the live AI vs the template engine */
  lastUsedAI: boolean | null
  /** grounding model picker */
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
  lastUsedAI,
  models,
  modelId,
  onModelChange,
  onSend,
  onShowContext,
  error,
}: Props) {
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<PromptAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // auto-scroll to newest message / working indicator
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, generating, pendingPrompt])

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
  }

  function send(text: string) {
    const prompt = text.trim()
    if ((!prompt && attachments.length === 0) || generating) return
    onSend(prompt || 'Use the attached file(s) to build/update this report.', attachments)
    setDraft('')
    setAttachments([])
    setAttachError(null)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(draft)
    }
  }

  // Paste an image/file straight into the chat input.
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = e.clipboardData?.files
    if (files && files.length > 0) {
      e.preventDefault()
      void addFiles(files)
    }
  }

  // Drag & drop files onto the composer.
  const [dragOver, setDragOver] = useState(false)
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files)
  }

  const groundModel = models.find((m) => m.id === modelId) ?? null
  const showEmpty = !hasHtml && messages.length === 0 && !pendingPrompt

  return (
    <section className="studio-panel chat-col">
      <div className="studio-panel-head">
        <span>Chat</span>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={onShowContext}
        >
          What the AI sees
        </button>
      </div>

      {/* context chips: library link + grounding model picker */}
      <div className="chat-chips">
        <Link to={`/app/${orgId}/studio`} className="chat-chip" title="Context Library">
          Context Library
        </Link>
        <span
          className={`chat-chip ${groundModel ? 'grounded' : ''}`}
          title="Ground this report in real KPIs from a semantic model"
        >
          {groundModel ? 'Grounded:' : 'Ground:'}
          <select
            value={modelId ?? ''}
            onChange={(e) => onModelChange(e.target.value || null)}
          >
            <option value="">None</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div className="studio-chat" ref={scrollRef} style={{ flex: '1 1 auto' }}>
        {showEmpty ? (
          <div className="editor-empty">
            <h3>Describe the report you want</h3>
            <p>
              Chat to generate a self-contained HTML report. Try one of these to
              get started:
            </p>
            <div className="editor-starters">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="editor-starter"
                  onClick={() => send(s)}
                  disabled={generating}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => {
              const isLastAssistant =
                m.role === 'assistant' &&
                i === lastIndex(messages, 'assistant')
              return (
                <div key={`${m.ts}-${i}`} className={`chat-bubble ${m.role}`}>
                  {m.content}
                  {isLastAssistant && lastUsedAI !== null && (
                    <div className="chat-meta-row">
                      <span className={`chat-badge ${lastUsedAI ? 'ai' : ''}`}>
                        {lastUsedAI ? 'AI' : 'Template'}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
            {pendingPrompt && (
              <div className="chat-bubble user is-pending">{pendingPrompt}</div>
            )}
            {generating && (
              <div className="chat-working">
                <span className="dot" />
                Generating report…
              </div>
            )}
          </>
        )}
      </div>

      {error && (
        <div className="studio-error" style={{ padding: '0 14px' }}>
          {error}
        </div>
      )}

      <div
        className={`chat-composer ${dragOver ? 'is-drop' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          if (!generating) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {dragOver && <div className="chat-drop-hint">Drop image / PDF / HTML to attach</div>}
        {(attachments.length > 0 || attachError) && (
          <div className="chat-attachments">
            {attachments.map((a, i) => (
              <span className={`chat-att chat-att-${a.kind}`} key={`${a.name}-${i}`}>
                <span className="chat-att-ic">
                  {a.kind === 'image' ? '🖼' : a.kind === 'pdf' ? '📕' : '📄'}
                </span>
                <span className="chat-att-name">{a.name}</span>
                <button
                  type="button"
                  className="chat-att-x"
                  onClick={() => removeAttachment(i)}
                  aria-label={`Remove ${a.name}`}
                >
                  ✕
                </button>
              </span>
            ))}
            {attachError && <span className="chat-att-err">{attachError}</span>}
          </div>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder="Describe a change, or paste / drop an image, PDF or HTML to build from…"
          disabled={generating}
        />
        <div className="chat-composer-foot">
          <div className="chat-composer-left">
            <input
              ref={fileRef}
              type="file"
              accept={ATTACH_ACCEPT}
              multiple
              style={{ display: 'none' }}
              onChange={(e) => void addFiles(e.target.files)}
            />
            <button
              type="button"
              className="btn btn-ghost btn-xs chat-attach-btn"
              onClick={() => fileRef.current?.click()}
              disabled={generating || attachments.length >= MAX_ATTACH}
              title="Attach image, PDF, or HTML"
            >
              📎 Attach
            </button>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-xs"
            onClick={() => send(draft)}
            disabled={generating || (!draft.trim() && attachments.length === 0)}
          >
            {generating ? 'Working…' : 'Send'}
          </button>
        </div>
      </div>
    </section>
  )
}

function lastIndex(messages: StudioMessage[], role: StudioMessage['role']): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === role) return i
  }
  return -1
}

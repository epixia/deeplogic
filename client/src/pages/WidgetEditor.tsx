import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  getOrgWidget,
  updateOrgWidget,
  generateOrgWidget,
  listContext,
  createContext,
  type Widget,
  type WidgetType,
  type WidgetSource,
  type ContextItem,
} from '../lib/api'
import '../components/studio/studio.css'
import './dashboards.css'

const TYPE_ICONS: Record<string, string> = {
  kpi: '📊', chart: '📈', table: '📋', insight: '💡', alert: '🔔', embed: '🔗', news: '📰',
}

const KIND_ICONS: Record<string, string> = {
  doc: '📄', html: '🌐', mcp: '🔌', note: '📝', image: '🖼',
}

const STARTERS: Record<WidgetType, string[]> = {
  kpi:     ['Show monthly recurring revenue with trend vs last month', 'Display total active users with % change this week', 'Net revenue retention — current vs prior quarter'],
  chart:   ['Bar chart of revenue by region for the last 6 months', 'Line chart comparing new vs churned users week over week', 'Pie chart of revenue split by product tier'],
  table:   ['Top 10 customers by lifetime value', 'Latest 10 transactions with status and amount', 'Products ranked by revenue this quarter'],
  insight: ['Summarise key business performance in 3 bullet points', 'What are the top risks based on the current data?', 'Write an executive summary of this month\'s metrics'],
  alert:   ['Alert when churn rate exceeds 5%', 'Alert when support tickets exceed 100 open', 'Flag when MRR growth drops below 3% month-over-month'],
  embed:   ['Embed the live CRM pipeline view', 'Show the latest Slack channel summary', 'Embed the product roadmap status'],
  news:    ['Latest cannabis industry headlines from Google News', 'Top business news for the Canadian cannabis sector today', 'Recent regulatory updates and policy news for cannabis producers'],
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  ts: string
}

export default function WidgetEditor() {
  const { orgId = '', widgetId = '' } = useParams<{
    orgId: string; widgetId: string
  }>()
  const { getAccessToken } = useAuth()

  const [widget, setWidget] = useState<Widget | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [html, setHtml] = useState('')
  const [name, setName] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [listening, setListening] = useState(false)
  const [sources, setSources] = useState<WidgetSource[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [pickerMode, setPickerMode] = useState<'list' | 'add-api'>('list')
  const [pickerItems, setPickerItems] = useState<ContextItem[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [apiForm, setApiForm] = useState({ name: '', url: '', key: '', notes: '' })
  const [apiSaving, setApiSaving] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const voiceBaseRef = useRef('')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SpeechRecognitionAPI: any =
    typeof window !== 'undefined'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition)
      : undefined
  const voiceSupported = !!SpeechRecognitionAPI

  const token = useCallback(async () => {
    const t = await getAccessToken()
    if (!t) throw new Error('Session expired')
    return t
  }, [getAccessToken])

  useEffect(() => {
    let active = true
    setLoading(true)
    ;(async () => {
      try {
        const t = await token()
        const w = await getOrgWidget(t, orgId, widgetId)
        if (!active) return
        setWidget(w)
        setHtml(w.html ?? '')
        setName(w.name)
        setSources(w.sources ?? [])
        // seed chat with existing prompt if any
        if (w.prompt) {
          setMessages([{ role: 'user', content: w.prompt, ts: w.updatedAt }])
          if (w.html) {
            setMessages([
              { role: 'user', content: w.prompt, ts: w.updatedAt },
              { role: 'assistant', content: '✓ Widget generated', ts: w.updatedAt },
            ])
          }
        }
      } catch (e) {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load widget')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [token, orgId, widgetId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, generating])

  // Close picker on outside click
  useEffect(() => {
    if (!showPicker) return
    function handle(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showPicker])

  async function loadPickerItems() {
    if (pickerItems.length === 0 && !pickerLoading) {
      setPickerLoading(true)
      try {
        const t = await token()
        setPickerItems(await listContext(t, orgId))
      } catch { /* silent */ } finally { setPickerLoading(false) }
    }
  }

  async function openPicker() {
    setShowPicker((v) => !v)
    await loadPickerItems()
  }

  async function openPickerMode(mode: 'list' | 'add-api') {
    setPickerMode(mode)
    setShowPicker(true)
    await loadPickerItems()
  }

  async function saveSources(next: WidgetSource[]) {
    setSources(next)
    try {
      const t = await token()
      await updateOrgWidget(t, orgId, widgetId, { sources: next })
    } catch { /* silent */ }
  }

  function toggleSource(item: ContextItem) {
    const exists = sources.some((s) => s.ref === item.id)
    saveSources(
      exists
        ? sources.filter((s) => s.ref !== item.id)
        : [...sources, { type: 'library' as const, ref: item.id, name: item.name }],
    )
  }

  async function uploadDoc(file: File | undefined) {
    if (!file) return
    setUploading(true)
    try {
      const t = await token()
      const text = await file.text()
      const item = await createContext(t, orgId, {
        kind: 'doc',
        name: file.name.replace(/\.[^.]+$/, ''),
        content: text.slice(0, 60_000),
        scope: 'org',
      })
      setPickerItems((prev) => [item, ...prev])
      saveSources([...sources, { type: 'library' as const, ref: item.id, name: item.name }])
    } catch { /* silent */ } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function saveApi(e: React.FormEvent) {
    e.preventDefault()
    if (!apiForm.name.trim() || !apiForm.url.trim() || apiSaving) return
    setApiSaving(true)
    try {
      const t = await token()
      const content = [
        `API Endpoint: ${apiForm.url.trim()}`,
        apiForm.key.trim() ? `API Key: ${apiForm.key.trim()}` : '',
        apiForm.notes.trim() ? `\nNotes / Schema:\n${apiForm.notes.trim()}` : '',
      ].filter(Boolean).join('\n')
      const item = await createContext(t, orgId, {
        kind: 'mcp',
        name: apiForm.name.trim(),
        content,
        scope: 'org',
      })
      setPickerItems((prev) => [item, ...prev])
      saveSources([...sources, { type: 'library' as const, ref: item.id, name: item.name }])
      setApiForm({ name: '', url: '', key: '', notes: '' })
      setPickerMode('list')
    } catch { /* silent */ } finally { setApiSaving(false) }
  }

  const stopVoice = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setListening(false)
  }, [])

  useEffect(() => () => stopVoice(), [stopVoice])

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
      let interim = '', final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim += t
      }
      if (final) voiceBaseRef.current = (voiceBaseRef.current + ' ' + final).trim()
      setDraft(interim ? (voiceBaseRef.current + ' ' + interim).trim() : voiceBaseRef.current)
    }
    rec.onerror = () => stopVoice()
    rec.onend = () => setListening(false)
    rec.start()
    recognitionRef.current = rec
    setListening(true)
  }

  async function onNameBlur() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === widget?.name) { setName(widget?.name ?? ''); return }
    try {
      const t = await token()
      await updateOrgWidget(t, orgId, widgetId, { name: trimmed })
      setWidget((prev) => prev ? { ...prev, name: trimmed } : prev)
    } catch { /* silent */ }
  }

  async function onSend() {
    stopVoice()
    const prompt = draft.trim()
    if (!prompt || generating) return
    setDraft('')
    setGenError(null)
    setGenerating(true)
    setMessages((prev) => [...prev, { role: 'user', content: prompt, ts: new Date().toISOString() }])
    try {
      const t = await token()
      const { widget: updated } = await generateOrgWidget(t, orgId, widgetId, prompt)
      setHtml(updated.html ?? '')
      setWidget(updated)
      setMessages((prev) => [...prev, { role: 'assistant', content: '✓ Widget generated successfully', ts: new Date().toISOString() }])
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Generation failed'
      setGenError(msg)
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠ ${msg}`, ts: new Date().toISOString() }])
    } finally {
      setGenerating(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void onSend()
    }
  }

  if (loading) {
    return (
      <main className="wrap studio">
        <div className="placeholder-panel"><div className="dl-spinner" /><h2>Loading widget…</h2></div>
      </main>
    )
  }

  if (loadError || !widget) {
    return (
      <main className="wrap studio">
        <div className="studio-empty">
          <p>{loadError ?? 'Widget not found.'}</p>
          <Link to={`/app/${orgId}/widgets`} className="btn btn-ghost btn-xs">← Widgets</Link>
        </div>
      </main>
    )
  }

  const starters = STARTERS[widget.type] ?? []

  return (
    <main className="wrap studio studio-editor">
      {/* Top bar */}
      <div className="editor-bar">
        <div className="editor-bar-left">
          <Link to={`/app/${orgId}/widgets`} className="editor-back">← Widgets</Link>
          <input
            className="editor-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={onNameBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            aria-label="Widget name"
          />
          <span style={{
            fontSize: 12, padding: '2px 8px', borderRadius: 10,
            background: 'rgba(111,227,240,.1)', border: '1px solid rgba(111,227,240,.2)',
            color: '#6fe3f0', whiteSpace: 'nowrap',
          }}>
            {TYPE_ICONS[widget.type]} {widget.type}
          </span>
        </div>
      </div>

      {/* Split body */}
      <div className="studio-split">
        {/* LEFT — chat */}
        <div className="studio-panel chat-col">
          <div className="studio-chat">
            {messages.length === 0 ? (
              <div className="editor-empty">
                <div className="editor-empty-icon">{TYPE_ICONS[widget.type] ?? '📊'}</div>
                <h3>Describe your {widget.type} widget</h3>
                <div className="editor-starters">
                  {starters.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="editor-starter"
                      onClick={() => { setDraft(s); textareaRef.current?.focus() }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="chat-messages">
                {messages.map((m, i) => (
                  m.role === 'user' ? (
                    <div key={i} className="chat-row chat-row--user">
                      <div className="chat-bubble user">{m.content}</div>
                    </div>
                  ) : (
                    <div key={i} className="chat-row chat-row--ai">
                      <div className="chat-ai-avatar">✦</div>
                      <div className="chat-ai-body">
                        <div className="chat-bubble assistant">{m.content}</div>
                      </div>
                    </div>
                  )
                ))}
                {generating && (
                  <div className="chat-row chat-row--ai">
                    <div className="chat-ai-avatar">✦</div>
                    <div className="chat-working">
                      <span className="chat-working-dots"><span /><span /><span /></span>
                      Generating widget…
                    </div>
                  </div>
                )}
                {genError && <div className="studio-error">{genError}</div>}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <div className="wg-composer-wrap">
            {/* Connectors strip — always visible */}
            <div className="wg-sources-strip wg-sources-strip--bar">
              {sources.map((s) => (
                <span key={s.ref} className="wg-source-chip">
                  <span className="wg-source-chip-icon">📄</span>
                  <span className="wg-source-chip-name">{s.name}</span>
                  <button
                    type="button"
                    className="wg-source-chip-x"
                    onClick={() => saveSources(sources.filter((x) => x.ref !== s.ref))}
                    title="Disconnect"
                  >✕</button>
                </span>
              ))}
              <button
                type="button"
                className="wg-add-connector-btn"
                onClick={() => void openPickerMode('list')}
                title="Browse existing connectors and documents"
              >
                📚 Library
              </button>
              <button
                type="button"
                className="wg-add-connector-btn"
                onClick={() => void openPickerMode('add-api')}
                title="Add a new API connector"
              >
                🔌 Add connector
              </button>
            </div>
            <div className="wg-composer">
              <div className="wg-composer-inner">
                {/* Data connector button + picker */}
                <div className="wg-picker-wrap" ref={pickerRef}>
                  <button
                    type="button"
                    className={`chat-attach-btn${showPicker ? ' active' : ''}`}
                    onClick={() => void openPicker()}
                    title="Connect a data source or document"
                  >
                    ⊕
                  </button>
                  {showPicker && (
                    <div className="wg-picker-dropdown">
                      <div className="wg-picker-head">
                        {pickerMode === 'add-api' ? (
                          <button type="button" className="wg-picker-back" onClick={() => setPickerMode('list')}>← Back</button>
                        ) : (
                          <span>Connect data</span>
                        )}
                        <button type="button" className="wg-picker-close" onClick={() => { setShowPicker(false); setPickerMode('list') }}>✕</button>
                      </div>

                      {pickerMode === 'add-api' ? (
                        <form className="wg-api-form" onSubmit={(e) => void saveApi(e)}>
                          <label className="wg-api-label">
                            Name
                            <input className="wg-api-input" placeholder="e.g. Sales API" value={apiForm.name} onChange={(e) => setApiForm((f) => ({ ...f, name: e.target.value }))} autoFocus required />
                          </label>
                          <label className="wg-api-label">
                            Endpoint URL
                            <input className="wg-api-input" placeholder="https://api.example.com/data" value={apiForm.url} onChange={(e) => setApiForm((f) => ({ ...f, url: e.target.value }))} required />
                          </label>
                          <label className="wg-api-label">
                            API Key <span className="wg-api-optional">(optional)</span>
                            <input className="wg-api-input" type="password" placeholder="sk-…" value={apiForm.key} onChange={(e) => setApiForm((f) => ({ ...f, key: e.target.value }))} />
                          </label>
                          <label className="wg-api-label">
                            Schema / sample response <span className="wg-api-optional">(optional)</span>
                            <textarea className="wg-api-input wg-api-textarea" placeholder='{"field": "value", …}' value={apiForm.notes} onChange={(e) => setApiForm((f) => ({ ...f, notes: e.target.value }))} rows={3} />
                          </label>
                          <button type="submit" className="wg-api-submit" disabled={apiSaving || !apiForm.name.trim() || !apiForm.url.trim()}>
                            {apiSaving ? 'Connecting…' : 'Connect API'}
                          </button>
                        </form>
                      ) : (
                        <>
                          <input
                            className="wg-picker-search"
                            placeholder="Search library…"
                            value={pickerSearch}
                            onChange={(e) => setPickerSearch(e.target.value)}
                            autoFocus
                          />
                          <div className="wg-picker-list">
                            {pickerLoading ? (
                              <div className="wg-picker-empty">Loading…</div>
                            ) : pickerItems.filter((i) =>
                                !pickerSearch || i.name.toLowerCase().includes(pickerSearch.toLowerCase())
                              ).length === 0 ? (
                              <div className="wg-picker-empty">No items yet — add one below</div>
                            ) : pickerItems
                                .filter((i) => !pickerSearch || i.name.toLowerCase().includes(pickerSearch.toLowerCase()))
                                .map((item) => {
                                  const selected = sources.some((s) => s.ref === item.id)
                                  return (
                                    <button
                                      key={item.id}
                                      type="button"
                                      className={`wg-picker-item${selected ? ' selected' : ''}`}
                                      onClick={() => toggleSource(item)}
                                    >
                                      <span className="wg-picker-item-icon">{KIND_ICONS[item.kind] ?? '📄'}</span>
                                      <span className="wg-picker-item-name">{item.name}</span>
                                      {selected && <span className="wg-picker-item-check">✓</span>}
                                    </button>
                                  )
                                })}
                          </div>
                          <div className="wg-picker-footer">
                            <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.json,.yaml,.yml,.html" style={{ display: 'none' }} onChange={(e) => void uploadDoc(e.target.files?.[0])} />
                            <button type="button" className="wg-picker-upload" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                              {uploading ? 'Uploading…' : '📄 Upload document'}
                            </button>
                            <button type="button" className="wg-picker-upload wg-picker-api-btn" onClick={() => setPickerMode('add-api')}>
                              🔌 Add API connector
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <textarea
                  ref={textareaRef}
                  className="wg-input"
                  rows={1}
                  placeholder={`Describe your ${widget.type} widget…`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={generating}
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
                  className={`wg-send-btn${draft.trim() && !generating ? ' active' : ''}`}
                  onClick={() => void onSend()}
                  disabled={generating || !draft.trim()}
                  title={generating ? 'Generating…' : 'Generate widget'}
                >
                  {generating ? <span className="chat-send-spinner" /> : '↑'}
                </button>
              </div>
              <div className="wg-composer-hint">↵ send · ⇧↵ newline{voiceSupported ? ' · 🎙 voice' : ''}</div>
            </div>
          </div>
        </div>

        {/* RIGHT — preview */}
        <div className="preview-col">
          {html ? (
            <iframe
              className="wg-iframe"
              srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:0;width:100%;height:100%;background:#060d1a;color:#e8f4f8;font-family:system-ui,sans-serif}</style></head><body>${html}</body></html>`}
              sandbox="allow-scripts"
              title="Widget preview"
              style={{ width: '100%', height: '100%', border: 'none', background: '#060d1a' }}
            />
          ) : (
            <div className="preview-empty">
              <div style={{ fontSize: 48, opacity: 0.2 }}>{TYPE_ICONS[widget.type] ?? '📊'}</div>
              <div style={{ color: '#4d6378', marginTop: 12 }}>Your widget will appear here</div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

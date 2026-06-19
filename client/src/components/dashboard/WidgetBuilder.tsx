// Widget Builder modal — create or edit a widget (type, size, prompt, sources).
import { useState, useEffect } from 'react'
import type { Widget, WidgetType, WidgetSource } from '../../lib/api'

interface LibraryItem {
  id: string
  name: string
  kind: string
}

interface Props {
  initial?: Widget | null
  libraryItems: LibraryItem[]
  onSave: (data: {
    name: string
    type: WidgetType
    prompt: string
    sources: WidgetSource[]
    gridW: number
    gridH: number
  }) => void
  onClose: () => void
  saving?: boolean
}

const TYPES: { type: WidgetType; icon: string; label: string }[] = [
  { type: 'kpi',     icon: '📊', label: 'KPI' },
  { type: 'chart',   icon: '📈', label: 'Chart' },
  { type: 'table',   icon: '📋', label: 'Table' },
  { type: 'insight', icon: '💡', label: 'Insight' },
  { type: 'alert',   icon: '🔔', label: 'Alert' },
  { type: 'embed',   icon: '🔗', label: 'Embed' },
]

export default function WidgetBuilder({ initial, libraryItems, onSave, onClose, saving }: Props) {
  const [name, setName]       = useState(initial?.name ?? '')
  const [type, setType]       = useState<WidgetType>(initial?.type ?? 'kpi')
  const [prompt, setPrompt]   = useState(initial?.prompt ?? '')
  const [sources, setSources] = useState<WidgetSource[]>(initial?.sources ?? [])
  const [gridW, setGridW]     = useState(initial?.gridW ?? 2)
  const [gridH, setGridH]     = useState(initial?.gridH ?? 2)
  const [addRef, setAddRef]   = useState('')

  useEffect(() => {
    if (initial) {
      setName(initial.name)
      setType(initial.type)
      setPrompt(initial.prompt ?? '')
      setSources(initial.sources)
      setGridW(initial.gridW)
      setGridH(initial.gridH)
    }
  }, [initial?.id])

  function addSource() {
    if (!addRef) return
    const item = libraryItems.find((i) => i.id === addRef)
    if (!item) return
    if (sources.some((s) => s.ref === item.id)) return
    setSources((prev) => [...prev, { type: 'library', ref: item.id, name: item.name }])
    setAddRef('')
  }

  function removeSource(ref: string) {
    setSources((prev) => prev.filter((s) => s.ref !== ref))
  }

  function handleSave() {
    if (!name.trim()) return
    onSave({ name: name.trim(), type, prompt, sources, gridW, gridH })
  }

  const availableToAdd = libraryItems.filter((i) => !sources.some((s) => s.ref === i.id))

  return (
    <div className="wb-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wb-dialog">
        <div className="wb-header">
          <span className="wb-title">{initial ? 'Edit Widget' : 'New Widget'}</span>
          <button className="wb-close" onClick={onClose}>✕</button>
        </div>

        <div className="wb-body">
          {/* Name */}
          <div className="wb-field">
            <label className="wb-label">Widget name</label>
            <input
              className="wb-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Revenue this quarter…"
              autoFocus
            />
          </div>

          {/* Type */}
          <div className="wb-field">
            <label className="wb-label">Widget type</label>
            <div className="wb-type-grid">
              {TYPES.map((t) => (
                <button
                  key={t.type}
                  className={`wb-type-btn${type === t.type ? ' selected' : ''}`}
                  onClick={() => setType(t.type)}
                >
                  <span className="wb-type-icon">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt */}
          <div className="wb-field">
            <label className="wb-label">Vibe prompt</label>
            <textarea
              className="wb-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                type === 'kpi'     ? 'Show monthly recurring revenue with trend vs last month' :
                type === 'chart'   ? 'Bar chart of revenue by region for last 6 months' :
                type === 'table'   ? 'Top 10 customers by lifetime value' :
                type === 'insight' ? 'Summarise key business performance in 3 bullet points' :
                type === 'alert'   ? 'Alert when churn rate exceeds 5%' :
                'Embed the CRM opportunity pipeline'
              }
            />
          </div>

          {/* Size */}
          <div className="wb-field">
            <label className="wb-label">Size <span className="wb-size-hint">drag to fine-tune on the dashboard</span></label>
            <div className="wb-size-visual">
              {/* Width (6-column grid → half steps) */}
              <div className="wb-size-group">
                {[{ v: 2, l: 'Small' }, { v: 3, l: 'Half' }, { v: 4, l: 'Wide' }, { v: 6, l: 'Full' }].map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    className={`wb-size-btn${gridW === o.v ? ' selected' : ''}`}
                    onClick={() => setGridW(o.v)}
                    title={`Width: ${o.l}`}
                  >
                    <span className="wb-size-preview" style={{ '--cols': o.v } as React.CSSProperties}>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <span key={i} className={`wb-size-cell${i < o.v ? ' on' : ''}`} />
                      ))}
                    </span>
                    <span className="wb-size-label">{o.l}</span>
                  </button>
                ))}
              </div>
              {/* Height (half-height rows) */}
              <div className="wb-size-group">
                {[{ v: 2, l: 'Short' }, { v: 3, l: 'Medium' }, { v: 4, l: 'Tall' }].map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    className={`wb-size-btn${gridH === o.v ? ' selected' : ''}`}
                    onClick={() => setGridH(o.v)}
                    title={`Height: ${o.l}`}
                  >
                    <span className="wb-size-preview wb-size-preview--h" style={{ '--rows': o.v } as React.CSSProperties}>
                      {Array.from({ length: 4 }).map((_, i) => (
                        <span key={i} className={`wb-size-cell wb-size-cell--row${i < o.v ? ' on' : ''}`} />
                      ))}
                    </span>
                    <span className="wb-size-label">{o.l}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Data sources */}
          <div className="wb-field">
            <label className="wb-label">Data sources</label>
            <div className="wb-source-list">
              {sources.map((s) => (
                <div key={s.ref} className="wb-source-item">
                  <span className="wb-source-name">{s.name}</span>
                  <span className="wb-source-type">{s.type}</span>
                  <button className="wb-source-rm" onClick={() => removeSource(s.ref)}>✕</button>
                </div>
              ))}
            </div>
            {availableToAdd.length > 0 && (
              <div className="wb-source-add" style={{ marginTop: sources.length ? 8 : 0 }}>
                <select
                  className="wb-select"
                  value={addRef}
                  onChange={(e) => setAddRef(e.target.value)}
                >
                  <option value="">Select library item…</option>
                  {availableToAdd.map((i) => (
                    <option key={i.id} value={i.id}>{i.name} ({i.kind})</option>
                  ))}
                </select>
                <button className="wb-source-add-btn" onClick={addSource} disabled={!addRef}>
                  + Add
                </button>
              </div>
            )}
            {availableToAdd.length === 0 && sources.length === 0 && (
              <div style={{ fontSize: 12, color: '#4d6378' }}>
                No library items available — add documents or connectors in the Vault.
              </div>
            )}
          </div>
        </div>

        <div className="wb-footer">
          <button type="button" className="wb-cancel" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="wb-save"
            onClick={handleSave}
            disabled={!name.trim() || saving}
          >
            {saving ? 'Saving…' : (initial ? 'Save changes' : 'Create widget')}
          </button>
        </div>
      </div>
    </div>
  )
}

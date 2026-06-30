import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useStickyTab } from '../lib/useStickyTab'
import { useAuth } from '../auth/AuthContext'
import {
  listAlerts,
  createAlert,
  updateAlert,
  deleteAlert,
  checkAlert,
  listAlertEvents,
  listContext,
  type Alert,
  type AlertKind,
  type AlertConfig,
  type AlertEvent,
  type WidgetSource,
} from '../lib/api'
import '../components/studio/studio.css'
import './alerts.css'

interface LibraryItem { id: string; name: string; kind: string }

type Tab = 'all' | 'active' | 'paused'
const TABS: readonly Tab[] = ['all', 'active', 'paused']

type Draft = {
  name: string
  kind: AlertKind
  condition: string
  url: string
  keywords: string
  path: string
  op: 'gt' | 'lt' | 'eq'
  value: string
  notifyEmail: string
  status: 'active' | 'paused'
}

const BLANK: Draft = { name: '', kind: 'ai', condition: '', url: '', keywords: '', path: '', op: 'gt', value: '', notifyEmail: '', status: 'active' }

const KIND_META: Record<AlertKind, { label: string; icon: string }> = {
  ai: { label: 'AI condition', icon: '✦' },
  keyword: { label: 'Keyword', icon: '🔍' },
  uptime: { label: 'Uptime', icon: '🌐' },
  threshold: { label: 'Threshold', icon: '📈' },
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  )
}

export default function Alerts() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const { getAccessToken } = useAuth()

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [library, setLibrary] = useState<LibraryItem[]>([])
  const [tab, setTab] = useStickyTab<Tab>(`alerts.tab.${orgId}`, 'all', TABS)

  const [checkState, setCheckState] = useState<
    Record<string, { checking: boolean; fired?: boolean; summary?: string }>
  >({})

  // events history modal
  const [eventsAlert, setEventsAlert] = useState<Alert | null>(null)
  const [events, setEvents] = useState<AlertEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)

  // create / edit modal
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Alert | null>(null)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [sources, setSources] = useState<WidgetSource[]>([])
  const [addRef, setAddRef] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const [als, items] = await Promise.all([
        listAlerts(t, orgId),
        listContext(t, orgId).catch(() => [] as LibraryItem[]),
      ])
      setAlerts(als)
      setLibrary((items ?? []).map((i: LibraryItem) => ({ id: i.id, name: i.name, kind: i.kind })))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alerts')
    } finally {
      setLoading(false)
    }
  }, [orgId, getAccessToken])

  useEffect(() => { void load() }, [load])

  const activeAlerts = alerts.filter((a) => a.status === 'active')
  const pausedAlerts = alerts.filter((a) => a.status === 'paused')
  const visible = tab === 'all' ? alerts : tab === 'active' ? activeAlerts : pausedAlerts

  function openCreate() {
    setEditing(null)
    setDraft(BLANK)
    setSources([])
    setAddRef('')
    setFormError(null)
    setShowModal(true)
    setTimeout(() => nameRef.current?.focus(), 50)
  }

  function openEdit(a: Alert) {
    setEditing(a)
    setDraft({
      name: a.name, kind: a.kind ?? 'ai', condition: a.condition,
      url: a.config?.url ?? '',
      keywords: (a.config?.keywords ?? []).join(', '),
      path: a.config?.path ?? '',
      op: a.config?.op ?? 'gt',
      value: a.config?.value != null ? String(a.config.value) : '',
      notifyEmail: a.notifyEmail ?? '', status: a.status,
    })
    setSources(a.sources ?? [])
    setAddRef('')
    setFormError(null)
    setShowModal(true)
    setTimeout(() => nameRef.current?.focus(), 50)
  }

  function closeModal() { setShowModal(false); setEditing(null) }

  function addSource() {
    if (!addRef) return
    const item = library.find((i) => i.id === addRef)
    if (!item || sources.some((s) => s.ref === item.id)) return
    setSources((prev) => [...prev, { type: 'library', ref: item.id, name: item.name }])
    setAddRef('')
  }

  async function handleSave() {
    if (!draft.name.trim()) { setFormError('Name is required'); return }
    let config: AlertConfig = {}
    let condition = draft.condition.trim()
    if (draft.kind === 'ai') {
      if (!condition) { setFormError('Condition is required'); return }
    } else {
      if (!draft.url.trim()) { setFormError('A URL is required for this trigger'); return }
      if (draft.kind === 'keyword') {
        const keywords = draft.keywords.split(',').map((s) => s.trim()).filter(Boolean)
        if (!keywords.length) { setFormError('Add at least one keyword'); return }
        config = { url: draft.url.trim(), keywords }
        condition = condition || `Keyword: ${keywords.join(', ')}`
      } else if (draft.kind === 'uptime') {
        config = { url: draft.url.trim() }
        condition = condition || 'Site uptime monitor'
      } else if (draft.kind === 'threshold') {
        if (!draft.path.trim() || draft.value === '') { setFormError('Path and value are required'); return }
        config = { url: draft.url.trim(), path: draft.path.trim(), op: draft.op, value: Number(draft.value) }
        condition = condition || `${draft.path} ${draft.op} ${draft.value}`
      }
    }
    setFormError(null)
    setSaving(true)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const body = {
        name: draft.name.trim(),
        kind: draft.kind,
        condition,
        config,
        sources: draft.kind === 'ai' ? sources : [],
        notifyEmail: draft.notifyEmail.trim() || undefined,
        status: draft.status,
      }
      if (editing) {
        const updated = await updateAlert(t, orgId, editing.id, body)
        setAlerts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
      } else {
        const created = await createAlert(t, orgId, body)
        setAlerts((prev) => [created, ...prev])
      }
      closeModal()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(a: Alert) {
    if (!confirm(`Delete alert "${a.name}"?`)) return
    try {
      const t = await getAccessToken()
      if (!t) return
      await deleteAlert(t, orgId, a.id)
      setAlerts((prev) => prev.filter((x) => x.id !== a.id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function handleCheck(a: Alert) {
    setCheckState((prev) => ({ ...prev, [a.id]: { checking: true } }))
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const result = await checkAlert(t, orgId, a.id)
      setCheckState((prev) => ({
        ...prev,
        [a.id]: { checking: false, fired: result.fired, summary: result.summary },
      }))
      setAlerts((prev) =>
        prev.map((x) =>
          x.id === a.id
            ? {
                ...x,
                lastChecked: result.checkedAt,
                lastFired: result.fired ? result.checkedAt : x.lastFired,
                fireCount: result.fired ? x.fireCount + 1 : x.fireCount,
              }
            : x,
        ),
      )
    } catch (e) {
      setCheckState((prev) => ({
        ...prev,
        [a.id]: { checking: false, summary: e instanceof Error ? e.message : 'Check failed' },
      }))
    }
  }

  async function openHistory(a: Alert) {
    setEventsAlert(a)
    setEventsLoading(true)
    setEvents([])
    try {
      const t = await getAccessToken()
      if (!t) return
      setEvents(await listAlertEvents(t, orgId, a.id))
    } finally {
      setEventsLoading(false)
    }
  }

  return (
    <main className="wrap studio">
      <header className="studio-head">
        <div>
          <h1><span className="grad-text">Alerts</span></h1>
          <p className="studio-lead">
            AI-evaluated conditions that notify you when something changes in your data or the world.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          + New alert
        </button>
      </header>

      <div className="studio-tabs">
        <button
          type="button"
          className={`studio-tab ${tab === 'all' ? 'active' : ''}`}
          onClick={() => setTab('all')}
        >
          All<span className="count">{alerts.length}</span>
        </button>
        <button
          type="button"
          className={`studio-tab ${tab === 'active' ? 'active' : ''}`}
          onClick={() => setTab('active')}
        >
          Active<span className="count">{activeAlerts.length}</span>
        </button>
        <button
          type="button"
          className={`studio-tab ${tab === 'paused' ? 'active' : ''}`}
          onClick={() => setTab('paused')}
        >
          Paused<span className="count">{pausedAlerts.length}</span>
        </button>
      </div>

      {error && <div className="studio-error">{error}</div>}

      {loading ? (
        <div className="studio-empty"><div className="dl-spinner" /></div>
      ) : (
        <div className="studio-grid">
          {visible.map((a) => {
            const cs = checkState[a.id]
            const fired = cs?.fired
            const isChecking = cs?.checking
            const hasFired = a.lastFired !== null
            return (
              <div key={a.id} className="studio-card">
                <button
                  type="button"
                  className="sc-delete-btn"
                  title="Delete alert"
                  onClick={(e) => { e.stopPropagation(); void handleDelete(a) }}
                >
                  ✕
                </button>

                <div className="alert-card-hd">
                  <span
                    className={`alert-status-dot ${hasFired || fired ? 'fired' : 'ok'}`}
                    title={hasFired || fired ? 'Has fired' : 'OK'}
                  />
                  <span className="alert-kind-badge">{KIND_META[a.kind]?.icon ?? '✦'} {KIND_META[a.kind]?.label ?? 'AI'}</span>
                  {a.status === 'paused' && <span className="alert-badge-paused">Paused</span>}
                  {a.fireCount > 0 && (
                    <span className="studio-pill studio-pill-org" style={{ marginLeft: 'auto' }}>
                      {a.fireCount}× fired
                    </span>
                  )}
                </div>

                <h3>{a.name}</h3>
                <p className="alert-card-condition">{a.condition}</p>

                {cs?.summary && (
                  <div className={`alert-result${fired ? ' alert-result--fired' : ' alert-result--ok'}`}>
                    {fired ? '🔴' : '🟢'} {cs.summary}
                  </div>
                )}

                <div className="studio-card-meta">
                  {a.sources.length > 0 && (
                    <span>{a.sources.length} source{a.sources.length !== 1 ? 's' : ''}</span>
                  )}
                  <span>Checked {fmtDate(a.lastChecked)}</span>
                </div>

                <div className="studio-card-foot">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm alert-check-btn"
                      onClick={() => void handleCheck(a)}
                      disabled={isChecking || a.status === 'paused'}
                      title={a.status === 'paused' ? 'Resume to check' : 'Run AI check now'}
                    >
                      {isChecking ? <span className="dl-spinner dl-spinner--sm" /> : '▶ Check'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void openHistory(a)}
                    >
                      History
                    </button>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(a)}>
                    Edit
                  </button>
                </div>
              </div>
            )
          })}
          <button type="button" className="studio-card studio-card-new" onClick={openCreate}>
            <span className="plus">+</span>
            New alert
          </button>
        </div>
      )}

      {/* Fire history modal */}
      {eventsAlert && (
        <div className="studio-modal-backdrop" onClick={() => setEventsAlert(null)}>
          <div className="studio-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Fire history</h2>
            <p className="studio-modal-sub">{eventsAlert.name}</p>
            {eventsLoading ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <div className="dl-spinner" />
              </div>
            ) : events.length === 0 ? (
              <div className="studio-empty">This alert hasn&apos;t fired yet.</div>
            ) : (
              <div className="alert-events-list">
                {events.map((ev) => (
                  <div key={ev.id} className="alert-event-row">
                    <span className="alert-event-time">{fmtDate(ev.firedAt)}</span>
                    <span className="alert-event-summary">{ev.summary ?? '—'}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="studio-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEventsAlert(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / edit modal */}
      {showModal && (
        <div className="studio-modal-backdrop" onClick={() => !saving && closeModal()}>
          <div className="studio-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? 'Edit alert' : 'New alert'}</h2>
            <p className="studio-modal-sub">
              {editing
                ? 'Update the condition, sources, or notification settings.'
                : 'Describe what to watch for. DeepLogic will use AI to evaluate it against your data.'}
            </p>

            <label className="studio-field">
              <span>Name</span>
              <input
                ref={nameRef}
                className="studio-input"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Cannabis supply disruption"
                autoFocus
              />
            </label>

            <div className="studio-field">
              <span>Trigger</span>
              <div className="studio-seg studio-seg--wrap">
                {(['ai', 'keyword', 'uptime', 'threshold'] as AlertKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`studio-seg-btn${draft.kind === k ? ' active' : ''}`}
                    onClick={() => setDraft((d) => ({ ...d, kind: k }))}
                  >
                    {KIND_META[k].icon} {KIND_META[k].label}
                  </button>
                ))}
              </div>
            </div>

            {draft.kind !== 'ai' && (
              <label className="studio-field">
                <span>{draft.kind === 'uptime' ? 'URL to monitor' : draft.kind === 'keyword' ? 'Feed / API URL' : 'JSON API URL'}</span>
                <input
                  className="studio-input"
                  value={draft.url}
                  onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
                  placeholder="https://…"
                />
              </label>
            )}

            {draft.kind === 'keyword' && (
              <label className="studio-field">
                <span>Keywords <span style={{ fontSize: 11, opacity: 0.6, fontStyle: 'italic', textTransform: 'none' }}>(comma-separated)</span></span>
                <input
                  className="studio-input"
                  value={draft.keywords}
                  onChange={(e) => setDraft((d) => ({ ...d, keywords: e.target.value }))}
                  placeholder="trump, recall, shortage"
                />
              </label>
            )}

            {draft.kind === 'threshold' && (
              <>
                <label className="studio-field">
                  <span>JSON path <span style={{ fontSize: 11, opacity: 0.6, fontStyle: 'italic', textTransform: 'none' }}>(dot notation)</span></span>
                  <input className="studio-input" value={draft.path} onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value }))} placeholder="current.temp" />
                </label>
                <div className="studio-field">
                  <span>Condition</span>
                  <div className="alerts-threshold-row">
                    <select className="studio-input" value={draft.op} onChange={(e) => setDraft((d) => ({ ...d, op: e.target.value as 'gt' | 'lt' | 'eq' }))}>
                      <option value="gt">greater than &gt;</option>
                      <option value="lt">less than &lt;</option>
                      <option value="eq">equals =</option>
                    </select>
                    <input className="studio-input" type="number" value={draft.value} onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))} placeholder="0" />
                  </div>
                </div>
              </>
            )}

            {draft.kind === 'ai' && (
            <label className="studio-field">
              <span>Condition</span>
              <textarea
                className="studio-input studio-textarea"
                value={draft.condition}
                onChange={(e) => setDraft((d) => ({ ...d, condition: e.target.value }))}
                placeholder={`Describe what to watch for:\n• Alert if news mentions a significant supply disruption\n• Fire if weekly sales drop more than 20%\n• Notify me when a competitor launches a new product`}
                rows={4}
              />
            </label>
            )}

            {draft.kind === 'ai' && (
            <div className="studio-field">
              <span>
                Data sources{' '}
                <span style={{ fontSize: 11, opacity: 0.6, fontStyle: 'italic', textTransform: 'none' }}>
                  (optional)
                </span>
              </span>
              {sources.length > 0 && (
                <div className="alerts-sources">
                  {sources.map((s) => (
                    <div key={s.ref} className="alerts-source-chip">
                      <span>{s.name}</span>
                      <button
                        type="button"
                        onClick={() => setSources((p) => p.filter((x) => x.ref !== s.ref))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {library.length > 0 ? (
                <div className="alerts-source-add">
                  <select
                    className="studio-input"
                    value={addRef}
                    onChange={(e) => setAddRef(e.target.value)}
                  >
                    <option value="">— add a data source —</option>
                    {library
                      .filter((i) => !sources.some((s) => s.ref === i.id))
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({i.kind})
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={addSource}
                    disabled={!addRef}
                  >
                    Add
                  </button>
                </div>
              ) : (
                <p className="studio-file">No data sources yet — add content in Data Vault first.</p>
              )}
            </div>
            )}

            <label className="studio-field">
              <span>
                Notify email{' '}
                <span style={{ fontSize: 11, opacity: 0.6, fontStyle: 'italic', textTransform: 'none' }}>
                  (optional)
                </span>
              </span>
              <input
                type="email"
                className="studio-input"
                value={draft.notifyEmail}
                onChange={(e) => setDraft((d) => ({ ...d, notifyEmail: e.target.value }))}
                placeholder="you@example.com"
              />
            </label>

            <div className="studio-field">
              <span>Status</span>
              <div className="studio-seg">
                {(['active', 'paused'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`studio-seg-btn${draft.status === s ? ' active' : ''}`}
                    onClick={() => setDraft((d) => ({ ...d, status: s }))}
                  >
                    {s === 'active' ? '▶ Active' : '⏸ Paused'}
                  </button>
                ))}
              </div>
            </div>

            {formError && <div className="studio-error">{formError}</div>}

            <div className="studio-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create alert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

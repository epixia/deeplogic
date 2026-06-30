// Competitors — the "⚔ Competitors" tab of the Data Vault. Mirrors the company
// profile, but as a LIST: each competitor is stored as an enabled context note
// (name "Competitor: <X>", meta.competitor=true) so it grounds every report,
// widget, agent, and the assistant.
//
// "✨ Auto-fill" reuses analyzeUrl (company + competitive lenses) to populate a
// competitor from their own website.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStickyTab } from '../../lib/useStickyTab'
import {
  listContext,
  createContext,
  updateContext,
  deleteContext,
  analyzeUrl,
  analyzeCompetitors,
  suggestCompetitors,
  createDashboard,
  createWidget,
  getCompetitorTrends,
  type ContextItem,
  type CompetitorSuggestion,
  type CompetitorSeo,
  type CompetitorTrends,
  type WidgetType,
} from '../../lib/api'
import TrendChart from './TrendChart'
import './company-profile.css'

type CompView = 'cards' | 'list'
const COMP_VIEWS: readonly CompView[] = ['cards', 'list']
type SortKey = 'name' | 'website' | 'traffic' | 'keywords' | 'value' | 'pos1' | 'updated'

// Display a website as a bare domain — drop protocol, www, and trailing slash
// to save horizontal space in the list.
function cleanDomain(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '')
}

// Compact number formatting for SEO metrics (12345 → 12.3K).
function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${Math.round(n)}`
}

export const COMPETITOR_PREFIX = 'Competitor: '

interface Entry {
  id: string | null
  name: string
  website: string
  summary: string
  notes: string
  seo?: CompetitorSeo
}

const EMPTY: Entry = { id: null, name: '', website: '', summary: '', notes: '' }

function entryFromItem(it: ContextItem): Entry {
  const m = (it.meta ?? {}) as Record<string, unknown>
  const s = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : '')
  const seo = m.seo && typeof m.seo === 'object' ? (m.seo as CompetitorSeo) : undefined
  return {
    id: it.id,
    name: s('name') || it.name.replace(COMPETITOR_PREFIX, ''),
    website: s('website'),
    summary: s('summary'),
    notes: s('notes'),
    seo,
  }
}

function renderContent(e: Entry): string {
  const lines = [`# Competitor — ${e.name || 'Unnamed'}`]
  if (e.website) lines.push(`Website: ${e.website}`)
  if (e.summary.trim()) lines.push('', e.summary.trim())
  if (e.notes.trim()) lines.push('', '## Notes', e.notes.trim())
  return lines.join('\n')
}

export default function Competitors({
  orgId,
  getToken,
  onChange,
}: {
  orgId: string
  getToken: () => Promise<string>
  onChange?: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState<Entry | null>(null)
  const [saving, setSaving] = useState(false)
  const [autofilling, setAutofilling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<CompetitorSuggestion[] | null>(null)
  const [generating, setGenerating] = useState(false)
  const [addingIdx, setAddingIdx] = useState<number | null>(null)
  const [dashBusy, setDashBusy] = useState<string | null>(null)
  const [trends, setTrends] = useState<CompetitorTrends | null>(null)
  const [trendsBusy, setTrendsBusy] = useState(false)
  const [view, setView] = useStickyTab<CompView>(`vault.competitors.view.${orgId}`, 'cards', COMP_VIEWS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [analyzing, setAnalyzing] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('traffic')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const navigate = useNavigate()

  function sortBy(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(k)
      setSortDir(k === 'name' || k === 'website' ? 'asc' : 'desc') // metrics default high→low
    }
  }

  const sortedEntries = useMemo(() => {
    const val = (e: Entry): string | number | null => {
      switch (sortKey) {
        case 'name': return e.name.toLowerCase()
        case 'website': return e.website.toLowerCase()
        case 'traffic': return e.seo?.organicTraffic ?? null
        case 'keywords': return e.seo?.organicKeywords ?? null
        case 'value': return e.seo?.organicTrafficCost ?? null
        case 'pos1': return e.seo?.pos1 ?? null
        case 'updated': return e.seo?.fetchedAt ? Date.parse(e.seo.fetchedAt) : null
      }
    }
    const dir = sortDir === 'asc' ? 1 : -1
    return [...entries].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1 // nulls always last
      if (vb == null) return -1
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir
      return ((va as number) - (vb as number)) * dir
    })
  }, [entries, sortKey, sortDir])

  function renderTh(k: SortKey, label: string, num?: boolean) {
    const active = sortKey === k
    return (
      <th
        className={`cp-th${num ? ' cp-th--num' : ''}${active ? ' cp-th--active' : ''}`}
        onClick={() => sortBy(k)}
        role="button"
        tabIndex={0}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); sortBy(k) } }}
      >
        {label}<span className="cp-sort-arrow">{active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
      </th>
    )
  }

  const selectableIds = entries.map((e) => e.id).filter((id): id is string => !!id)
  const selectedCount = selectableIds.filter((id) => selected.has(id)).length
  const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length

  function toggleSel(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds))
  }

  // Pull DataForSEO SEO metrics for every selected competitor, then refresh.
  async function analyzeSelected() {
    const ids = selectableIds.filter((id) => selected.has(id))
    if (ids.length === 0 || analyzing) return
    setAnalyzing(true)
    setError(null)
    setNote(null)
    try {
      const t = await getToken()
      const { results } = await analyzeCompetitors(t, orgId, ids)
      const ok = results.filter((r) => r.ok)
      const failed = results.filter((r) => !r.ok)
      if (ok.length) setNote(`Analyzed ${ok.length} competitor${ok.length > 1 ? 's' : ''} with DataForSEO.`)
      if (failed.length) {
        setError(`${failed.length} failed — ${failed.map((f) => `${f.name}: ${f.error ?? 'error'}`).join('; ')}`)
      }
      await load()
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analyze failed.')
    } finally {
      setAnalyzing(false)
    }
  }

  const load = useCallback(async () => {
    try {
      const t = await getToken()
      const items = await listContext(t, orgId)
      // Only true competitor notes (prefixed "Competitor: "). The persisted
      // "Insights — <name>" site-insight docs also carry meta.competitor, so we
      // exclude anything without the prefix to avoid duplicate rows.
      const found = items
        .filter(
          (i: ContextItem) =>
            (i.meta as Record<string, unknown> | undefined)?.competitor === true &&
            i.name.startsWith(COMPETITOR_PREFIX),
        )
        .map(entryFromItem)
      setEntries(found)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load competitors.')
    } finally {
      setLoading(false)
    }
  }, [getToken, orgId])

  useEffect(() => { void load() }, [load])

  function set<K extends keyof Entry>(k: K, v: Entry[K]) {
    setDraft((d) => (d ? { ...d, [k]: v } : d))
  }

  async function save() {
    if (!draft || saving) return
    if (!draft.name.trim() && !draft.website.trim()) { setError('Give the competitor a name or website.'); return }
    setSaving(true)
    setError(null)
    try {
      const t = await getToken()
      const name = draft.name.trim() || draft.website.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      const meta = { competitor: true, name, website: draft.website.trim(), summary: draft.summary, notes: draft.notes }
      const content = renderContent({ ...draft, name })
      if (draft.id) {
        await updateContext(t, orgId, draft.id, { name: `${COMPETITOR_PREFIX}${name}`, content, meta, scope: 'org', enabled: true })
      } else {
        await createContext(t, orgId, { kind: 'note', name: `${COMPETITOR_PREFIX}${name}`, content, meta, scope: 'org' })
      }
      setDraft(null)
      await load()
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Remove competitor "${name}"?`)) return
    setRemoving(id)
    try {
      const t = await getToken()
      await deleteContext(t, orgId, id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.')
    } finally {
      setRemoving(null)
    }
  }

  // Scaffold a competitor-focused dashboard (seeded widgets reference this
  // competitor and are grounded by its vault note), then open it.
  async function createDashboardFor(e: Entry) {
    if (!e.id || dashBusy) return
    setDashBusy(e.id)
    setError(null)
    try {
      const t = await getToken()
      const board = await createDashboard(t, orgId, {
        name: e.name,
        description: `Competitive dashboard for ${e.name}`,
        group: 'Competitors',
      })
      const widgets: { name: string; type: WidgetType; prompt: string; gridX: number; gridY: number; gridW: number; gridH: number }[] = [
        { name: `${e.name} — Profile`, type: 'insight', prompt: `Write a competitive profile of ${e.name}: what they do, market positioning, and strengths & weaknesses. Use the competitor info in the workspace context.`, gridX: 0, gridY: 0, gridW: 4, gridH: 2 },
        { name: `${e.name} — News`, type: 'news', prompt: `Latest news headlines about ${e.name}.`, gridX: 4, gridY: 0, gridW: 2, gridH: 2 },
        { name: `${e.name} — Key facts`, type: 'table', prompt: `Key facts about ${e.name}: founded, HQ, employees, public status & stock ticker, and main products.`, gridX: 0, gridY: 2, gridW: 4, gridH: 2 },
        { name: `${e.name} vs us`, type: 'insight', prompt: `Compare ${e.name} against our own company (see the company profile in context): where they are stronger, where we are stronger, and the biggest competitive threat.`, gridX: 4, gridY: 2, gridW: 2, gridH: 2 },
      ]
      for (const w of widgets) {
        try { await createWidget(t, orgId, board.id, w) } catch { /* skip a failed widget */ }
      }
      navigate(`/app/${orgId}/dashboards/${board.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create dashboard.')
      setDashBusy(null)
    }
  }

  // Compare public interest (free Wikipedia pageviews) across tracked competitors.
  async function loadTrends() {
    if (trendsBusy) return
    const names = entries.map((e) => e.name).filter(Boolean).slice(0, 5)
    if (names.length === 0) { setError('Add a competitor first to compare interest.'); return }
    setTrendsBusy(true)
    setError(null)
    try {
      const t = await getToken()
      setTrends(await getCompetitorTrends(t, orgId, names, 12))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load interest data.')
    } finally {
      setTrendsBusy(false)
    }
  }

  async function autofill() {
    if (!draft) return
    const url = draft.website.trim()
    if (!url) { setError('Enter the competitor’s website first, then Auto-fill.'); return }
    setAutofilling(true)
    setError(null)
    try {
      const t = await getToken()
      const res = await analyzeUrl(t, orgId, { url, lenses: ['company', 'competitive'] })
      setDraft((d) => {
        if (!d) return d
        const next = { ...d }
        if (res.sourceTitle && !next.name) next.name = res.sourceTitle
        if (res.company?.summary) next.summary = res.company.summary
        const noteParts: string[] = []
        for (const f of res.company?.facts ?? []) noteParts.push(`${f.label}: ${f.value}`)
        if (res.competitive?.strengths?.length) noteParts.push('', 'Strengths:', ...res.competitive.strengths.map((s) => `- ${s}`))
        if (res.competitive?.weaknesses?.length) noteParts.push('', 'Weaknesses:', ...res.competitive.weaknesses.map((s) => `- ${s}`))
        if (noteParts.length) next.notes = noteParts.join('\n')
        return next
      })
      if (!res.usedAI) setNote('AI not configured — limited auto-fill. Add a provider in Settings → AI providers.')
      else { setNote('Auto-filled — review and Save.'); setTimeout(() => setNote(null), 3000) }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Auto-fill failed.')
    } finally {
      setAutofilling(false)
    }
  }

  async function generate() {
    if (generating) return
    setGenerating(true)
    setError(null)
    setNote(null)
    setSuggestions(null)
    try {
      const t = await getToken()
      const res = await suggestCompetitors(t, orgId, entries.map((e) => e.name))
      setSuggestions(res.competitors)
      if (res.note) setNote(res.note)
      else if (res.aiError) setError(`AI error: ${res.aiError}`)
      else if (res.competitors.length === 0) setNote('No new competitors found — try fleshing out your company profile.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generate failed.')
    } finally {
      setGenerating(false)
    }
  }

  async function addSuggestion(s: CompetitorSuggestion, i: number) {
    if (addingIdx !== null) return
    setAddingIdx(i)
    setError(null)
    try {
      const t = await getToken()
      const entry: Entry = { id: null, name: s.name, website: s.website, summary: s.reason, notes: '' }
      const meta = { competitor: true, name: s.name, website: s.website, summary: s.reason, notes: '' }
      await createContext(t, orgId, { kind: 'note', name: `${COMPETITOR_PREFIX}${s.name}`, content: renderContent(entry), meta, scope: 'org' })
      setSuggestions((prev) => (prev ? prev.filter((_, idx) => idx !== i) : prev))
      await load()
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed.')
    } finally {
      setAddingIdx(null)
    }
  }

  async function addAll() {
    if (!suggestions || addingIdx !== null) return
    const list = [...suggestions]
    for (const s of list) {
      try {
        const t = await getToken()
        const entry: Entry = { id: null, name: s.name, website: s.website, summary: s.reason, notes: '' }
        const meta = { competitor: true, name: s.name, website: s.website, summary: s.reason, notes: '' }
        await createContext(t, orgId, { kind: 'note', name: `${COMPETITOR_PREFIX}${s.name}`, content: renderContent(entry), meta, scope: 'org' })
      } catch { /* skip failures */ }
    }
    setSuggestions(null)
    await load()
    onChange?.()
  }

  return (
    <section className={`cp-card${view === 'list' ? ' cp-card--list' : ''}`}>
      <div className="cp-head">
        <h2>⚔ Competitors</h2>
        <span className="cp-sub">Tracked rivals — grounding context for research, reports &amp; the assistant.</span>
        <div className="cp-head-actions">
          {!draft && (
            <>
              <button className="btn btn-primary btn-xs" onClick={() => void generate()} disabled={generating}>
                {generating ? 'Generating…' : '⚡ Generate'}
              </button>
              {entries.length > 0 && (
                <button
                  className="btn btn-secondary btn-xs"
                  onClick={() => void analyzeSelected()}
                  disabled={analyzing || selectedCount === 0}
                  title={selectedCount === 0 ? 'Select competitors to analyze' : 'Fetch SEO data from DataForSEO'}
                >
                  {analyzing ? 'Analyzing…' : `🔍 Analyze${selectedCount ? ` (${selectedCount})` : ''}`}
                </button>
              )}
              {entries.length > 0 && (
                <button className="btn btn-ghost btn-xs" onClick={() => void loadTrends()} disabled={trendsBusy}>
                  {trendsBusy ? 'Loading…' : '📈 Compare interest'}
                </button>
              )}
              <button className="btn btn-ghost btn-xs" onClick={() => { setDraft({ ...EMPTY }); setError(null) }}>
                ➕ Add manually
              </button>
              {entries.length > 0 && (
                <div className="cp-view-toggle" role="group" aria-label="View mode">
                  <button
                    type="button"
                    className={`cp-view-btn${view === 'cards' ? ' active' : ''}`}
                    aria-pressed={view === 'cards'}
                    title="Card view"
                    onClick={() => setView('cards')}
                  >
                    ▦
                  </button>
                  <button
                    type="button"
                    className={`cp-view-btn${view === 'list' ? ' active' : ''}`}
                    aria-pressed={view === 'list'}
                    title="List view"
                    onClick={() => setView('list')}
                  >
                    ☰
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {error && <div className="cp-error">{error}</div>}
      {note && <div className="cp-note">{note}</div>}

      {trends && (
        <div className="cp-section cp-trends">
          <div className="cp-comp-card-head">
            <div className="cp-comp-name">📈 Public interest over time</div>
            <div className="cp-comp-card-actions">
              <button className="cp-comp-iconbtn" title="Refresh" disabled={trendsBusy} onClick={() => void loadTrends()}>↻</button>
              <button className="cp-comp-iconbtn" title="Hide" onClick={() => setTrends(null)}>✕</button>
            </div>
          </div>
          <TrendChart data={trends} />
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <div className="cp-suggest">
          <div className="cp-suggest-head">
            <span>Suggested competitors — review &amp; add</span>
            <div className="cp-suggest-head-actions">
              <button className="btn btn-primary btn-xs" onClick={() => void addAll()}>Add all</button>
              <button className="btn btn-ghost btn-xs" onClick={() => setSuggestions(null)}>Dismiss</button>
            </div>
          </div>
          {suggestions.map((s, i) => (
            <div className="cp-suggest-row" key={i}>
              <div className="cp-suggest-main">
                <div className="cp-suggest-name">
                  {s.name}
                  {s.website && (
                    <a className="cp-web" href={s.website.startsWith('http') ? s.website : `https://${s.website}`} target="_blank" rel="noreferrer">
                      {s.website.replace(/^https?:\/\//, '')} ↗
                    </a>
                  )}
                </div>
                {s.reason && <div className="cp-suggest-reason">{s.reason}</div>}
              </div>
              <button className="btn btn-primary btn-xs" onClick={() => void addSuggestion(s, i)} disabled={addingIdx === i}>
                {addingIdx === i ? 'Adding…' : '+ Add'}
              </button>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <div className="cp-form cp-comp-form">
          <div className="cp-row">
            <label className="cp-field cp-field--grow">
              <span>Competitor name</span>
              <input className="cp-input" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Rival Co." autoFocus />
            </label>
            <label className="cp-field cp-field--grow">
              <span>Website</span>
              <div className="cp-website-row">
                <input className="cp-input" value={draft.website} onChange={(e) => set('website', e.target.value)} placeholder="https://rival.com" />
                <button type="button" className="btn btn-primary btn-xs cp-autofill" onClick={() => void autofill()} disabled={autofilling}>
                  {autofilling ? 'Reading…' : '✨ Auto-fill'}
                </button>
              </div>
            </label>
          </div>
          <label className="cp-field">
            <span>Summary</span>
            <textarea className="cp-input cp-textarea" rows={3} value={draft.summary} onChange={(e) => set('summary', e.target.value)} />
          </label>
          <label className="cp-field">
            <span>Notes (positioning, strengths, weaknesses…)</span>
            <textarea className="cp-input cp-textarea" rows={3} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
          <div className="cp-actions">
            <button className="btn btn-ghost" onClick={() => { setDraft(null); setError(null) }} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : (draft.id ? 'Save competitor' : 'Add competitor')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="cp-empty">Loading…</div>
      ) : entries.length === 0 && !draft ? (
        <div className="cp-empty">
          No competitors yet — click <strong>➕ Add competitor</strong>, drop in their website, and Auto-fill.
        </div>
      ) : (
        <>
          <div className="cp-list-toolbar">
            <label className="cp-check cp-check--all">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span>{selectedCount ? `${selectedCount} selected` : 'Select all'}</span>
            </label>
            <span className="cp-list-hint">Select competitors, then 🔍 Analyze to pull SEO data from DataForSEO.</span>
          </div>

          {view === 'list' ? (
            <div className="cp-table-scroll">
              <table className="cp-table">
                <thead>
                  <tr>
                    <th className="cp-th-check">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                    </th>
                    {renderTh('name', 'Competitor')}
                    {renderTh('website', 'Website')}
                    {renderTh('traffic', 'Traffic/mo', true)}
                    {renderTh('keywords', 'Keywords', true)}
                    {renderTh('value', 'Traffic value', true)}
                    {renderTh('pos1', '#1', true)}
                    {renderTh('updated', 'Updated', true)}
                    <th className="cp-th-actions" aria-label="actions" />
                  </tr>
                </thead>
                <tbody>
                  {sortedEntries.map((e) => (
                    <tr key={e.id} className={e.id && selected.has(e.id) ? 'is-selected' : ''}>
                      <td className="cp-td-check">
                        {e.id && (
                          <input
                            type="checkbox"
                            checked={selected.has(e.id)}
                            onChange={() => toggleSel(e.id!)}
                            aria-label={`Select ${e.name}`}
                          />
                        )}
                      </td>
                      <td className="cp-td-name">
                        {e.website ? (
                          <Link to={`/app/${orgId}/site?url=${encodeURIComponent(e.website)}&name=${encodeURIComponent(e.name)}`}>
                            {e.name}
                          </Link>
                        ) : (
                          e.name
                        )}
                      </td>
                      <td className="cp-td-web">
                        {e.website ? (
                          <a href={e.website.startsWith('http') ? e.website : `https://${e.website}`} target="_blank" rel="noreferrer">
                            {cleanDomain(e.website)}
                          </a>
                        ) : (
                          <span className="cp-muted">—</span>
                        )}
                      </td>
                      <td className="cp-num">{fmtNum(e.seo?.organicTraffic)}</td>
                      <td className="cp-num">{fmtNum(e.seo?.organicKeywords)}</td>
                      <td className="cp-num">{e.seo?.organicTrafficCost != null ? `$${fmtNum(e.seo.organicTrafficCost)}` : '—'}</td>
                      <td className="cp-num">{fmtNum(e.seo?.pos1)}</td>
                      <td className="cp-num cp-muted">{e.seo?.fetchedAt ? new Date(e.seo.fetchedAt).toLocaleDateString() : '—'}</td>
                      <td className="cp-td-actions">
                        <button className="cp-comp-iconbtn" title="Create a dashboard for this competitor" disabled={dashBusy === e.id} onClick={() => void createDashboardFor(e)}>
                          {dashBusy === e.id ? '…' : '📊'}
                        </button>
                        <button className="cp-comp-iconbtn" title="Edit" onClick={() => { setDraft(e); setError(null) }}>✎</button>
                        <button className="cp-comp-iconbtn" title="Remove" disabled={removing === e.id} onClick={() => e.id && void remove(e.id, e.name)}>
                          {removing === e.id ? '…' : '✕'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="cp-sections">
              {sortedEntries.map((e) => (
                <div className={`cp-section cp-comp-card${e.id && selected.has(e.id) ? ' is-selected' : ''}`} key={e.id}>
                  <div className="cp-comp-card-head">
                    {e.id && (
                      <label className="cp-check" title="Select for analysis">
                        <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSel(e.id!)} />
                      </label>
                    )}
                    <div className="cp-comp-name">{e.name}</div>
                    <div className="cp-comp-card-actions">
                      <button className="cp-comp-iconbtn" title="Create a dashboard for this competitor" disabled={dashBusy === e.id} onClick={() => void createDashboardFor(e)}>
                        {dashBusy === e.id ? '…' : '📊'}
                      </button>
                      <button className="cp-comp-iconbtn" title="Edit" onClick={() => { setDraft(e); setError(null) }}>✎</button>
                      <button className="cp-comp-iconbtn" title="Remove" disabled={removing === e.id} onClick={() => e.id && void remove(e.id, e.name)}>
                        {removing === e.id ? '…' : '✕'}
                      </button>
                    </div>
                  </div>
                  {e.website && (
                    <Link className="cp-web" to={`/app/${orgId}/site?url=${encodeURIComponent(e.website)}&name=${encodeURIComponent(e.name)}`}>
                      {cleanDomain(e.website)} → insights
                    </Link>
                  )}
                  {e.seo && (
                    <div className="cp-seo" title={`SEO via DataForSEO · ${new Date(e.seo.fetchedAt).toLocaleString()}`}>
                      <span className="cp-seo-metric"><b>{fmtNum(e.seo.organicKeywords)}</b> keywords</span>
                      <span className="cp-seo-metric"><b>{fmtNum(e.seo.organicTraffic)}</b> est. traffic/mo</span>
                      {e.seo.pos1 != null && <span className="cp-seo-metric"><b>{fmtNum(e.seo.pos1)}</b> #1</span>}
                    </div>
                  )}
                  {e.summary && <div className="cp-section-val cp-comp-summary">{e.summary}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

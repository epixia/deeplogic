// DataBlockBuilder — turn a database table/field into a custom Block. Configure
// a KPI / bar / line / table, see a LIVE preview, then drop it on a dashboard.

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { listDashboards, createWidget, createAlert, type DashboardListItem } from '../../lib/api'
import { buildDataBlockHtml, type DataBlockConfig } from '../../lib/dataBlock'
import { widgetFrameSrcDoc } from '../../lib/genFrame'
import type { DbColumnInfo } from '../../lib/api'
import './db-analyze.css'

interface Props {
  orgId: string
  supabase: { url: string; key: string }
  table: string
  columns: DbColumnInfo[]
  onClose: () => void
  onSaved?: () => void
}

type Viz = DataBlockConfig['viz']
type Agg = DataBlockConfig['agg']
const VIZ: { id: Viz; label: string; icon: string }[] = [
  { id: 'table', label: 'Table', icon: '▦' }, { id: 'bar', label: 'Bar', icon: '▭' },
  { id: 'kpi', label: 'KPI', icon: '#' }, { id: 'line', label: 'Trend', icon: '📈' },
]
const SIZE: Record<Viz, { w: number; h: number }> = { kpi: { w: 2, h: 2 }, bar: { w: 4, h: 3 }, line: { w: 4, h: 3 }, table: { w: 4, h: 3 } }
const AGG_LABEL: Record<Agg, string> = { sum: 'Total', avg: 'Avg', count: 'Count', min: 'Min', max: 'Max', latest: 'Latest' }

// "cnra_strains" → "CNRA Strains"; "cbd_pct" → "CBD Pct". Short tokens become
// acronyms (uppercased); the leading table prefix is treated as an acronym too.
function pretty(s: string, firstAsAcronym = false): string {
  return s.split('_').filter(Boolean)
    .map((w, i) => ((firstAsAcronym && i === 0) || w.length <= 4) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
function autoTitle(table: string, viz: Viz, agg: Agg, metric: string): string {
  const tbl = pretty(table, true)
  if (viz === 'table') return tbl
  const m = metric ? ` ${pretty(metric)}` : ''
  return `${tbl} ${AGG_LABEL[agg]}${m}`.replace(/\s+/g, ' ').trim()
}

export default function DataBlockBuilder({ orgId, supabase, table, columns, onClose, onSaved }: Props) {
  const { getAccessToken } = useAuth()
  const numeric = columns.filter((c) => c.isNumeric)
  const temporal = columns.filter((c) => c.isTemporal)

  const [viz, setViz] = useState<Viz>('table')
  const [metric, setMetric] = useState(numeric[0]?.name ?? '')
  const [agg, setAgg] = useState<Agg>('sum')
  const [dimension, setDimension] = useState(temporal[0]?.name ?? columns[0]?.name ?? '')
  const [windowDays, setWindowDays] = useState(30)
  const [title, setTitle] = useState(() => autoTitle(table, 'table', 'sum', numeric[0]?.name ?? ''))
  const [titleEdited, setTitleEdited] = useState(false) // stop auto-naming once the user types
  const [showCols, setShowCols] = useState<string[]>(() => columns.slice(0, 8).map((c) => c.name))
  type Rule = { column: string; op: 'above' | 'below' | 'equal'; value: string }
  const [rules, setRules] = useState<Rule[]>([])
  const [tab, setTab] = useState<'data' | 'alerts'>('data')
  const [dashboards, setDashboards] = useState<DashboardListItem[]>([])
  const [dashId, setDashId] = useState('')
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'

  // Auto-name the Block from its settings (e.g. "CNRA Strains Avg CBD") until the
  // user types their own title.
  useEffect(() => {
    if (!titleEdited) setTitle(autoTitle(table, viz, agg, metric))
  }, [table, viz, agg, metric, titleEdited])

  useEffect(() => {
    void (async () => {
      try {
        const t = await getAccessToken(); if (!t) return
        // Exclude auto-generated competitor intel dashboards — you don't add
        // your own data blocks to those.
        const ds = (await listDashboards(t, orgId)).filter((d) => (d.group ?? '') !== 'Competitors')
        setDashboards(ds); setDashId(ds[0]?.id ?? '')
      } catch { /* ignore */ }
    })()
  }, [getAccessToken, orgId])

  const cfg: DataBlockConfig = useMemo(() => ({
    url: supabase.url, key: supabase.key, table, viz, metric, agg, dimension,
    windowDays: viz === 'line' || viz === 'kpi' ? windowDays : 0,
    limit: viz === 'table' ? 200 : 5000, title,
    columns: viz === 'table' ? showCols : undefined,
  }), [supabase, table, viz, metric, agg, dimension, windowDays, title, showCols])

  const html = useMemo(() => buildDataBlockHtml(cfg), [cfg])
  const srcDoc = useMemo(() => widgetFrameSrcDoc(html, theme), [html, theme])

  async function save() {
    if (!dashId) { setNote('Pick a dashboard to add the block to.'); return }
    setSaving(true); setNote(null)
    try {
      const t = await getAccessToken(); if (!t) throw new Error('Session expired')
      const s = SIZE[viz]
      const w = await createWidget(t, orgId, dashId, {
        name: title.trim() || `${table} ${viz}`,
        type: viz === 'table' ? 'table' : 'chart',
        html,
        gridW: s.w, gridH: s.h,
      })
      // Wire up any column-threshold alerts to the new Block. Each rule becomes a
      // `threshold` alert whose URL is a PostgREST query for the relevant extreme
      // (max for above, min for below, exact match for equals).
      const base = supabase.url.replace(/\/$/, '') + '/rest/v1/' + table
      const opMap = { above: 'gt', below: 'lt', equal: 'eq' } as const
      for (const r of rules) {
        if (!r.column || !r.value.trim()) continue
        const col = encodeURIComponent(r.column)
        const url = r.op === 'above' ? `${base}?select=${col}&order=${col}.desc&limit=1`
          : r.op === 'below' ? `${base}?select=${col}&order=${col}.asc&limit=1`
          : `${base}?select=${col}&${col}=eq.${encodeURIComponent(r.value)}&limit=1`
        await createAlert(t, orgId, {
          name: `${table}.${r.column} ${r.op} ${r.value}`,
          kind: 'threshold',
          config: { url, path: `0.${r.column}`, op: opMap[r.op], value: Number(r.value), apiKey: supabase.key },
          widgetId: w.id, status: 'active',
        }).catch(() => undefined)
      }
      setNote(rules.length ? `✓ Block added with ${rules.filter((r) => r.column && r.value.trim()).length} alert(s).` : '✓ Block added to dashboard.')
      onSaved?.()
      setTimeout(onClose, 700)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Save failed.')
    } finally { setSaving(false) }
  }

  return (
    <div className="dba-backdrop" onClick={onClose}>
      <div className="dba-modal dbb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dba-head">
          <h2>⚡ Build a Block from <code>{table}</code></h2>
          <button className="vault-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="dbb-grid">
          {/* config */}
          <div className="dbb-config">
            <div className="dbb-tabs">
              <button type="button" className={`dbb-tab${tab === 'data' ? ' on' : ''}`} onClick={() => setTab('data')}>Block Data</button>
              <button type="button" className={`dbb-tab${tab === 'alerts' ? ' on' : ''}`} onClick={() => setTab('alerts')}>⚡ Smart Alerts{rules.length ? ` (${rules.length})` : ''}</button>
            </div>

            {tab === 'data' && (<>
            <label className="studio-field"><span>Visualization</span>
              <div className="studio-seg studio-seg--wrap">
                {VIZ.map((v) => <button key={v.id} type="button" className={`studio-seg-btn${viz === v.id ? ' active' : ''}`} onClick={() => setViz(v.id)}>{v.icon} {v.label}</button>)}
              </div>
            </label>

            {viz !== 'table' && (
              <div className="dbb-row">
                <label className="studio-field"><span>Metric</span>
                  <select className="studio-input" value={metric} onChange={(e) => setMetric(e.target.value)}>
                    {numeric.length === 0 && <option value="">(no numeric fields)</option>}
                    {numeric.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </label>
                <label className="studio-field"><span>Aggregate</span>
                  <select className="studio-input" value={agg} onChange={(e) => setAgg(e.target.value as Agg)}>
                    {(['sum', 'avg', 'count', 'min', 'max', 'latest'] as Agg[]).map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
              </div>
            )}

            {(viz === 'bar' || viz === 'line' || viz === 'table') && (
              <label className="studio-field"><span>{viz === 'line' ? 'Time field' : viz === 'bar' ? 'Group by' : 'Order by'}</span>
                <select className="studio-input" value={dimension} onChange={(e) => setDimension(e.target.value)}>
                  {(viz === 'line' ? (temporal.length ? temporal : columns) : columns).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </label>
            )}

            {(viz === 'line' || viz === 'kpi') && temporal.length > 0 && (
              <label className="studio-field"><span>Time window (days)</span>
                <input className="studio-input" type="number" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value) || 0)} />
              </label>
            )}

            <label className="studio-field"><span>Title <span className="dbb-alert-hint">— auto-named from your settings; edit to customise</span></span>
              <input className="studio-input" value={title} onChange={(e) => { setTitle(e.target.value); setTitleEdited(true) }} />
            </label>

            {viz === 'table' && (
              <label className="studio-field"><span>Columns to show</span>
                <div className="dbb-colpick">
                  {columns.map((c) => {
                    const on = showCols.includes(c.name)
                    return (
                      <button type="button" key={c.name} className={`dbb-colchip${on ? ' on' : ''}`}
                        onClick={() => setShowCols((s) => on ? s.filter((x) => x !== c.name) : [...s, c.name])}>
                        {on ? '✓ ' : ''}{c.name}
                      </button>
                    )
                  })}
                </div>
              </label>
            )}
            </>)}

            {tab === 'alerts' && (
            <div className="studio-field">
              <span>⚡ Smart alerts <span className="dbb-alert-hint">— get notified when a value crosses a threshold</span></span>
              {rules.map((r, i) => (
                <div className="dbb-rule" key={i}>
                  <select className="studio-input" value={r.column} onChange={(e) => setRules((rs) => rs.map((x, j) => j === i ? { ...x, column: e.target.value } : x))}>
                    {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                  <select className="studio-input dbb-rule-op" value={r.op} onChange={(e) => setRules((rs) => rs.map((x, j) => j === i ? { ...x, op: e.target.value as Rule['op'] } : x))}>
                    <option value="above">above</option>
                    <option value="below">below</option>
                    <option value="equal">equals</option>
                  </select>
                  <input className="studio-input dbb-rule-val" type="number" placeholder="value" value={r.value} onChange={(e) => setRules((rs) => rs.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                  <button type="button" className="dbb-rule-del" title="Remove" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-xs dbb-rule-add" onClick={() => setRules((rs) => [...rs, { column: numeric[0]?.name || columns[0]?.name || '', op: 'above', value: '' }])}>+ Add alert</button>
              {rules.length === 0 && <p className="dbb-alert-empty">No alerts yet — add one to get notified when a column value crosses a threshold (above / below / equals).</p>}
            </div>
            )}
          </div>

          {/* live preview */}
          <div className="dbb-preview">
            <div className="dbb-preview-label">Live preview</div>
            <iframe className="dbb-frame" srcDoc={srcDoc} sandbox="allow-scripts" title="preview" />
          </div>
        </div>

        <div className="dbb-foot">
          <label className="studio-field dbb-dash"><span>Add to dashboard</span>
            <select className="studio-input" value={dashId} onChange={(e) => setDashId(e.target.value)}>
              {dashboards.length === 0 && <option value="">(no dashboards — create one first)</option>}
              {dashboards.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          {note && <span className="dbb-note">{note}</span>}
          <button className="btn btn-primary" disabled={saving || !dashId} onClick={() => void save()}>{saving ? 'Adding…' : '+ Add to dashboard'}</button>
        </div>
      </div>
    </div>
  )
}

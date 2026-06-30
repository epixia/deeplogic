// DbAnalyzeModal — live database schema discovery. Streams progress while it
// introspects a connector's tables + fields, then shows the schema and flags
// KPI-worthy (numeric) fields we can pull into Blocks.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { streamDbAnalyze, type DbSchemaInfo, type DbTableInfo } from '../../lib/api'
import DataBlockBuilder from './DataBlockBuilder'
import './db-analyze.css'

interface Props { orgId: string; deleteRef: string; name: string; supabase?: { url: string; key: string }; onClose: () => void }

function whenLabel(iso: string | null): string {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

export default function DbAnalyzeModal({ orgId, deleteRef, name, supabase, onClose }: Props) {
  const [building, setBuilding] = useState<DbTableInfo | null>(null)
  const { getAccessToken } = useAuth()
  const [log, setLog] = useState<string[]>([])
  const [schema, setSchema] = useState<DbSchemaInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(true)
  const [cached, setCached] = useState(false)
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const logRef = useRef<HTMLDivElement | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)

  const run = useCallback(async (force: boolean) => {
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    setRunning(true); setError(null); setLog([]); if (force) setSchema(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      for await (const evt of streamDbAnalyze(t, orgId, deleteRef, ctrl.signal, force)) {
        if (evt.type === 'step' && evt.msg) setLog((l) => [...l, evt.msg!])
        else if (evt.type === 'done' && evt.schema) { setSchema(evt.schema); setCached(!!evt.cached); setAnalyzedAt(evt.analyzedAt ?? null) }
        else if (evt.type === 'error') setError(evt.error ?? 'Analysis failed')
      }
    } catch (e) {
      if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof Error ? e.message : 'Analysis failed')
    } finally { setRunning(false) }
  }, [getAccessToken, orgId, deleteRef])

  useEffect(() => { void run(false); return () => ctrlRef.current?.abort() }, [run])

  useEffect(() => { logRef.current?.scrollTo({ top: 9e9 }) }, [log.length])

  const kpiByTable = new Map<string, string[]>()
  for (const k of schema?.kpiCandidates ?? []) {
    const arr = kpiByTable.get(k.table) ?? []; arr.push(k.metric); kpiByTable.set(k.table, arr)
  }

  return (
    <div className="dba-backdrop" onClick={onClose}>
      <div className="dba-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dba-head">
          <h2>🔬 {name}</h2>
          <div className="dba-head-actions">
            {schema && !running && (
              <span className="dba-cache" title={analyzedAt ? `Analyzed ${new Date(analyzedAt).toLocaleString()}` : undefined}>
                {cached ? '✓ cached' : '✓ fresh'}{analyzedAt ? ` · ${whenLabel(analyzedAt)}` : ''}
              </span>
            )}
            <button className="btn btn-ghost btn-xs" disabled={running} onClick={() => void run(true)} title="Re-run the analysis and refresh the cached schema">
              {running ? 'Analyzing…' : '↻ Re-analyze'}
            </button>
            <button className="vault-modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {(running || log.length > 0 || error) && (
          <div className="dba-log" ref={logRef}>
            {log.map((l, i) => <div key={i} className="dba-log-line">{running && i === log.length - 1 ? '▸ ' : '✓ '}{l}</div>)}
            {running && <div className="dba-log-line dba-spin">▸ Working…</div>}
            {error && <div className="dba-log-line dba-err">✕ {error}</div>}
          </div>
        )}

        {schema && (
          <div className="dba-results">
            {schema.note && <div className="dba-note">{schema.note}</div>}
            {schema.tables.length > 0 && (
              <>
                <div className="dba-summary">
                  <span><strong>{schema.tables.length}</strong> tables</span>
                  <span><strong>{schema.tables.reduce((s, t) => s + t.columns.length, 0)}</strong> fields</span>
                  <span><strong>{schema.kpiCandidates.length}</strong> KPI-worthy fields</span>
                </div>
                <div className="dba-tables">
                  {schema.tables.map((t) => {
                    const isOpen = open[t.name]
                    const kpis = kpiByTable.get(t.name) ?? []
                    return (
                      <div className="dba-table" key={t.name}>
                        <div className="dba-table-head">
                          <button className="dba-table-toggle" onClick={() => setOpen((o) => ({ ...o, [t.name]: !o[t.name] }))}>
                            <span className="dba-chev">{isOpen ? '▾' : '▸'}</span>
                            <span className="dba-table-name">{t.name}</span>
                            <span className="dba-table-count">{t.columns.length} fields</span>
                            {kpis.length > 0 && <span className="dba-kpi-badge">📈 {kpis.length} KPI</span>}
                          </button>
                          {supabase && <button className="btn btn-xs btn-primary dba-build-btn" onClick={() => setBuilding(t)}>⚡ Build Block</button>}
                        </div>
                        {isOpen && (
                          <div className="dba-cols">
                            {t.columns.map((c) => (
                              <div className={`dba-col${c.isNumeric ? ' dba-col-num' : c.isTemporal ? ' dba-col-time' : ''}`} key={c.name}>
                                <span className="dba-col-name">{c.name}</span>
                                <span className="dba-col-type">{c.type}{c.isNumeric ? ' · metric' : c.isTemporal ? ' · time' : ''}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {building && supabase && (
        <DataBlockBuilder
          orgId={orgId}
          supabase={supabase}
          table={building.name}
          columns={building.columns}
          onClose={() => setBuilding(null)}
        />
      )}
    </div>
  )
}

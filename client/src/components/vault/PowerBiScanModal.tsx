// PowerBiScanModal — a live "forensic scan" of a Power BI report. No options:
// it auto-examines the parsed document and reveals what it finds — data model,
// connections, source databases, KPIs, business entities and risks — streaming
// the discoveries into a scan log, then synthesizes an insight + next steps.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { describePowerBi, type VaultPowerBI } from '../../lib/api'
import './powerbi-scan.css'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Base filename from a Power Query file path (Excel/CSV source).
const baseName = (p: string) => p.split(/[\\/]/).pop() || p

interface ConnLike {
  type: string; displayName: string
  server?: string; database?: string; url?: string; workspace?: string; dataset?: string; filePath?: string
  queryNames?: string[]; rawExpression?: string
}
// Best single-line detail for a connection: file name, server/db, dataset, else
// the raw M expression so a source with no clean path is still visible.
function connDetail(c: ConnLike): string {
  if (c.filePath) return `📄 ${baseName(c.filePath)}`
  const sd = [c.server, c.database].filter(Boolean).join(' / ')
  if (sd) return sd
  if (c.dataset) return `dataset: ${c.dataset}`
  if (c.workspace) return `workspace: ${c.workspace}`
  if (c.url) return c.url
  if (c.rawExpression) return c.rawExpression.replace(/\s+/g, ' ').trim().slice(0, 140)
  return ''
}
const connIcon = (c: ConnLike) => (c.filePath ? '📄' : c.url ? '🌐' : c.dataset || c.workspace ? '📊' : '🗄')

export default function PowerBiScanModal({ orgId, report, onClose }: { orgId: string; report: VaultPowerBI; onClose: () => void }) {
  const { getAccessToken } = useAuth()
  // Pull the richest available signals (inspection first, legacy fallback).
  const facts = useMemo(() => {
    const insp = report.inspection ?? undefined
    const tables = report.tables ?? []
    const sourceSystems = insp?.sourceSystems ?? []
    const connectors = insp?.connectors ?? []
    const legacyConns = report.connectors ?? []
    const kpis = insp?.kpis?.length
      ? insp.kpis.map((k) => ({ name: k.name, meaning: k.businessMeaningGuess, table: k.table, source: k.source }))
      : (report.kpis ?? []).map((k) => ({ name: k, meaning: undefined as string | undefined, table: undefined as string | undefined, source: '' }))
    const entities = insp?.entities ?? []
    const risks = insp?.risks ?? []
    const pages = report.pages ?? []
    const queries = insp?.queries ?? []
    const limitations = insp?.limitations ?? []
    const connCount = connectors.length || legacyConns.length
    const fileSources = [...new Set(connectors.filter((c) => c.filePath).map((c) => baseName(c.filePath!)))]
    const dbTypes = [...new Set([...sourceSystems.map((s) => s.type), ...connectors.map((c) => c.type)].filter(Boolean))]
    const dbList = sourceSystems.map((s) => s.database || s.server || s.name).filter(Boolean) as string[]
    return { tables, sourceSystems, connectors, legacyConns, kpis, entities, risks, pages, queries, limitations, connCount, fileSources, dbTypes, dbList }
  }, [report])

  // Scan stages — each reveals a finding section as the "scan" progresses.
  const STAGES = useMemo(() => [
    { key: 'open', icon: '📂', line: `Opening "${report.name}"` },
    { key: 'model', icon: '🧱', line: `Reading data model — ${facts.tables.length} table${facts.tables.length === 1 ? '' : 's'}` },
    { key: 'conn', icon: '🔌', line: `Detecting connections — ${facts.connCount} found` },
    { key: 'query', icon: '🧮', line: facts.queries.length ? `Tracing query lineage — ${facts.queries.length} quer${facts.queries.length === 1 ? 'y' : 'ies'} / logical tables` : 'No queries captured' },
    { key: 'db', icon: '🗄', line: facts.sourceSystems.length ? `Identifying source databases — ${facts.sourceSystems.length}` : 'No upstream databases detected' },
    { key: 'kpi', icon: '📊', line: `Extracting KPIs & measures — ${facts.kpis.length}` },
    { key: 'entity', icon: '🧩', line: facts.entities.length ? `Mapping business entities — ${facts.entities.length}` : 'Mapping business entities — none labelled' },
    { key: 'risk', icon: facts.risks.length ? '⚠️' : '🛡', line: facts.risks.length ? `Flagging risks — ${facts.risks.length}` : 'No structural risks flagged' },
    { key: 'pages', icon: '📑', line: `Cataloguing report pages — ${facts.pages.length}` },
    { key: 'insight', icon: '🧠', line: 'Synthesizing insight…' },
  ], [report.name, facts])

  const [step, setStep] = useState(0) // number of stages completed
  const [done, setDone] = useState(false)
  const logRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (let s = 1; s <= STAGES.length; s++) {
        await sleep(s === STAGES.length ? 650 : 460)
        if (cancelled) return
        setStep(s)
      }
      if (!cancelled) setDone(true)
    })()
    return () => { cancelled = true }
  }, [STAGES.length])

  useEffect(() => { logRef.current?.scrollTo({ top: 9e9 }) }, [step])

  // Once the scan reaches the insight stage, ask the AI to describe what the
  // report portrays (from its structure). Falls back to a heuristic server-side.
  const [desc, setDesc] = useState<string | null>(null)
  const reachedInsight = step >= STAGES.findIndex((s) => s.key === 'insight') + 1
  const askedRef = useRef(false)
  useEffect(() => {
    if (!reachedInsight || askedRef.current) return
    askedRef.current = true
    let cancelled = false
    void (async () => {
      try {
        const t = await getAccessToken()
        if (!t) return
        const r = await describePowerBi(t, orgId, {
          name: report.name,
          tables: facts.tables.map((t2) => ({ name: t2.name, columns: t2.columns ?? [] })),
          sources: [...new Set([...facts.dbList, ...facts.fileSources])],
          sourceTypes: facts.dbTypes,
          kpis: facts.kpis.map((k) => k.name),
          entities: facts.entities.map((e) => e.name),
          pages: facts.pages,
        })
        if (!cancelled) setDesc(r.description)
      } catch { /* heuristic insight still shows */ }
    })()
    return () => { cancelled = true }
  }, [reachedInsight, getAccessToken, orgId, report.name, facts])

  const reached = (key: string) => step >= STAGES.findIndex((s) => s.key === key) + 1
  const topKpis = facts.kpis.slice(0, 3).map((k) => k.name)
  const insight = buildInsight(report.name, facts)

  return (
    <div className="pbs-backdrop" onClick={onClose}>
      <div className="pbs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pbs-head">
          <span className={`pbs-radar${done ? ' done' : ''}`}>{done ? '✅' : '🛰'}</span>
          <div className="pbs-head-text">
            <h2>{done ? 'Scan complete' : 'Scanning Power BI report'}</h2>
            <div className="pbs-sub">{report.name}</div>
          </div>
          <button className="pbs-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="pbs-progress"><span style={{ width: `${(step / STAGES.length) * 100}%` }} /></div>

        <div className="pbs-body">
          {/* live scan log */}
          <div className="pbs-log" ref={logRef}>
            {STAGES.slice(0, step).map((s) => (
              <div className="pbs-log-line" key={s.key}><span className="pbs-log-ic">{s.icon}</span>{s.line}</div>
            ))}
            {!done && <div className="pbs-log-line pbs-log-active"><span className="pbs-log-ic">🔎</span>scanning<span className="pbs-cursor">▋</span></div>}
          </div>

          {/* findings reveal progressively */}
          <div className="pbs-findings">
            {reached('model') && facts.tables.length > 0 && (
              <Section title={`Data model (${facts.tables.length} table${facts.tables.length === 1 ? '' : 's'})`}>
                <div className="pbs-table-list">
                  {facts.tables.slice(0, 40).map((t, i) => (
                    <div className="pbs-table" key={i}>
                      <div className="pbs-table-top">
                        <span className="pbs-table-name">▦ {t.name}</span>
                        <span className="pbs-table-meta">{t.columns?.length ?? 0} cols · {t.measures?.length ?? 0} measures</span>
                      </div>
                      {(t.columns?.length ?? 0) > 0 && (
                        <div className="pbs-cols">
                          {t.columns!.slice(0, 24).map((col) => <span key={col} className="pbs-colchip">{col}</span>)}
                          {t.columns!.length > 24 && <span className="pbs-colchip pbs-colchip--more">+{t.columns!.length - 24}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {reached('conn') && (facts.connectors.length > 0 || facts.legacyConns.length > 0) && (
              <Section title={`Connections & data sources (${facts.connCount})`}>
                {facts.connectors.length > 0 ? (
                  <div className="pbs-conn-list">
                    {facts.connectors.map((c, i) => (
                      <div className="pbs-conn" key={i}>
                        <div className="pbs-conn-top">
                          <span className="pbs-conn-name">{connIcon(c)} {c.displayName}</span>
                          <span className="pbs-conn-type">{c.type.replace(/_/g, ' ')}</span>
                        </div>
                        {connDetail(c) && <div className="pbs-conn-detail">{connDetail(c)}</div>}
                        {(c.queryNames?.length ?? 0) > 0 && (
                          <div className="pbs-conn-queries">
                            {c.queryNames!.slice(0, 14).map((q) => <span key={q} className="pbs-qchip">{q}</span>)}
                            {c.queryNames!.length > 14 && <span className="pbs-qchip pbs-qchip--more">+{c.queryNames!.length - 14} more</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  facts.legacyConns.map((c, i) => <span key={i} className="pbs-chip">🔌 {c.name}<em>{c.kind}</em></span>)
                )}
              </Section>
            )}

            {reached('query') && facts.queries.length > 0 && (
              <Section title={`Queries — tables & columns used (${facts.queries.length})`}>
                <div className="pbs-table-list">
                  {facts.queries.slice(0, 30).map((q, i) => (
                    <div className="pbs-table" key={i}>
                      <div className="pbs-table-top">
                        <span className="pbs-table-name">🧮 {q.name}</span>
                        <span className="pbs-table-meta">{q.steps} step{q.steps === 1 ? '' : 's'}</span>
                      </div>
                      {q.sourceTables.length > 0 && (
                        <div className="pbs-q-line">
                          <span className="pbs-q-lbl">from</span>
                          {q.sourceTables.slice(0, 8).map((t, j) => (
                            <span key={j} className="pbs-colchip pbs-colchip--tbl">{t.schema ? `${t.schema}.` : ''}{t.name}</span>
                          ))}
                        </div>
                      )}
                      {q.selectedColumns.length > 0 && (
                        <div className="pbs-q-line">
                          <span className="pbs-q-lbl">columns</span>
                          {q.selectedColumns.slice(0, 24).map((c) => <span key={c} className="pbs-colchip">{c}</span>)}
                          {q.selectedColumns.length > 24 && <span className="pbs-colchip pbs-colchip--more">+{q.selectedColumns.length - 24}</span>}
                        </div>
                      )}
                      {q.sourceTables.length === 0 && q.selectedColumns.length === 0 && (
                        <div className="pbs-q-line"><span className="pbs-q-lbl">note</span><span className="pbs-colchip pbs-colchip--more">{q.outputEntityGuess ? `≈ ${q.outputEntityGuess}` : 'live connection — columns resolve in the source model'}</span></div>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {reached('kpi') && facts.kpis.length > 0 && (
              <Section title={`KPIs & measures (${facts.kpis.length})`}>
                {facts.kpis.slice(0, 50).map((k, i) => (
                  <span key={i} className="pbs-chip pbs-chip--kpi" title={[k.meaning && `≈ ${k.meaning}`, k.table && `table: ${k.table}`].filter(Boolean).join(' · ') || undefined}>
                    <span className="kpi-fx">fx</span>{k.name}{k.table && <em>{k.table}</em>}
                  </span>
                ))}
              </Section>
            )}

            {reached('entity') && facts.entities.length > 0 && (
              <Section title={`Business entities (${facts.entities.length})`}>
                {facts.entities.slice(0, 30).map((e, i) => (
                  <span key={i} className="pbs-chip pbs-chip--ent" title={`from: ${e.sourceNames.slice(0, 4).join(', ')}`}>{e.name}</span>
                ))}
              </Section>
            )}

            {reached('risk') && facts.risks.length > 0 && (
              <Section title={`Risks (${facts.risks.length})`}>
                <ul className="pbs-risks">
                  {facts.risks.slice(0, 8).map((r, i) => (
                    <li key={i} className={`pbs-risk pbs-risk--${(r.severity || 'info').toLowerCase()}`}>
                      <span className="pbs-risk-cat">{r.category}</span> {r.message}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {reached('pages') && facts.pages.length > 0 && (
              <Section title={`Dashboard pages (${facts.pages.length})`}>
                {facts.pages.map((p, i) => <span key={i} className="pbs-chip pbs-chip--page">📑 {p}</span>)}
              </Section>
            )}

            {reached('insight') && (
              <div className="pbs-insight">
                <h3>📝 What this report portrays</h3>
                <p>{desc ?? insight.narrative}</p>
                {!desc && <div className="pbs-desc-loading"><span className="pbs-cursor">▋</span> refining with AI…</div>}
                {insight.recommendations.length > 0 && (
                  <>
                    <h4>Recommended next steps</h4>
                    <ul>{insight.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </>
                )}
                {topKpis.length > 0 && <div className="pbs-insight-foot">Tip: re-create these as live Blocks — {topKpis.join(', ')}.</div>}
                {facts.limitations.length > 0 && (
                  <div className="pbs-insight-notes">
                    <strong>Scan notes:</strong>
                    <ul>{facts.limitations.slice(0, 5).map((l, i) => <li key={i}>{l}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pbs-sec">
      <div className="pbs-sec-title">{title}</div>
      <div className="pbs-chips">{children}</div>
    </div>
  )
}

interface ScanFacts {
  tables: { name: string }[]
  sourceSystems: { name: string; type: string }[]
  kpis: { name: string }[]
  entities: { name: string }[]
  risks: { message: string }[]
  pages: string[]
  connCount: number
  dbList: string[]
  fileSources: string[]
  dbTypes: string[]
}

const prettyType = (t: string) => t.replace(/_/g, ' ')

// Heuristic narrative built from the parsed report — instant, no API needed.
function buildInsight(name: string, f: ScanFacts): { narrative: string; recommendations: string[] } {
  const srcParts = [...new Set([...f.dbList, ...f.fileSources])].slice(0, 5)
  const topKpis = f.kpis.slice(0, 3).map((k) => k.name)
  const topEntities = f.entities.slice(0, 4).map((e) => e.name)

  const bits: string[] = []
  bits.push(`"${name}" models ${f.tables.length} table${f.tables.length === 1 ? '' : 's'}${srcParts.length ? ` drawn from ${srcParts.join(', ')}` : ''}.`)
  if (f.dbTypes.length) bits.push(`Source types: ${f.dbTypes.map(prettyType).join(', ')}.`)
  if (f.kpis.length) bits.push(`It surfaces ${f.kpis.length} KPI${f.kpis.length === 1 ? '' : 's'}${topKpis.length ? ` such as ${topKpis.join(', ')}` : ''}.`)
  if (topEntities.length) bits.push(`Core business entities: ${topEntities.join(', ')}.`)
  if (f.pages.length) bits.push(`Presented across ${f.pages.length} dashboard page${f.pages.length === 1 ? '' : 's'}: ${f.pages.slice(0, 6).join(', ')}${f.pages.length > 6 ? '…' : ''}.`)

  const recs: string[] = []
  if (f.sourceSystems[0]) recs.push(`Connect ${f.sourceSystems[0].name} directly to DeepLogic to live-refresh these metrics.`)
  else if (f.fileSources[0]) recs.push(`This report relies on the file ${f.fileSources[0]} — connect a live source so it refreshes automatically.`)
  if (topKpis.length) recs.push(`Re-create the headline KPIs as Blocks: ${topKpis.join(', ')}.`)
  if (f.connCount <= 1) recs.push('Single data source detected — consider adding redundancy or validating freshness.')
  if (f.risks.length) recs.push(`Review ${f.risks.length} flagged risk${f.risks.length === 1 ? '' : 's'} before relying on this report.`)
  if (!recs.length) recs.push('Looks healthy — track its KPIs as Blocks and set alerts on the ones that matter.')

  return { narrative: bits.join(' '), recommendations: recs }
}

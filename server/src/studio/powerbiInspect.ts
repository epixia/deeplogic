// Power BI deep inspector — turns a .pbix/.pbit into a structured, DataVault-
// oriented metadata extraction. Phase 1: connectors, Power Query/M, report
// metadata, recoverable measures/relationships, and inferred BI mapping
// (entities, KPIs, lineage, risks). NOT full VertiPaq data extraction.
//
// Everything is best-effort and exception-safe: a locked/odd file degrades to a
// partial result with `limitations`, never a throw.

import { readFile, stat } from 'node:fs/promises'
import AdmZip from 'adm-zip'

/* ============================== types ============================== */

export type InspectPowerBiInput = {
  filePath: string
  fileName: string
  tenantId?: string
  uploadedByUserId?: string
  scanMode?: 'static' | 'deep'
}

export type ConnectorType =
  | 'sql_server' | 'fabric_warehouse' | 'analysis_services' | 'powerbi_semantic_model'
  | 'sharepoint' | 'excel' | 'csv' | 'web_api' | 'odata' | 'odbc' | 'folder'
  | 'local_file' | 'unknown'

export type Confidence = 'low' | 'medium' | 'high'

export type PowerBiConnector = {
  id: string
  type: ConnectorType
  displayName: string
  server?: string
  database?: string
  url?: string
  workspace?: string
  dataset?: string
  filePath?: string
  rawExpression: string
  queryNames: string[]
  confidence: Confidence
}

export type SourceTableRef = { schema?: string; name: string; connectorId?: string }
export type PowerQueryStep = { name: string; operation?: string }

export type PowerBiQuery = {
  id: string
  name: string
  mCode: string
  connectors: string[]
  sourceTables: SourceTableRef[]
  selectedColumns: string[]
  transformationSteps: PowerQueryStep[]
  dependsOnQueries: string[]
  outputEntityGuess?: string
}

export type SemanticColumn = { name: string; dataType?: string }
export type SemanticMeasure = { name: string; table?: string; expression?: string }
export type SemanticTable = { name: string; columns: SemanticColumn[]; measures: SemanticMeasure[] }
export type SemanticRelationship = { fromTable: string; fromColumn: string; toTable: string; toColumn: string }
export type PowerBiSemanticModel = {
  tables: SemanticTable[]
  measures: SemanticMeasure[]
  relationships: SemanticRelationship[]
  recoveredFrom: 'schema' | 'binary' | 'none'
}

export type ReportVisual = { page: string; type: string; fields: string[] }
export type PowerBiReport = { pages: string[]; visuals: ReportVisual[] }

export type KpiCandidate = {
  id: string
  name: string
  source: 'measure' | 'visual_field' | 'column_name' | 'query_name'
  expression?: string
  table?: string
  field?: string
  businessMeaningGuess?: string
  confidence: Confidence
  evidenceIds: string[]
}

export type DataVaultEntityCandidate = { id: string; name: string; sourceNames: string[]; confidence: Confidence }
export type DataVaultAttributeCandidate = { entity: string; name: string }
export type BusinessKeyCandidate = { entity: string; column: string; reason: string }
export type SourceSystemCandidate = { name: string; type: ConnectorType; server?: string; database?: string; connectorId: string }
export type DataVaultExtraction = {
  entities: DataVaultEntityCandidate[]
  attributes: DataVaultAttributeCandidate[]
  businessKeys: BusinessKeyCandidate[]
  sourceSystems: SourceSystemCandidate[]
}

export type LineageCandidate = { from: string; to: string; type: 'source_to_table' | 'table_to_entity' | 'entity_to_kpi' | 'query_to_query'; confidence: Confidence; evidenceIds: string[] }
export type LineageExtraction = { candidates: LineageCandidate[] }

export type RiskFlag = { id: string; severity: 'info' | 'low' | 'medium' | 'high'; category: string; message: string; evidenceIds: string[] }
export type EvidenceSnippet = { id: string; source: string; kind: string; snippet: string }

export type PowerBiInspectionResult = {
  file: { fileName: string; fileType: 'pbix' | 'pbit' | 'pbip' | 'unknown'; fileSizeBytes?: number; inspectedAt: string }
  summary: {
    connectorCount: number; queryCount: number; pageCount: number; visualCount: number
    tableCount: number; measureCount: number; relationshipCount: number; riskCount: number
    kpiCandidateCount: number; dataVaultEntityCount: number
  }
  connectors: PowerBiConnector[]
  queries: PowerBiQuery[]
  semanticModel: PowerBiSemanticModel
  report: PowerBiReport
  kpis: KpiCandidate[]
  dataVault: DataVaultExtraction
  lineage: LineageExtraction
  risks: RiskFlag[]
  evidence: EvidenceSnippet[]
  limitations: string[]
}

/* ============================== id factory ============================== */

function ids(prefix: string) {
  let n = 0
  return () => `${prefix}${++n}`
}

/* ============================== decoding ============================== */

// Safely decode a buffer trying UTF-16LE, UTF-8 (+ BOM strip), then Latin-1.
function decode(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  // Heuristic: lots of NUL bytes in even positions → UTF-16LE.
  let nul = 0
  for (let i = 1; i < Math.min(buf.length, 200); i += 2) if (buf[i] === 0) nul++
  if (nul > 40) return buf.toString('utf16le')
  const utf8 = buf.toString('utf8')
  if (utf8.includes('�')) return buf.toString('latin1')
  return utf8
}

// Extract printable ASCII runs (>= minLen) from a binary buffer.
function asciiStrings(buf: Buffer, minLen = 4): string {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i]
    if (c >= 0x20 && c < 0x7f) cur += String.fromCharCode(c)
    else { if (cur.length >= minLen) out.push(cur); cur = '' }
  }
  if (cur.length >= minLen) out.push(cur)
  return out.join('\n')
}

function entry(zip: AdmZip, re: RegExp): Buffer | null {
  for (const e of zip.getEntries()) if (!e.isDirectory && re.test(e.entryName)) { try { return e.getData() } catch { return null } }
  return null
}
function entryText(zip: AdmZip, re: RegExp): string {
  const b = entry(zip, re)
  return b ? decode(b) : ''
}

/* ============================== Power Query (M) ============================== */

// Pull the M source out of the DataMashup part (inner ZIP, raw-buffer fallback).
function extractMashup(zip: AdmZip): string {
  const raw = entry(zip, /DataMashup$/i)
  if (!raw) return ''
  let m = ''
  const at = raw.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  if (at >= 0) {
    try {
      const inner = new AdmZip(raw.subarray(at))
      for (const e of inner.getEntries()) {
        if (/\.m$/i.test(e.entryName) || /Formulas\/Section/i.test(e.entryName)) {
          try { m += e.getData().toString('utf8') + '\n' } catch { /* skip */ }
        }
      }
    } catch { /* fall through */ }
  }
  if (!m.trim()) m = decode(raw)
  return m
}

// Split a Section1.m document into individual `shared <name> = <expr>;` queries.
function splitQueries(section: string): { name: string; mCode: string }[] {
  const out: { name: string; mCode: string }[] = []
  // Match `shared Name = ...;` and `shared #"Name" = ...;` up to the next `shared`/EOF.
  const re = /shared\s+(?:#"([^"]+)"|([A-Za-z_][\w.]*))\s*=\s*([\s\S]*?);\s*(?=shared\s|\n*$)/g
  let mm: RegExpExecArray | null
  while ((mm = re.exec(section)) !== null) {
    const name = (mm[1] ?? mm[2] ?? '').trim()
    const mCode = (mm[3] ?? '').trim()
    if (name) out.push({ name, mCode })
  }
  return out
}

/* ============================== connector detection ============================== */

const CONNECTOR_PATTERNS: { type: ConnectorType; re: RegExp }[] = [
  { type: 'sql_server', re: /Sql\.Databases?\s*\(\s*"([^"]*)"(?:\s*,\s*"([^"]*)")?/g },
  { type: 'analysis_services', re: /AnalysisServices\.Databases?\s*\(\s*"([^"]*)"(?:\s*,\s*"([^"]*)")?/g },
  { type: 'sharepoint', re: /SharePoint\.(?:Files|Contents|Tables)\s*\(\s*"([^"]*)"/g },
  { type: 'excel', re: /Excel\.Workbook\s*\(([^,)]*)/g },
  { type: 'csv', re: /Csv\.Document\s*\(([^,)]*)/g },
  { type: 'web_api', re: /Web\.Contents\s*\(\s*"([^"]*)"/g },
  { type: 'odata', re: /OData\.Feed\s*\(\s*"([^"]*)"/g },
  { type: 'odbc', re: /Odbc\.(?:DataSource|Query)\s*\(\s*"([^"]*)"/g },
  { type: 'folder', re: /Folder\.(?:Files|Contents)\s*\(\s*"([^"]*)"/g },
  { type: 'local_file', re: /File\.Contents\s*\(\s*"([^"]*)"/g },
]

function workspaceFromAasUrl(url: string): string | undefined {
  const m = /myorg\/([^/"?]+)/i.exec(url)
  return m ? decodeURIComponent(m[1]) : undefined
}

function refineConnector(type: ConnectorType, a?: string, b?: string): Partial<PowerBiConnector> {
  switch (type) {
    case 'sql_server': {
      const isFabric = /datawarehouse\.fabric\.microsoft\.com|\.fabric\.microsoft\.com|lakehouse/i.test(a ?? '')
      return { type: isFabric ? 'fabric_warehouse' : 'sql_server', server: a, database: b }
    }
    case 'analysis_services': {
      const isPbi = /^powerbi:\/\//i.test(a ?? '')
      return { type: isPbi ? 'powerbi_semantic_model' : 'analysis_services', url: a, server: isPbi ? undefined : a, workspace: workspaceFromAasUrl(a ?? ''), dataset: b }
    }
    case 'sharepoint': return { url: a }
    case 'web_api': case 'odata': return { url: a }
    case 'odbc': return { server: a }
    case 'folder': case 'local_file': return { filePath: a }
    case 'excel': case 'csv': {
      // Excel.Workbook(...)/Csv.Document(...) wrap an inner source — pull the
      // quoted path/URL out of the captured argument so we get the file name.
      const ref = /"([^"]+)"/.exec(a ?? '')?.[1]
      if (!ref) return {}
      return /^https?:/i.test(ref) ? { url: ref } : { filePath: ref }
    }
    default: return {}
  }
}

function connectorDisplayName(c: Partial<PowerBiConnector> & { type: ConnectorType }): string {
  if (c.dataset) return c.dataset
  if (c.database) return `${c.server ?? ''}${c.server ? ' / ' : ''}${c.database}`
  if (c.server) return c.server
  if (c.url) {
    try {
      const u = new URL(c.url)
      const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '')
      return /\.\w{2,5}$/.test(last) ? last : u.hostname // show the file name if the URL points at a file
    } catch { return c.url.slice(0, 60) }
  }
  if (c.filePath) return c.filePath.split(/[\\/]/).pop() ?? c.filePath
  return c.type
}

function sigOf(c: Partial<PowerBiConnector> & { type: ConnectorType }): string {
  return [c.type, c.server, c.database, c.url, c.filePath, c.dataset].filter(Boolean).join('|').toLowerCase()
}

/* ============================== query analysis ============================== */

function detectInText(text: string): { type: ConnectorType; a?: string; b?: string; raw: string }[] {
  const hits: { type: ConnectorType; a?: string; b?: string; raw: string }[] = []
  for (const { type, re } of CONNECTOR_PATTERNS) {
    re.lastIndex = 0
    let mm: RegExpExecArray | null
    while ((mm = re.exec(text)) !== null) {
      hits.push({ type, a: mm[1]?.trim() || undefined, b: mm[2]?.trim() || undefined, raw: mm[0].slice(0, 240) })
    }
  }
  return hits
}

function sourceTablesFrom(m: string): SourceTableRef[] {
  const out: SourceTableRef[] = []
  const seen = new Set<string>()
  const push = (name: string, schema?: string) => {
    const key = `${schema ?? ''}.${name}`.toLowerCase()
    if (name && !seen.has(key)) { seen.add(key); out.push({ name, schema }) }
  }
  let mm: RegExpExecArray | null
  const schemaItem = /\[Schema="([^"]+)",\s*Item="([^"]+)"\]/g
  while ((mm = schemaItem.exec(m)) !== null) push(mm[2], mm[1])
  const nameItem = /\[(?:Name|Item)="([^"]+)"\]/g
  while ((mm = nameItem.exec(m)) !== null) push(mm[1])
  return out.slice(0, 30)
}

function selectedColumnsFrom(m: string): string[] {
  const cols = new Set<string>()
  let mm: RegExpExecArray | null
  const sel = /Table\.SelectColumns\s*\([^,]*,\s*\{([^}]*)\}/g
  while ((mm = sel.exec(m)) !== null) {
    for (const c of mm[1].match(/"([^"]+)"/g) ?? []) cols.add(c.replace(/"/g, ''))
  }
  // Also the type-table column list: #"Changed Type" with {{"col", type}, ...}
  const typed = /Table\.TransformColumnTypes\s*\([^,]*,\s*\{([\s\S]*?)\}\s*\)/g
  while ((mm = typed.exec(m)) !== null) {
    for (const c of mm[1].match(/\{"([^"]+)"/g) ?? []) cols.add(c.replace(/[{"]/g, ''))
  }
  return [...cols].slice(0, 60)
}

function stepsFrom(m: string): PowerQueryStep[] {
  // Steps live in the `let ... in` block as `Name = Expr,`.
  const letIdx = m.indexOf('let')
  if (letIdx < 0) return []
  const body = m.slice(letIdx + 3)
  const steps: PowerQueryStep[] = []
  const re = /(?:^|,)\s*(?:#"([^"]+)"|([A-Za-z_][\w]*))\s*=\s*([A-Za-z_][\w.]*)?/g
  let mm: RegExpExecArray | null
  while ((mm = re.exec(body)) !== null) {
    const name = mm[1] ?? mm[2]
    if (!name || name === 'in') continue
    steps.push({ name, operation: mm[3] || undefined })
    if (steps.length >= 40) break
  }
  return steps
}

/* ============================== semantic model ============================== */

function parseSchemaModel(zip: AdmZip): PowerBiSemanticModel | null {
  const text = entryText(zip, /DataModelSchema$/i)
  if (!text) return null
  try {
    const schema = JSON.parse(text) as { model?: { tables?: Record<string, unknown>[]; relationships?: Record<string, unknown>[] } }
    const tables: SemanticTable[] = []
    const measures: SemanticMeasure[] = []
    for (const tbl of schema.model?.tables ?? []) {
      const tname = String(tbl.name ?? 'Table')
      if (/^(DateTableTemplate|LocalDateTable)/.test(tname)) continue
      const columns: SemanticColumn[] = ((tbl.columns as Record<string, unknown>[]) ?? [])
        .filter((c) => c.name && !String(c.name).startsWith('RowNumber'))
        .map((c) => ({ name: String(c.name), dataType: c.dataType ? String(c.dataType) : undefined }))
      const tmeasures: SemanticMeasure[] = ((tbl.measures as Record<string, unknown>[]) ?? []).map((me) => {
        const expr = Array.isArray(me.expression) ? (me.expression as string[]).join('\n') : (typeof me.expression === 'string' ? me.expression : undefined)
        return { name: String(me.name), table: tname, expression: expr }
      })
      tables.push({ name: tname, columns, measures: tmeasures })
      measures.push(...tmeasures)
    }
    const relationships: SemanticRelationship[] = (schema.model?.relationships ?? []).map((r) => ({
      fromTable: String(r.fromTable ?? ''), fromColumn: String(r.fromColumn ?? ''),
      toTable: String(r.toTable ?? ''), toColumn: String(r.toColumn ?? ''),
    })).filter((r) => r.fromTable && r.toTable)
    return { tables, measures, relationships, recoveredFrom: 'schema' }
  } catch { return null }
}

// Best-effort model recovery from the binary DataModel (pbix): ASCII scan for
// table/measure names + DAX-looking expressions. Low confidence by nature.
function parseBinaryModel(zip: AdmZip): PowerBiSemanticModel | null {
  const raw = entry(zip, /DataModel$/i)
  if (!raw) return null
  const text = asciiStrings(raw, 4)
  const measures: SemanticMeasure[] = []
  const seen = new Set<string>()
  // DAX measures often appear as `MeasureName` near `CALCULATE(`/`:=`/`SUM(`.
  const re = /([A-Za-z][\w %]{2,60})\s*[:]?=\s*((?:CALCULATE|SUM|SUMX|AVERAGE|COUNT|DIVIDE|DISTINCTCOUNT|MIN|MAX|TOTALYTD|VAR)\b[\s\S]{0,200})/g
  let mm: RegExpExecArray | null
  while ((mm = re.exec(text)) !== null) {
    const name = mm[1].trim()
    if (seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    measures.push({ name, expression: mm[2].trim().slice(0, 200) })
    if (measures.length >= 50) break
  }
  if (measures.length === 0) return null
  return { tables: [], measures, relationships: [], recoveredFrom: 'binary' }
}

/* ============================== report ============================== */

// Returns report metadata PLUS the set of fields that appeared inside an
// aggregation wrapper in a visual (Sum/Average/Count…) → strong measure/KPI signal.
// Aggregation functions Power BI wraps around a field in a visual queryRef.
const AGG_FNS = new Set(['sum', 'average', 'avg', 'count', 'countnonnull', 'min', 'max', 'median', 'stdev', 'stdevp', 'var', 'varp', 'first', 'last', 'distinctcount'])

function isBalanced(s: string): boolean {
  let p = 0, b = 0
  for (const ch of s) {
    if (ch === '(') p++; else if (ch === ')') { if (--p < 0) return false }
    else if (ch === '[') b++; else if (ch === ']') { if (--b < 0) return false }
  }
  return p === 0 && b === 0
}

// A clean identifier: letters, digits, spaces and a few business-name characters,
// but NO structural punctuation. Synthetic refs (sparkline mini-charts, nested
// measures) carry stray ()[] and are rejected rather than shown raw.
const CLEAN_IDENT = /^[\w %&/'+.-]+$/

// Parse a Layout visual queryRef into { table, field, agg }, or null when the ref
// is synthetic/auto-generated and can't be cleanly attributed to a real field.
// Handles: `Table.Field`, `Sum(Table.Field)`, `Field`, `'Table'[Field]`.
function parseQueryRef(ref: string): { table?: string; field: string; agg?: string } | null {
  let s = ref.trim()
  if (!s) return null
  let agg: string | undefined
  // Unwrap a single balanced aggregation wrapper, e.g. Sum( … ).
  const m = /^([A-Za-z][A-Za-z0-9]*)\((.+)\)$/.exec(s)
  if (m && AGG_FNS.has(m[1].toLowerCase()) && isBalanced(m[2])) { agg = m[1]; s = m[2].trim() }
  // Normalise bracket form 'Table'[Field] / Table[Field] → Table.Field.
  const br = /^'?([^'[\]]+?)'?\[([^[\]]+)\]$/.exec(s)
  if (br) s = `${br[1].trim()}.${br[2].trim()}`
  // Anything still carrying structural punctuation is synthetic → skip.
  if (/[()[\]{}]/.test(s)) return null
  const dot = s.indexOf('.')
  let table: string | undefined, field: string
  if (dot === -1) { field = s }
  else if (s.indexOf('.', dot + 1) === -1) { table = s.slice(0, dot).trim(); field = s.slice(dot + 1).trim() }
  else return null // multiple dots → ambiguous, treat as synthetic
  field = field.trim()
  if (!field || !CLEAN_IDENT.test(field)) return null
  if (table && !CLEAN_IDENT.test(table)) return null
  return { table, field, agg }
}

function parseReport(zip: AdmZip): { pages: string[]; visuals: ReportVisual[]; aggregated: Map<string, string> } {
  const text = entryText(zip, /(^|\/)Report\/Layout$/i)
  const pages: string[] = []
  const visuals: ReportVisual[] = []
  const aggregated = new Map<string, string>()
  if (!text) return { pages, visuals, aggregated }
  let layout: { sections?: Record<string, unknown>[] }
  try { layout = JSON.parse(text) } catch { return { pages, visuals, aggregated } }
  for (const sec of layout.sections ?? []) {
    const page = String(sec.displayName ?? sec.name ?? `Page ${pages.length + 1}`)
    pages.push(page)
    for (const vc of (sec.visualContainers as Record<string, unknown>[]) ?? []) {
      try {
        if (typeof vc.config !== 'string') continue
        const cfg = JSON.parse(vc.config) as { singleVisual?: { visualType?: string; projections?: Record<string, { queryRef?: string }[]> } }
        const sv = cfg.singleVisual
        if (!sv) continue
        const fields = new Set<string>()
        for (const role of Object.values(sv.projections ?? {})) for (const p of role ?? []) {
          if (!p.queryRef) continue
          const parsed = parseQueryRef(p.queryRef)
          if (!parsed) continue // skip synthetic / unparseable refs rather than emit garbage
          const key = parsed.table ? `${parsed.table}.${parsed.field}` : parsed.field
          fields.add(key)
          if (parsed.agg) aggregated.set(key, parsed.agg) // Sum, Average, Count, Min, Max…
        }
        visuals.push({ page, type: sv.visualType || 'visual', fields: [...fields] })
      } catch { /* skip visual */ }
    }
  }
  return { pages, visuals, aggregated }
}

/* ============================== BI inference ============================== */

const KPI_TOKENS = [
  'sales', 'revenue', 'amount', 'units', 'unit', 'qty', 'quantity', 'volume', 'margin', 'profit',
  'cost', 'spend', 'count', 'total', 'sum', 'average', 'avg', 'mean', 'median', 'rate', 'ratio', 'pct',
  'percent', 'share', 'index', 'score', 'value', 'price', 'gmv', 'arr', 'mrr', 'aov', 'ltv', 'cac',
  'churn', 'retention', 'conversion', 'depletion', 'depletions', 'sellthrough', 'sell_through',
  'forecast', 'actual', 'budget', 'variance', 'growth', 'yoy', 'mom', 'wow', 'qoq', 'gross', 'net',
  'ebitda', 'roi', 'units_sold', 'orders', 'transactions', 'sessions', 'visits', 'clicks', 'impressions',
]

// Time-window / period metrics: t, t-1, t+2, 4wra, 8wk, ytd, mtd, l4w, rolling…
const TIME_WINDOW_RE = /^(t([+-]\d+)?|\d+w(ra|k)?|\d+m(ra)?|\d+d|l\d+[wmd]|r\d+|ytd|mtd|qtd|wtd|fytd|rolling\w*|trailing\w*|prior|previous|last\d*\w*)$/i
function looksLikeTimeWindow(name: string): boolean {
  return TIME_WINDOW_RE.test(name.trim()) || /\b(ytd|mtd|qtd|wtd|rolling|trailing|t-\d+|\dwra|\dwk\b|yoy|mom|qoq|wow)\b/i.test(name)
}

const NUMERIC_TYPES = new Set(['int64', 'double', 'decimal', 'currency', 'number', 'int', 'integer', 'float', 'money'])
function looksNumericType(dt?: string): boolean {
  return !!dt && NUMERIC_TYPES.has(dt.toLowerCase())
}

function looksLikeKpi(name: string): boolean {
  const n = name.toLowerCase().trim()
  if (looksLikeTimeWindow(n)) return true
  return KPI_TOKENS.some((tk) => n.includes(tk))
}

// Plain-English meaning for DataVault mapping — expands time windows & common
// metric abbreviations, else humanizes the raw name.
function guessBusinessMeaning(raw: string): string {
  const n = raw.toLowerCase().trim()
  const tw: Record<string, string> = {
    t: 'Current period', ytd: 'Year to date', mtd: 'Month to date', qtd: 'Quarter to date', wtd: 'Week to date',
    '4wra': '4-week rolling average', '8wra': '8-week rolling average', '12wra': '12-week rolling average',
    '13wra': '13-week rolling average', '4wk': 'Last 4 weeks', '8wk': 'Last 8 weeks',
  }
  if (tw[n]) return tw[n]
  let m = /^t([+-])(\d+)$/.exec(n)
  if (m) return m[1] === '-' ? `${m[2]} period${m[2] === '1' ? '' : 's'} ago` : `${m[2]} period(s) ahead`
  m = /^l(\d+)([wmd])$/.exec(n)
  if (m) { const u = { w: 'weeks', m: 'months', d: 'days' }[m[2]]; return `Last ${m[1]} ${u}` }
  m = /^(\d+)wra$/.exec(n)
  if (m) return `${m[1]}-week rolling average`
  const abbr: Record<string, string> = {
    gmv: 'Gross merchandise value', arr: 'Annual recurring revenue', mrr: 'Monthly recurring revenue',
    aov: 'Average order value', ltv: 'Lifetime value', cac: 'Customer acquisition cost', roi: 'Return on investment',
    yoy: 'Year over year', mom: 'Month over month', qoq: 'Quarter over quarter', wow: 'Week over week',
    units_sold: 'Units sold', sell_through: 'Sell-through rate', ebitda: 'EBITDA',
  }
  if (abbr[n]) return abbr[n]
  return humanizeEntity(raw)
}

function humanizeEntity(raw: string): string {
  let s = raw.replace(/^.*[.[]/, '').replace(/[\]"']/g, '').trim() // strip table prefix / brackets
  s = s.replace(/[_-]+/g, ' ')
  // split camelCase / glued words minimally
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2')
  s = s.replace(/\b(master|dim|fact|tbl|table|raw|stg|staging)\b/gi, '').trim()
  // singularize last word
  const words = s.split(/\s+/).filter(Boolean)
  if (words.length) {
    const last = words[words.length - 1]
    words[words.length - 1] = last.replace(/ies$/i, 'y').replace(/sses$/i, 'ss').replace(/s$/i, '')
  }
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').trim()
}

function isBusinessKey(col: string): { yes: boolean; reason: string } {
  const c = col.toLowerCase()
  if (/(^|_)(id|key|code|number|no|sku|guid|uuid)$/.test(c)) return { yes: true, reason: `Name ends in a key token ("${col}")` }
  if (/^(id|sku|ean|upc)$/.test(c)) return { yes: true, reason: `Identifier-style column ("${col}")` }
  return { yes: false, reason: '' }
}

/* ============================== core ============================== */

function inspectZip(buf: Buffer, fileName: string, scanMode: 'static' | 'deep', fileSizeBytes?: number): PowerBiInspectionResult {
  const limitations: string[] = []
  const evidence: EvidenceSnippet[] = []
  const evId = ids('ev')
  const addEvidence = (kind: string, snippet: string, source = fileName): string => {
    const id = evId()
    evidence.push({ id, source, kind, snippet: snippet.slice(0, 400) })
    return id
  }

  let zip: AdmZip | null = null
  try { zip = new AdmZip(buf) } catch { limitations.push('File is not a readable ZIP archive — could not inspect.') }

  const fileType: PowerBiInspectionResult['file']['fileType'] =
    /\.pbit$/i.test(fileName) ? 'pbit' : /\.pbix$/i.test(fileName) ? 'pbix' : /\.pbip$/i.test(fileName) ? 'pbip' : 'unknown'

  const connectors: PowerBiConnector[] = []
  const queries: PowerBiQuery[] = []
  const kpis: KpiCandidate[] = []
  const risks: RiskFlag[] = []
  const connId = ids('c'), qId = ids('q'), kpiId = ids('kpi'), riskId = ids('risk'), entId = ids('ent')

  let report: PowerBiReport = { pages: [], visuals: [] }
  let reportAggregated = new Map<string, string>() // visual field → aggregation fn
  let semanticModel: PowerBiSemanticModel = { tables: [], measures: [], relationships: [], recoveredFrom: 'none' }

  if (zip) {
    // ---- queries + connectors from Power Query ----
    const mashup = extractMashup(zip)
    const qParts = mashup ? splitQueries(mashup) : []
    // Connector registry keyed by signature.
    const connBySig = new Map<string, PowerBiConnector>()
    const registerConnector = (hit: { type: ConnectorType; a?: string; b?: string; raw: string }, queryName?: string, mCode = ''): string => {
      const refined = refineConnector(hit.type, hit.a, hit.b)
      const merged = { type: refined.type ?? hit.type, ...refined } as Partial<PowerBiConnector> & { type: ConnectorType }
      // Excel/CSV often come from a folder/SharePoint step, so the file name isn't
      // in the Excel.Workbook(...) call — scan the whole query for a file literal
      // (e.g. [Name="Sales.xlsx"] or File.Contents("…\Sales.csv")).
      if ((merged.type === 'excel' || merged.type === 'csv') && !merged.filePath && !merged.url) {
        const fileLit = /["']([^"']+\.(?:xlsx|xlsb|xlsm|xls|csv))["']/i.exec(mCode)?.[1]
        if (fileLit) { if (/^https?:/i.test(fileLit)) merged.url = fileLit; else merged.filePath = fileLit }
      }
      const sig = sigOf(merged)
      let c = connBySig.get(sig)
      if (!c) {
        c = {
          id: connId(), type: merged.type, displayName: connectorDisplayName(merged),
          server: merged.server, database: merged.database, url: merged.url,
          workspace: merged.workspace, dataset: merged.dataset, filePath: merged.filePath,
          rawExpression: hit.raw, queryNames: [],
          confidence: merged.server || merged.url || merged.database ? 'high' : 'medium',
        }
        connBySig.set(sig, c)
        connectors.push(c)
        addEvidence('connector', hit.raw)
      }
      if (queryName && !c.queryNames.includes(queryName)) c.queryNames.push(queryName)
      return c.id
    }

    for (const part of qParts) {
      const hits = detectInText(part.mCode)
      const cIds = hits.map((h) => registerConnector(h, part.name, part.mCode))
      const sourceTables = sourceTablesFrom(part.mCode)
      const q: PowerBiQuery = {
        id: qId(), name: part.name, mCode: part.mCode.slice(0, 4000),
        connectors: [...new Set(cIds)],
        sourceTables,
        selectedColumns: selectedColumnsFrom(part.mCode),
        transformationSteps: stepsFrom(part.mCode),
        dependsOnQueries: qParts.filter((o) => o.name !== part.name && new RegExp(`#?"?${o.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`).test(part.mCode)).map((o) => o.name),
        outputEntityGuess: humanizeEntity(part.name) || undefined,
      }
      queries.push(q)
    }

    // Backfill Excel/CSV file names from any literal anywhere in the mashup — the
    // name often lives in a different query (e.g. a SharePoint source query) than
    // the Excel.Workbook(...) call that produced the connector.
    const nameless = connectors.filter((c) => (c.type === 'excel' || c.type === 'csv') && !c.filePath && !c.url)
    if (nameless.length) {
      const allM = qParts.map((p) => p.mCode).join('\n')
      const seen = new Set<string>()
      const lits = [...allM.matchAll(/["']([^"']+\.(?:xlsx|xlsb|xlsm|xls|csv))["']/gi)]
        .map((m) => m[1]).filter((l) => { const k = l.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
      nameless.forEach((c, i) => {
        const lit = lits[i] ?? lits[0]
        if (lit) {
          if (/^https?:/i.test(lit)) c.url = lit; else c.filePath = lit
          c.displayName = connectorDisplayName(c)
        }
      })
    }

    // Connectors only visible in the binary (deep mode) — no owning query.
    if (scanMode === 'deep') {
      const dm = entry(zip, /DataModel$/i)
      const blob = (mashup ? '' : '') + (dm ? asciiStrings(dm, 6) : '') + '\n' + entryText(zip, /(^|\/)Connections$/i)
      for (const h of detectInText(blob)) {
        const sig = sigOf(refineConnector(h.type, h.a, h.b) as Partial<PowerBiConnector> & { type: ConnectorType })
        if (!connBySig.has(sig)) registerConnector(h)
      }
    } else {
      // static: still scan the Connections part (cheap, text).
      const conn = entryText(zip, /(^|\/)Connections$/i)
      if (conn) for (const h of detectInText(conn)) registerConnector(h)
    }

    // ---- semantic model ----
    semanticModel = parseSchemaModel(zip) ?? (scanMode === 'deep' ? parseBinaryModel(zip) : null) ?? semanticModel
    if (semanticModel.recoveredFrom === 'none' && fileType === 'pbix') {
      limitations.push('No DataModelSchema present (typical for .pbix). Export a .pbit for full tables, columns & DAX measures.')
    }
    if (semanticModel.recoveredFrom === 'binary') {
      limitations.push('Measures recovered heuristically from the binary DataModel — names/expressions are approximate.')
    }

    // ---- report ----
    { const rep = parseReport(zip); report = { pages: rep.pages, visuals: rep.visuals }; reportAggregated = rep.aggregated }
    if (report.pages.length === 0) limitations.push('No readable Report/Layout — the report may use the newer PBIR format.')

    // ---- evidence for measures ----
    for (const me of semanticModel.measures) if (me.expression) addEvidence('measure', `${me.name} := ${me.expression}`)
  }

  /* ---------- KPI inference ---------- */
  const kpiSeen = new Set<string>()
  const addKpi = (k: Omit<KpiCandidate, 'id'>) => {
    const key = `${k.name}|${k.table ?? ''}`.toLowerCase()
    if (kpiSeen.has(key)) return
    kpiSeen.add(key)
    kpis.push({ id: kpiId(), ...k })
  }
  // 1) Real DAX measures — highest confidence; reference their evidence.
  for (const me of semanticModel.measures) {
    const ev = me.expression ? evidence.find((e) => e.kind === 'measure' && e.snippet.startsWith(`${me.name} `)) : undefined
    addKpi({ name: me.name, source: 'measure', expression: me.expression, table: me.table, businessMeaningGuess: guessBusinessMeaning(me.name), confidence: 'high', evidenceIds: ev ? [ev.id] : [] })
  }
  // 2) Fields placed on visuals. A field wrapped in an aggregation (Sum/Avg/…)
  //    IS a metric → high confidence; otherwise keep metric-looking / time-window ones.
  const visualFields = new Set<string>()
  for (const v of report.visuals) for (const f of v.fields) visualFields.add(f)
  for (const f of visualFields) {
    const table = f.includes('.') ? f.slice(0, f.indexOf('.')) : undefined
    const field = f.includes('.') ? f.slice(f.indexOf('.') + 1) : f
    const agg = reportAggregated.get(f)
    if (agg || looksLikeKpi(field)) {
      addKpi({
        name: field, source: 'visual_field', field, table,
        expression: agg ? `${agg}(${f})` : undefined,
        businessMeaningGuess: guessBusinessMeaning(field),
        confidence: agg ? 'high' : 'medium', evidenceIds: [],
      })
    }
  }
  // 3) Numeric-looking / time-window columns from the model.
  for (const t of semanticModel.tables) for (const c of t.columns) {
    const numeric = looksNumericType(c.dataType)
    if (numeric || looksLikeKpi(c.name)) {
      addKpi({ name: c.name, source: 'column_name', field: c.name, table: t.name, businessMeaningGuess: guessBusinessMeaning(c.name), confidence: numeric ? 'medium' : 'low', evidenceIds: [] })
    }
  }

  /* ---------- DataVault inference ---------- */
  const entityBySig = new Map<string, DataVaultEntityCandidate>()
  const addEntity = (humanized: string, sourceName: string, confidence: Confidence) => {
    if (!humanized) return
    const sig = humanized.toLowerCase()
    let e = entityBySig.get(sig)
    if (!e) { e = { id: entId(), name: humanized, sourceNames: [], confidence }; entityBySig.set(sig, e) }
    if (!e.sourceNames.includes(sourceName)) e.sourceNames.push(sourceName)
  }
  for (const q of queries) { addEntity(humanizeEntity(q.name), q.name, 'medium'); for (const st of q.sourceTables) addEntity(humanizeEntity(st.name), `${st.schema ? st.schema + '.' : ''}${st.name}`, 'high') }
  for (const t of semanticModel.tables) addEntity(humanizeEntity(t.name), t.name, 'high')
  for (const f of visualFields) if (f.includes('.')) addEntity(humanizeEntity(f.slice(0, f.indexOf('.'))), f.slice(0, f.indexOf('.')), 'low')

  const attributes: DataVaultAttributeCandidate[] = []
  const businessKeys: BusinessKeyCandidate[] = []
  for (const t of semanticModel.tables) {
    const ent = humanizeEntity(t.name)
    for (const c of t.columns) {
      attributes.push({ entity: ent, name: c.name })
      const bk = isBusinessKey(c.name)
      if (bk.yes) businessKeys.push({ entity: ent, column: c.name, reason: bk.reason })
    }
  }
  for (const q of queries) {
    const ent = q.outputEntityGuess ?? humanizeEntity(q.name)
    for (const col of q.selectedColumns) {
      attributes.push({ entity: ent, name: col })
      const bk = isBusinessKey(col)
      if (bk.yes) businessKeys.push({ entity: ent, column: col, reason: bk.reason })
    }
  }
  const sourceSystems: SourceSystemCandidate[] = connectors
    .filter((c) => ['sql_server', 'fabric_warehouse', 'analysis_services', 'powerbi_semantic_model', 'odbc', 'sharepoint', 'odata', 'web_api'].includes(c.type))
    .map((c) => ({ name: c.displayName, type: c.type, server: c.server, database: c.database, connectorId: c.id }))

  const dataVault: DataVaultExtraction = {
    entities: [...entityBySig.values()],
    attributes: dedupeAttrs(attributes),
    businessKeys: dedupeKeys(businessKeys),
    sourceSystems,
  }

  /* ---------- lineage ---------- */
  const lineageCandidates: LineageCandidate[] = []
  for (const c of connectors) for (const qn of c.queryNames) {
    const q = queries.find((x) => x.name === qn)
    if (q) for (const st of q.sourceTables) lineageCandidates.push({ from: c.displayName, to: `${st.schema ? st.schema + '.' : ''}${st.name}`, type: 'source_to_table', confidence: 'medium', evidenceIds: [] })
  }
  for (const q of queries) {
    const ent = q.outputEntityGuess
    for (const st of q.sourceTables) if (ent) lineageCandidates.push({ from: st.name, to: ent, type: 'table_to_entity', confidence: 'medium', evidenceIds: [] })
    for (const dep of q.dependsOnQueries) lineageCandidates.push({ from: dep, to: q.name, type: 'query_to_query', confidence: 'high', evidenceIds: [] })
  }
  for (const k of kpis) if (k.table) lineageCandidates.push({ from: humanizeEntity(k.table), to: k.name, type: 'entity_to_kpi', confidence: k.confidence, evidenceIds: k.evidenceIds })

  /* ---------- risk flags ---------- */
  for (const c of connectors) {
    if (c.url && /[?&](key|token|apikey|api_key|sig|password|pwd)=/i.test(c.url)) {
      risks.push({ id: riskId(), severity: 'high', category: 'secret_in_url', message: `Possible secret embedded in a Web/OData URL for "${c.displayName}".`, evidenceIds: [addEvidence('risk', c.rawExpression)] })
    }
    if (c.server) {
      risks.push({ id: riskId(), severity: 'info', category: 'hardcoded_source', message: `Hard-coded ${c.type} server "${c.server}"${c.database ? ` / database "${c.database}"` : ''}.`, evidenceIds: [addEvidence('risk', c.rawExpression)] })
    }
    if (c.type === 'local_file' || c.type === 'folder') {
      risks.push({ id: riskId(), severity: 'medium', category: 'local_dependency', message: `Depends on a local file/folder path ("${c.filePath ?? ''}") — won't refresh in the service without a gateway.`, evidenceIds: [addEvidence('risk', c.rawExpression)] })
    }
  }
  for (const q of queries) {
    if (/(password|pwd|secret|apikey|api_key|bearer)\s*=/i.test(q.mCode)) {
      risks.push({ id: riskId(), severity: 'high', category: 'credential_in_query', message: `Query "${q.name}" appears to contain an inline credential.`, evidenceIds: [addEvidence('risk', q.name)] })
    }
  }

  /* ---------- refresh / timezone clues (informational risks) ---------- */
  if (zip) {
    const settings = entryText(zip, /(^|\/)Settings$/i) + entryText(zip, /(^|\/)Metadata$/i)
    const tz = /TimeZone[^"]*"([^"]+)"|"timeZone"\s*:\s*"([^"]+)"/i.exec(settings)
    if (tz) risks.push({ id: riskId(), severity: 'info', category: 'refresh_timezone', message: `Refresh/timezone clue: ${(tz[1] || tz[2])}.`, evidenceIds: [] })
  }

  if (scanMode === 'static') limitations.push('Static scan: binary DataModel was not deep-scanned. Re-run with scanMode:"deep" for binary measure recovery.')
  limitations.push('Phase 1: VertiPaq row data is not extracted — output is metadata, connectors, KPIs and lineage mapping.')

  return {
    file: { fileName, fileType, fileSizeBytes, inspectedAt: new Date().toISOString() },
    summary: {
      connectorCount: connectors.length, queryCount: queries.length, pageCount: report.pages.length,
      visualCount: report.visuals.length, tableCount: semanticModel.tables.length, measureCount: semanticModel.measures.length,
      relationshipCount: semanticModel.relationships.length, riskCount: risks.length,
      kpiCandidateCount: kpis.length, dataVaultEntityCount: dataVault.entities.length,
    },
    connectors, queries, semanticModel, report, kpis, dataVault,
    lineage: { candidates: lineageCandidates }, risks, evidence, limitations,
  }
}

function dedupeAttrs(a: DataVaultAttributeCandidate[]): DataVaultAttributeCandidate[] {
  const seen = new Set<string>(); const out: DataVaultAttributeCandidate[] = []
  for (const x of a) { const k = `${x.entity}|${x.name}`.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(x) } }
  return out.slice(0, 400)
}
function dedupeKeys(a: BusinessKeyCandidate[]): BusinessKeyCandidate[] {
  const seen = new Set<string>(); const out: BusinessKeyCandidate[] = []
  for (const x of a) { const k = `${x.entity}|${x.column}`.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(x) } }
  return out
}

/* ============================== public API ============================== */

/** A compact markdown brief for the Data Vault / AI grounding context. */
export function inspectionToMarkdown(r: PowerBiInspectionResult): string {
  const L: string[] = [`# Power BI report: ${r.file.fileName}`]
  L.push(`${r.summary.connectorCount} connectors · ${r.summary.tableCount} tables · ${r.summary.measureCount} measures · ${r.summary.kpiCandidateCount} KPI candidates · ${r.summary.pageCount} pages`)
  if (r.dataVault.sourceSystems.length) {
    L.push('\n## Source systems')
    for (const s of r.dataVault.sourceSystems) L.push(`- ${s.name} (${s.type})${s.database ? ` — db: ${s.database}` : ''}`)
  }
  if (r.connectors.length) {
    L.push('\n## Connectors')
    for (const c of r.connectors) L.push(`- ${c.displayName} [${c.type}]${c.server ? ` server=${c.server}` : ''}${c.database ? ` db=${c.database}` : ''}${c.dataset ? ` dataset=${c.dataset}` : ''}`)
  }
  if (r.dataVault.entities.length) {
    L.push('\n## Inferred entities')
    for (const e of r.dataVault.entities) L.push(`- ${e.name} (from: ${e.sourceNames.slice(0, 4).join(', ')})`)
  }
  if (r.kpis.length) {
    L.push('\n## KPI candidates')
    for (const k of r.kpis.slice(0, 40)) L.push(`- ${k.name}${k.table ? ` [${k.table}]` : ''} — ${k.source}${k.expression ? `: ${k.expression.slice(0, 120)}` : ''}`)
  }
  if (r.semanticModel.tables.length) {
    L.push('\n## Tables')
    for (const t of r.semanticModel.tables.slice(0, 30)) L.push(`- ${t.name} (${t.columns.length} cols): ${t.columns.slice(0, 20).map((c) => c.name).join(', ')}`)
  }
  if (r.queries.length) {
    L.push('\n## Power Query')
    for (const q of r.queries.slice(0, 30)) L.push(`- ${q.name} — ${q.transformationSteps.length} steps${q.sourceTables.length ? `, sources: ${q.sourceTables.map((s) => s.name).slice(0, 6).join(', ')}` : ''}`)
  }
  if (r.risks.length) {
    L.push('\n## Risk flags')
    for (const k of r.risks) L.push(`- [${k.severity}] ${k.message}`)
  }
  if (r.limitations.length) L.push('\n## Limitations', ...r.limitations.map((x) => `- ${x}`))
  return L.join('\n')
}

/** Inspect a Power BI file already in memory (used by the upload pipeline). */
export function inspectPowerBiBuffer(buf: Buffer, fileName: string, opts?: { scanMode?: 'static' | 'deep' }): PowerBiInspectionResult {
  return inspectZip(buf, fileName, opts?.scanMode ?? 'deep', buf.length)
}

/** Inspect a Power BI file on disk. */
export async function inspectPowerBiFile(input: InspectPowerBiInput): Promise<PowerBiInspectionResult> {
  let buf: Buffer
  let size: number | undefined
  try {
    buf = await readFile(input.filePath)
    try { size = (await stat(input.filePath)).size } catch { size = buf.length }
  } catch {
    return {
      file: { fileName: input.fileName, fileType: 'unknown', inspectedAt: new Date().toISOString() },
      summary: { connectorCount: 0, queryCount: 0, pageCount: 0, visualCount: 0, tableCount: 0, measureCount: 0, relationshipCount: 0, riskCount: 0, kpiCandidateCount: 0, dataVaultEntityCount: 0 },
      connectors: [], queries: [], semanticModel: { tables: [], measures: [], relationships: [], recoveredFrom: 'none' },
      report: { pages: [], visuals: [] }, kpis: [], dataVault: { entities: [], attributes: [], businessKeys: [], sourceSystems: [] },
      lineage: { candidates: [] }, risks: [], evidence: [], limitations: [`Could not read file at ${input.filePath}.`],
    }
  }
  const result = inspectZip(buf, input.fileName, input.scanMode ?? 'deep', size)
  return result
}

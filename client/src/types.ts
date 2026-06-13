// Shared domain types — COPY of PRD §6 (kept in sync with server/src/types.ts).
// Do not rename fields.

export interface Connector {
  id: string
  name: string
  kind:
    | 'powerbi'
    | 'snowflake'
    | 'salesforce'
    | 'hubspot'
    | 'sqlserver'
    | 'sheets'
    | 'sap'
    | 'excel'
    | 'rest'
  tables: string[]
  status: 'connected' | 'syncing'
}

export interface Measure {
  id: string
  name: string
  expression: string
  format: 'currency' | 'percent' | 'number'
}

export interface Dimension {
  id: string
  name: string
  values: string[]
}

export interface KPI {
  id: string
  name: string
  format: 'currency' | 'percent' | 'number'
  current: number
  previous: number // for delta
  goodDirection: 'up' | 'down' // is up good?
  series: { date: string; value: number }[] // daily time series
  byDimension: Record<string, { label: string; value: number }[]> // dimId -> breakdown
}

export interface SemanticModel {
  id: string
  name: string
  source: 'sample' | 'upload'
  connectors: Connector[]
  dimensions: Dimension[]
  measures: Measure[]
  kpis: KPI[]
  dateRange: { start: string; end: string }
}

export type AgentStage = 'ingest' | 'connectors' | 'kpis' | 'anomaly' | 'brief'

export interface AgentEvent {
  id: string
  agent: string
  stage: AgentStage
  message: string
  status: 'running' | 'done' | 'alert'
  ts: string
}

export interface Anomaly {
  id: string
  kpiId: string
  kpiName: string
  date: string
  observed: number
  expected: number
  deviation: number // z-like score
  severity: 'low' | 'medium' | 'high'
  rootCause: {
    dimensionId: string
    dimensionName: string
    label: string
    contribution: number
  }
  brief: string // NL explanation
  recommendation: { id: string; title: string; detail: string; action: string }
}

export interface AuditEntry {
  id: string
  ts: string
  actor: 'agent' | 'user'
  summary: string
}

export interface AskAnswer {
  kpiId: string | null
  answer: string
  value?: number
  format?: string
  trend?: string
}

// Convenience shape for the model list endpoint (GET /api/models).
export type ModelListItem = Pick<SemanticModel, 'id' | 'name' | 'source'>

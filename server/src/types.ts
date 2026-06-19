// DeepLogic shared domain types — authoritative contract (PRD §6).
// Mirrored in client/src/types.ts. Do NOT rename fields.

export interface Connector {
  id: string;
  name: string;
  kind:
    | 'powerbi'
    | 'snowflake'
    | 'salesforce'
    | 'hubspot'
    | 'sqlserver'
    | 'sheets'
    | 'sap'
    | 'excel'
    | 'rest';
  tables: string[];
  status: 'connected' | 'syncing';
}

export interface Measure {
  id: string;
  name: string;
  expression: string;
  format: 'currency' | 'percent' | 'number';
}

export interface Dimension {
  id: string;
  name: string;
  values: string[];
}

export interface KPI {
  id: string;
  name: string;
  format: 'currency' | 'percent' | 'number';
  current: number;
  previous: number; // for delta
  goodDirection: 'up' | 'down'; // is up good?
  series: { date: string; value: number }[]; // daily time series
  byDimension: Record<string, { label: string; value: number }[]>; // dimId -> breakdown
}

export interface SemanticModel {
  id: string;
  name: string;
  source: 'sample' | 'upload';
  connectors: Connector[];
  dimensions: Dimension[];
  measures: Measure[];
  kpis: KPI[];
  dateRange: { start: string; end: string };
}

export type AgentStage = 'ingest' | 'connectors' | 'kpis' | 'anomaly' | 'brief';

export interface AgentEvent {
  id: string;
  agent: string;
  stage: AgentStage;
  message: string;
  status: 'running' | 'done' | 'alert';
  ts: string;
}

export interface Anomaly {
  id: string;
  kpiId: string;
  kpiName: string;
  date: string;
  observed: number;
  expected: number;
  deviation: number; // z-like score
  severity: 'low' | 'medium' | 'high';
  rootCause: {
    dimensionId: string;
    dimensionName: string;
    label: string;
    contribution: number;
  };
  brief: string; // NL explanation
  recommendation: { id: string; title: string; detail: string; action: string };
}

export interface AuditEntry {
  id: string;
  ts: string;
  actor: 'agent' | 'user';
  summary: string;
}

export interface AskAnswer {
  kpiId: string | null;
  answer: string;
  value?: number;
  format?: string;
  trend?: string;
}

// ---------------------------------------------------------------------------
// DeepLogic Studio (PRD v3) — AI "vibecoding" report builder.
// ---------------------------------------------------------------------------

export interface StudioMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: string;
}

export interface StudioVersion {
  html: string;
  prompt: string;
  ts: string;
}

// A per-report Data Vault item: a file, MCP server, API, or note attached to
// one Studio project that feeds the AI's context when vibecoding that report.
export interface VaultItem {
  id: string;
  kind: 'file' | 'mcp' | 'api' | 'note';
  name: string;
  content: string; // file text / note body (empty for mcp/api)
  meta: Record<string, unknown>; // mcp/api: { url, description, auth }, files: { filename, size }
  enabled: boolean; // whether this item is included in the AI's compiled context
  ts: string;
}

export interface StudioProject {
  id: string;
  name: string;
  slug: string;
  visibility: 'private' | 'org' | 'published';
  ownerId: string;
  ownerEmail?: string;
  isOwner: boolean;
  html: string;
  modelId: string | null;
  dashboardId: string | null;
  messages: StudioMessage[];
  versions: StudioVersion[];
  vault: VaultItem[];
  updatedAt: string;
}

export interface ContextItem {
  id: string;
  scope: 'user' | 'org';
  kind: 'doc' | 'html' | 'mcp' | 'note' | 'image' | 'website' | 'data';
  name: string;
  content: string;
  meta: Record<string, unknown>;
  enabled: boolean;
  isOwner: boolean;
}

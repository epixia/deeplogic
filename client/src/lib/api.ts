// Typed fetch client for the multi-tenant DeepLogic API (PRD v2 §v2 API).
// Every call takes the caller's access token (sent as Authorization: Bearer)
// and, where tenant-scoped, the active orgId. SSE helpers append ?token= to
// the URL because EventSource cannot set request headers.
//
// All routes are under /api (proxied by Vite to http://localhost:8787).

import type {
  AgentEvent,
  Anomaly,
  AskAnswer,
  AuditEntry,
  ModelListItem,
  SemanticModel,
} from '../types'

const BASE = '/api'

/* ---------------- shared tenant types ---------------- */

export type OrgRole = 'owner' | 'admin' | 'member'

export interface OrgMembership {
  id: string
  name: string
  slug: string
  role: OrgRole
}

export interface Member {
  userId: string
  email: string
  role: OrgRole
}

/* ---------------- core fetch helper ---------------- */

function authHeaders(token: string, extra?: HeadersInit): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    ...(extra ?? {}),
  }
}

async function jsonFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: authHeaders(token, {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    }),
  })
  if (!res.ok) {
    throw new Error(await errorDetail(res))
  }
  // Some endpoints (DELETE) return no body.
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

async function errorDetail(res: Response): Promise<string> {
  let detail = ''
  try {
    const body = await res.text()
    if (body) {
      try {
        const parsed = JSON.parse(body) as { error?: string; message?: string }
        detail = parsed.error ?? parsed.message ?? body
      } catch {
        detail = body
      }
    }
  } catch {
    /* ignore */
  }
  return `Request failed: ${res.status} ${res.statusText}${
    detail ? ` — ${detail}` : ''
  }`
}

const enc = encodeURIComponent

/* ---------------- identity + orgs ---------------- */

// GET /api/me
export function getMe(
  token: string,
): Promise<{ user: { id: string; email: string }; orgs: OrgMembership[] }> {
  return jsonFetch(token, '/me')
}

// POST /api/orgs { name } -> creates org + owner membership + seeds 2 samples
export function createOrg(token: string, name: string): Promise<OrgMembership> {
  return jsonFetch(token, '/orgs', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

/* ---------------- member management (RBAC) ---------------- */

// GET /api/orgs/:orgId/members
export function listMembers(token: string, orgId: string): Promise<Member[]> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/members`)
}

// PATCH /api/orgs/:orgId/members/:userId { role }
export function updateMemberRole(
  token: string,
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<Member> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/members/${enc(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
}

// DELETE /api/orgs/:orgId/members/:userId
export function removeMember(
  token: string,
  orgId: string,
  userId: string,
): Promise<void> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/members/${enc(userId)}`, {
    method: 'DELETE',
  })
}

// POST /api/orgs/:orgId/members { email, role } -> add an already-registered user
export function addMemberByEmail(
  token: string,
  orgId: string,
  email: string,
  role: OrgRole,
): Promise<Member> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  })
}

/* ---------------- models ---------------- */

// GET /api/orgs/:orgId/models
export function listModels(
  token: string,
  orgId: string,
): Promise<ModelListItem[]> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/models`)
}

// GET /api/orgs/:orgId/models/:id
export function getModel(
  token: string,
  orgId: string,
  modelId: string,
): Promise<SemanticModel> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/models/${enc(modelId)}`)
}

// POST /api/orgs/:orgId/ingest { sampleId } -> { modelId }
export function ingestSample(
  token: string,
  orgId: string,
  sampleId: string,
): Promise<{ modelId: string }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/ingest`, {
    method: 'POST',
    body: JSON.stringify({ sampleId }),
  })
}

// POST /api/orgs/:orgId/ingest (multipart file) -> { modelId }
export function ingestUpload(
  token: string,
  orgId: string,
  file: File,
): Promise<{ modelId: string }> {
  const form = new FormData()
  form.append('file', file)
  // Do NOT set Content-Type; the browser sets the multipart boundary itself.
  return fetch(`${BASE}/orgs/${enc(orgId)}/ingest`, {
    method: 'POST',
    headers: authHeaders(token),
    body: form,
  }).then(async (res) => {
    if (!res.ok) throw new Error(await errorDetail(res))
    return (await res.json()) as { modelId: string }
  })
}

// GET /api/orgs/:orgId/models/:id/anomalies
export function anomalies(
  token: string,
  orgId: string,
  modelId: string,
): Promise<Anomaly[]> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/models/${enc(modelId)}/anomalies`)
}

// POST /api/orgs/:orgId/models/:id/actions/:anomalyId/approve
export function approveAction(
  token: string,
  orgId: string,
  modelId: string,
  anomalyId: string,
): Promise<AuditEntry> {
  return jsonFetch(
    token,
    `/orgs/${enc(orgId)}/models/${enc(modelId)}/actions/${enc(
      anomalyId,
    )}/approve`,
    { method: 'POST' },
  )
}

// GET /api/orgs/:orgId/models/:id/audit
export function audit(
  token: string,
  orgId: string,
  modelId: string,
): Promise<AuditEntry[]> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/models/${enc(modelId)}/audit`)
}

// POST /api/orgs/:orgId/models/:id/ask { question }
export function ask(
  token: string,
  orgId: string,
  modelId: string,
  question: string,
): Promise<AskAnswer> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/models/${enc(modelId)}/ask`, {
    method: 'POST',
    body: JSON.stringify({ question }),
  })
}

/* ---------------- SSE stream helpers ---------------- */

export interface SSEHandlers {
  /** Fired for each parsed AgentEvent on the default message channel. */
  onEvent: (event: AgentEvent) => void
  /** Fired when the stream signals completion (server "done" event). */
  onDone?: () => void
  /** Fired on a transport/parse error. */
  onError?: (err: Event) => void
}

/**
 * Open the ingestion SSE stream:
 *   GET /api/orgs/:orgId/ingest/:modelId/stream?token=
 * Returns the EventSource so callers can .close() it.
 */
export function openIngestStream(
  token: string,
  orgId: string,
  modelId: string,
  handlers: SSEHandlers,
): EventSource {
  const es = new EventSource(
    `${BASE}/orgs/${enc(orgId)}/ingest/${enc(modelId)}/stream?token=${enc(
      token,
    )}`,
  )
  bindAgentStream(es, handlers)
  return es
}

/**
 * Open the live mission-control SSE stream:
 *   GET /api/orgs/:orgId/models/:id/mission/stream?token=
 * Returns the EventSource so callers can .close() it.
 */
export function openMissionStream(
  token: string,
  orgId: string,
  modelId: string,
  handlers: SSEHandlers,
): EventSource {
  const es = new EventSource(
    `${BASE}/orgs/${enc(orgId)}/models/${enc(modelId)}/mission/stream?token=${enc(
      token,
    )}`,
  )
  bindAgentStream(es, handlers)
  return es
}

function bindAgentStream(es: EventSource, handlers: SSEHandlers): void {
  const parse = (raw: string): AgentEvent | null => {
    try {
      return JSON.parse(raw) as AgentEvent
    } catch {
      return null
    }
  }

  // Default unnamed events.
  es.onmessage = (e) => {
    const evt = parse(e.data)
    if (evt) handlers.onEvent(evt)
  }

  // Named "event: event" channel (the server tags AgentEvents this way).
  es.addEventListener('event', (e) => {
    const evt = parse((e as MessageEvent).data)
    if (evt) handlers.onEvent(evt)
  })

  // Named "event: done" terminator (server may also send via default channel).
  es.addEventListener('done', () => {
    handlers.onDone?.()
    es.close()
  })

  es.onerror = (err) => {
    handlers.onError?.(err)
  }
}

/* ---------------- public demo (no auth) ---------------- */

async function demoFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(await errorDetail(res))
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export function demoSamples(): Promise<{ id: string; name: string }[]> {
  return demoFetch('/demo/samples')
}

export function demoIngestSample(sampleId: string): Promise<{ demoId: string }> {
  return demoFetch('/demo/ingest', {
    method: 'POST',
    body: JSON.stringify({ sampleId }),
  })
}

export function demoIngestUpload(file: File): Promise<{ demoId: string }> {
  const form = new FormData()
  form.append('file', file)
  return fetch(`${BASE}/demo/ingest`, { method: 'POST', body: form }).then(
    async (res) => {
      if (!res.ok) throw new Error(await errorDetail(res))
      return (await res.json()) as { demoId: string }
    },
  )
}

export function demoGetModel(demoId: string): Promise<SemanticModel> {
  return demoFetch(`/demo/${enc(demoId)}`)
}

export function demoAnomalies(demoId: string): Promise<Anomaly[]> {
  return demoFetch(`/demo/${enc(demoId)}/anomalies`)
}

export function demoApprove(demoId: string, anomalyId: string): Promise<AuditEntry> {
  return demoFetch(`/demo/${enc(demoId)}/actions/${enc(anomalyId)}/approve`, {
    method: 'POST',
  })
}

export function demoAudit(demoId: string): Promise<AuditEntry[]> {
  return demoFetch(`/demo/${enc(demoId)}/audit`)
}

export function demoAsk(demoId: string, question: string): Promise<AskAnswer> {
  return demoFetch(`/demo/${enc(demoId)}/ask`, {
    method: 'POST',
    body: JSON.stringify({ question }),
  })
}

export function openDemoIngestStream(
  demoId: string,
  handlers: SSEHandlers,
): EventSource {
  const es = new EventSource(`${BASE}/demo/${enc(demoId)}/ingest/stream`)
  bindAgentStream(es, handlers)
  return es
}

export function openDemoMissionStream(
  demoId: string,
  handlers: SSEHandlers,
): EventSource {
  const es = new EventSource(`${BASE}/demo/${enc(demoId)}/mission/stream`)
  bindAgentStream(es, handlers)
  return es
}

/* ---------------- DeepLogic Studio (v3) ---------------- */

export type StudioVisibility = 'private' | 'org' | 'published'

export interface StudioProjectListItem {
  id: string
  name: string
  slug: string
  visibility: StudioVisibility
  ownerId: string
  ownerEmail?: string | null
  isOwner: boolean
  html: string
  updatedAt: string
}

export interface StudioMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  ts: string
}

export interface StudioVersion {
  html: string
  prompt: string
  ts: string
}

export type AiProvider = 'anthropic' | 'openai' | 'openrouter'

export interface AiProviderState {
  id: AiProvider
  model: string
  hasKey: boolean
}
export interface AiSettings {
  active: AiProvider
  providers: AiProviderState[]
  envKey: boolean
  canEdit: boolean
}
export interface AiKeyTestResult {
  id: AiProvider
  hasKey: boolean
  ok: boolean
  error?: string
}

// GET /api/orgs/:orgId/studio/ai-settings
export function getAiSettings(token: string, orgId: string): Promise<AiSettings> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/studio/ai-settings`)
}

// PUT /api/orgs/:orgId/studio/ai-settings { active?, entries?:[{provider,model?,apiKey?}] }
export function saveAiSettings(
  token: string,
  orgId: string,
  body: {
    active?: AiProvider
    entries?: { provider: AiProvider; model?: string; apiKey?: string }[]
  },
): Promise<AiSettings> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/studio/ai-settings`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

// POST /api/orgs/:orgId/studio/ai-settings/test -> tests all saved keys
export function testAiSettings(
  token: string,
  orgId: string,
): Promise<AiKeyTestResult[]> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/studio/ai-settings/test`, {
    method: 'POST',
  })
}

// Workspace Vault aggregation (all connectors + documents feeding reports)
export interface VaultConnector {
  id: string
  name: string
  kind: string
  sourceType: 'model' | 'report' | 'library'
  sourceName: string
  ownerEmail: string | null
}
export interface VaultDocument {
  id: string
  name: string
  kind: string
  sourceType: 'report' | 'library'
  sourceName: string
  scope: string | null
  ownerEmail: string | null
}

// GET /api/orgs/:orgId/vault
export function getOrgVault(
  token: string,
  orgId: string,
): Promise<{ connectors: VaultConnector[]; documents: VaultDocument[] }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/vault`)
}

export type VaultKind = 'file' | 'mcp' | 'api' | 'note'

export interface VaultItem {
  id: string
  kind: VaultKind
  name: string
  content: string
  meta: Record<string, unknown>
  ts: string
}

export interface StudioProject {
  id: string
  name: string
  slug: string
  visibility: StudioVisibility
  ownerId: string
  ownerEmail?: string | null
  isOwner: boolean
  html: string
  modelId: string | null
  messages: StudioMessage[]
  versions: StudioVersion[]
  vault: VaultItem[]
  updatedAt: string
}

export type ContextScope = 'user' | 'org'
export type ContextKind = 'doc' | 'html' | 'mcp' | 'note'

export interface ContextItem {
  id: string
  scope: ContextScope
  kind: ContextKind
  name: string
  content: string
  meta: Record<string, unknown>
  enabled: boolean
  isOwner: boolean
}

// GET /api/orgs/:orgId/studio/projects
export function listStudioProjects(
  token: string,
  orgId: string,
): Promise<StudioProjectListItem[]> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/studio/projects`)
}

// POST /api/orgs/:orgId/studio/projects { name, seedHtml?, modelId? }
export function createStudioProject(
  token: string,
  orgId: string,
  body: { name: string; seedHtml?: string; modelId?: string | null },
): Promise<StudioProject> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/studio/projects`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// GET /api/orgs/:orgId/studio/projects/:id
export function getStudioProject(
  token: string,
  orgId: string,
  projectId: string,
): Promise<StudioProject> {
  return jsonFetch(
    token,
    `/orgs/${enc(orgId)}/studio/projects/${enc(projectId)}`,
  )
}

// PATCH /api/orgs/:orgId/studio/projects/:id { name?, visibility?, html?, modelId? }
export function updateStudioProject(
  token: string,
  orgId: string,
  projectId: string,
  patch: {
    name?: string
    visibility?: StudioVisibility
    html?: string
    modelId?: string | null
  },
): Promise<StudioProject> {
  return jsonFetch(
    token,
    `/orgs/${enc(orgId)}/studio/projects/${enc(projectId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  )
}

// DELETE /api/orgs/:orgId/studio/projects/:id
export function deleteStudioProject(
  token: string,
  orgId: string,
  projectId: string,
): Promise<void> {
  return jsonFetch(
    token,
    `/orgs/${enc(orgId)}/studio/projects/${enc(projectId)}`,
    { method: 'DELETE' },
  )
}

// POST /api/orgs/:orgId/studio/projects/:id/vault { kind, name, content?, meta? }
export function addVaultItem(
  token: string,
  orgId: string,
  projectId: string,
  item: { kind: VaultKind; name: string; content?: string; meta?: Record<string, unknown> },
): Promise<StudioProject> {
  return jsonFetch(
    token,
    `/orgs/${enc(orgId)}/studio/projects/${enc(projectId)}/vault`,
    { method: 'POST', body: JSON.stringify(item) },
  )
}

// DELETE /api/orgs/:orgId/studio/projects/:id/vault/:itemId
export function removeVaultItem(
  token: string,
  orgId: string,
  projectId: string,
  itemId: string,
): Promise<StudioProject> {
  return jsonFetch(
    token,
    `/orgs/${enc(orgId)}/studio/projects/${enc(projectId)}/vault/${enc(itemId)}`,
    { method: 'DELETE' },
  )
}

// POST /api/orgs/:orgId/studio/projects/:id/import-pbix (multipart 'file')
// Parses a Power BI report -> connectors/visuals/measures into the vault + scaffold.
export function importPbix(
  token: string,
  orgId: string,
  projectId: string,
  file: File,
): Promise<StudioProject> {
  const form = new FormData()
  form.append('file', file)
  return fetch(
    `${BASE}/orgs/${enc(orgId)}/studio/projects/${enc(projectId)}/import-pbix`,
    { method: 'POST', headers: authHeaders(token), body: form },
  ).then(async (res) => {
    if (!res.ok) throw new Error(await errorDetail(res))
    return (await res.json()) as StudioProject
  })
}

// A file attached to a single prompt (transient, multimodal).
export interface PromptAttachment {
  kind: 'image' | 'pdf' | 'text'
  name: string
  mediaType?: string
  dataBase64?: string
  text?: string
}

// POST /api/orgs/:orgId/studio/projects/:id/generate { prompt, attachments? }
export function generateStudioReport(
  token: string,
  orgId: string,
  projectId: string,
  prompt: string,
  attachments?: PromptAttachment[],
): Promise<{
  html: string
  message: StudioMessage
  usedAI: boolean
  aiError?: string | null
}> {
  return jsonFetch(
    token,
    `/orgs/${enc(orgId)}/studio/projects/${enc(projectId)}/generate`,
    {
      method: 'POST',
      body: JSON.stringify({ prompt, attachments: attachments ?? [] }),
    },
  )
}

// GET /api/orgs/:orgId/studio/projects/:id/compiled-context
export function getCompiledContext(
  token: string,
  orgId: string,
  projectId: string,
): Promise<{ markdown: string }> {
  return jsonFetch(
    token,
    `/orgs/${enc(orgId)}/studio/projects/${enc(projectId)}/compiled-context`,
  )
}

// GET /api/orgs/:orgId/studio/context
export function listContext(
  token: string,
  orgId: string,
): Promise<ContextItem[]> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/studio/context`)
}

// POST /api/orgs/:orgId/studio/context { kind, name, content?, meta?, scope? }
export function createContext(
  token: string,
  orgId: string,
  body: {
    kind: ContextKind
    name: string
    content?: string
    meta?: Record<string, unknown>
    scope?: ContextScope
  },
): Promise<ContextItem> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/studio/context`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// PATCH /api/orgs/:orgId/studio/context/:id { enabled?, name?, content?, scope?, meta? }
export function updateContext(
  token: string,
  orgId: string,
  id: string,
  patch: {
    enabled?: boolean
    name?: string
    content?: string
    scope?: ContextScope
    meta?: Record<string, unknown>
  },
): Promise<ContextItem> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/studio/context/${enc(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

// DELETE /api/orgs/:orgId/studio/context/:id
export function deleteContext(
  token: string,
  orgId: string,
  id: string,
): Promise<void> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/studio/context/${enc(id)}`, {
    method: 'DELETE',
  })
}

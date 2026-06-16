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

// PATCH /api/orgs/:orgId { name } -> rename workspace
export function updateOrg(
  token: string,
  orgId: string,
  body: { name: string },
): Promise<{ id: string; name: string; slug: string }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
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

// POST /api/orgs/:orgId/members { email, role }
// Returns { type: 'member', ...Member } or { type: 'invitation', email, role, expiresAt }
export function inviteMember(
  token: string,
  orgId: string,
  email: string,
  role: OrgRole,
): Promise<{ type: 'member' | 'invitation'; email?: string; role: OrgRole; expiresAt?: string } & Partial<Member>> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  })
}

/** @deprecated use inviteMember */
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

/* ---------------- invitations ---------------- */

export interface Invitation {
  id: string
  orgId: string
  email: string
  role: OrgRole
  invitedBy: string | null
  token: string
  acceptedAt: string | null
  expiresAt: string
  createdAt: string
}

// GET /api/orgs/:orgId/invitations
export function listInvitations(token: string, orgId: string): Promise<Invitation[]> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/invitations`)
}

// DELETE /api/orgs/:orgId/invitations/:id
export function cancelInvitation(token: string, orgId: string, invId: string): Promise<void> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/invitations/${enc(invId)}`, { method: 'DELETE' })
}

// GET /api/invite/:token (public — no auth)
export async function verifyInviteToken(token: string): Promise<{
  orgId: string; orgName: string; email: string; role: string; expiresAt: string
}> {
  const res = await fetch(`/api/invite/${enc(token)}`)
  if (!res.ok) throw new Error(await errorDetail(res))
  return res.json()
}

// POST /api/invite/:token/accept (auth required)
export function acceptInviteToken(
  accessToken: string,
  inviteToken: string,
): Promise<{ orgId: string; role: string }> {
  return jsonFetch(accessToken, `/invite/${enc(inviteToken)}/accept`, { method: 'POST' })
}

/* ---------------- billing ---------------- */

export interface BillingSubscription {
  plan: 'free' | 'team' | 'business' | 'enterprise'
  status: 'trialing' | 'active' | 'past_due' | 'canceled'
  inTrial: boolean
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  seatCount: number
  tokensUsed: number
  limits: {
    members: number | null
    reports: number | null
    tokensPerMonth: number | null
    byok: boolean
    mcp: boolean
    auditLog: boolean
  }
  hasStripe: boolean
}

// GET /api/orgs/:orgId/billing/subscription
export function getBillingSubscription(
  token: string,
  orgId: string,
): Promise<BillingSubscription> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/billing/subscription`)
}

// POST /api/orgs/:orgId/billing/checkout { plan, seats? }
export function createCheckoutSession(
  token: string,
  orgId: string,
  plan: 'team' | 'business',
  seats?: number,
): Promise<{ url: string }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/billing/checkout`, {
    method: 'POST',
    body: JSON.stringify({ plan, seats }),
  })
}

// POST /api/orgs/:orgId/billing/portal
export function createPortalSession(
  token: string,
  orgId: string,
): Promise<{ url: string }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/billing/portal`, { method: 'POST' })
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

/* ---------------- E2B sandbox preview ---------------- */

export interface SandboxInfo {
  sandboxId: string
  previewUrl: string
}

// POST /api/orgs/:orgId/studio/sandbox { html } -> { sandboxId, previewUrl }
export function createSandbox(token: string, orgId: string, html: string): Promise<SandboxInfo> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/studio/sandbox`, {
    method: 'POST',
    body: JSON.stringify({ html }),
  })
}

// PATCH /api/orgs/:orgId/studio/sandbox/:sandboxId { html } -> { ok } | 410 expired
export function updateSandbox(
  token: string,
  orgId: string,
  sandboxId: string,
  html: string,
): Promise<{ ok: boolean }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/studio/sandbox/${enc(sandboxId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ html }),
  })
}

// DELETE /api/orgs/:orgId/studio/sandbox/:sandboxId -> 204
export function killSandbox(token: string, orgId: string, sandboxId: string): Promise<void> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/studio/sandbox/${enc(sandboxId)}`, {
    method: 'DELETE',
  })
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
  deleteRef: string
  ownerEmail: string | null
  url?: string | null
  meta?: Record<string, string>
}
export interface VaultDocument {
  id: string
  name: string
  kind: string
  sourceType: 'report' | 'library'
  sourceName: string
  scope: string | null
  deleteRef: string
  ownerEmail: string | null
}

// GET /api/orgs/:orgId/vault
export function getOrgVault(
  token: string,
  orgId: string,
): Promise<{ connectors: VaultConnector[]; documents: VaultDocument[] }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/vault`)
}

// GET /api/orgs/:orgId/vault/doc/content?ref=...
export function getVaultDocContent(
  token: string,
  orgId: string,
  deleteRef: string,
): Promise<{ name: string; kind: string; content: string }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/vault/doc/content?ref=${enc(deleteRef)}`)
}

// DELETE /api/orgs/:orgId/vault  { deleteRef }
export function deleteVaultEntry(
  token: string,
  orgId: string,
  deleteRef: string,
): Promise<{ ok: boolean }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/vault`, {
    method: 'DELETE',
    body: JSON.stringify({ deleteRef }),
  })
}

// POST /api/orgs/:orgId/vault/test
export function testConnectorUrl(
  token: string,
  orgId: string,
  url: string,
): Promise<{ ok: boolean; status?: number; statusText?: string; error?: string }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/vault/test`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
}

// GET /api/orgs/:orgId/vault/test-stream?url=... — streams SSE diagnostic events
export async function* streamConnectorTest(
  token: string,
  orgId: string,
  url: string,
  signal?: AbortSignal,
): AsyncGenerator<{ msg: string; ok?: boolean; done?: boolean }> {
  const res = await fetch(
    `${BASE}/orgs/${enc(orgId)}/vault/test-stream?url=${encodeURIComponent(url)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal },
  )
  if (!res.ok || !res.body) {
    yield { msg: `Server error: ${res.status}`, ok: false, done: true }
    return
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try { yield JSON.parse(line.slice(6)) as { msg: string; ok?: boolean; done?: boolean } }
        catch { /* ignore malformed */ }
      }
    }
  }
}

// PATCH /api/orgs/:orgId/vault/ctx/:ctxId
export function updateVaultMcp(
  token: string,
  orgId: string,
  ctxId: string,
  patch: { name?: string; meta?: Record<string, string> },
): Promise<{ ok: boolean }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/vault/ctx/${enc(ctxId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

// PATCH /api/orgs/:orgId/studio/projects/:projectId/vault/:itemId
export function updateVaultProj(
  token: string,
  orgId: string,
  projectId: string,
  itemId: string,
  patch: { name?: string; meta?: Record<string, string>; enabled?: boolean },
): Promise<{ ok: boolean }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/studio/projects/${enc(projectId)}/vault/${enc(itemId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.meta ? { meta: patch.meta } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    }),
  })
}

// PATCH /api/orgs/:orgId/vault/model-connector
export function updateVaultModelConnector(
  token: string,
  orgId: string,
  body: { modelId: string; connectorKind: string; meta: Record<string, string> },
): Promise<{ ok: boolean }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/vault/model-connector`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export type VaultKind = 'file' | 'mcp' | 'api' | 'note'

export interface VaultItem {
  id: string
  kind: VaultKind
  name: string
  content: string
  meta: Record<string, unknown>
  enabled: boolean
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
export type ContextKind = 'doc' | 'html' | 'mcp' | 'note' | 'image'

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

// POST /api/orgs/:orgId/studio/context/summarize { filename, content } -> { description }
export function summarizeDocument(
  token: string,
  orgId: string,
  filename: string,
  content: string,
): Promise<{ description: string }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/studio/context/summarize`, {
    method: 'POST',
    body: JSON.stringify({ filename, content }),
  })
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

/* ---------------- Super-admin API ---------------- */

export interface AdminStats {
  totalOrgs: number
  totalUsers: number
  planBreakdown: Record<string, number>
  trialOrgs: number
  pastDueOrgs: number
  estimatedMrr: number
  newOrgsThisMonth: number
  tokensBilledThisMonth: number
}

export interface AdminOrg {
  id: string
  name: string
  slug: string
  plan: string
  status: string
  inTrial: boolean
  memberCount: number
  seatCount: number
  createdAt: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  stripeCustomerId: string | null
}

export interface AdminOrgMember {
  userId: string
  email: string
  role: string
  joinedAt: string
}

export interface AdminOrgDetail {
  org: { id: string; name: string; slug: string; created_at: string }
  subscription: Record<string, unknown> | null
  members: AdminOrgMember[]
  tokensThisMonth: number
  invitations: unknown[]
}

export interface AdminUser {
  id: string
  email: string
  createdAt: string
  orgs: { orgId: string; orgName: string; orgSlug: string; role: string }[]
}

// GET /api/admin/me
export function adminMe(token: string): Promise<{ isAdmin: boolean; email: string }> {
  return jsonFetch(token, '/admin/me')
}

// GET /api/admin/stats
export function adminStats(token: string): Promise<AdminStats> {
  return jsonFetch(token, '/admin/stats')
}

// GET /api/admin/orgs
export function adminListOrgs(
  token: string,
  params?: { page?: number; limit?: number; search?: string; plan?: string; status?: string },
): Promise<{ orgs: AdminOrg[]; total: number }> {
  const q = new URLSearchParams()
  if (params?.page)   q.set('page',   String(params.page))
  if (params?.limit)  q.set('limit',  String(params.limit))
  if (params?.search) q.set('search', params.search)
  if (params?.plan)   q.set('plan',   params.plan)
  if (params?.status) q.set('status', params.status)
  const qs = q.toString() ? `?${q}` : ''
  return jsonFetch(token, `/admin/orgs${qs}`)
}

// GET /api/admin/orgs/:orgId
export function adminGetOrg(token: string, orgId: string): Promise<AdminOrgDetail> {
  return jsonFetch(token, `/admin/orgs/${enc(orgId)}`)
}

// PATCH /api/admin/orgs/:orgId/subscription
export function adminPatchSubscription(
  token: string,
  orgId: string,
  patch: { plan?: string; status?: string; trialEndsAt?: string | null },
): Promise<Record<string, unknown>> {
  return jsonFetch(token, `/admin/orgs/${enc(orgId)}/subscription`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

// DELETE /api/admin/orgs/:orgId/members/:userId
export function adminRemoveMember(token: string, orgId: string, userId: string): Promise<void> {
  return jsonFetch(token, `/admin/orgs/${enc(orgId)}/members/${enc(userId)}`, { method: 'DELETE' })
}

// GET /api/admin/users
export function adminListUsers(
  token: string,
  params?: { page?: number; limit?: number; search?: string },
): Promise<{ users: AdminUser[]; total: number }> {
  const q = new URLSearchParams()
  if (params?.page)   q.set('page',   String(params.page))
  if (params?.limit)  q.set('limit',  String(params.limit))
  if (params?.search) q.set('search', params.search)
  const qs = q.toString() ? `?${q}` : ''
  return jsonFetch(token, `/admin/users${qs}`)
}

// POST /api/admin/restart
export function adminRestart(token: string): Promise<{ ok: boolean; message: string }> {
  return jsonFetch(token, '/admin/restart', { method: 'POST' })
}

/* ---------------- dashboards + widgets ---------------- */

export type WidgetType = 'kpi' | 'chart' | 'table' | 'insight' | 'alert' | 'embed' | 'news'
export type DashboardVisibility = 'private' | 'org' | 'published'

export interface WidgetSource {
  type: 'library' | 'model'
  ref: string
  name: string
}

export interface AlertRule {
  metric: string
  operator: '>' | '<' | '>=' | '<=' | '='
  threshold: number
  channel?: string
}

export interface Widget {
  id: string
  dashboardId: string | null
  ownerId: string
  isOwner?: boolean
  name: string
  type: WidgetType
  html: string | null
  prompt: string | null
  gridX: number
  gridY: number
  gridW: number
  gridH: number
  sources: WidgetSource[]
  alertRule: AlertRule | null
  alertStatus: 'ok' | 'fired' | null
  lastRefreshed: string | null
  createdAt: string
  updatedAt: string
}

export interface DashboardListItem {
  id: string
  name: string
  slug: string
  visibility: DashboardVisibility
  description: string | null
  ownerId: string
  isOwner: boolean
  widgetCount: number
  createdAt: string
  updatedAt: string
}

export interface Dashboard extends DashboardListItem {
  widgets: Widget[]
}

// GET /api/orgs/:orgId/dashboards
export function listDashboards(token: string, orgId: string): Promise<DashboardListItem[]> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/dashboards`)
}

// POST /api/orgs/:orgId/dashboards
export function createDashboard(
  token: string,
  orgId: string,
  body: { name: string; description?: string },
): Promise<DashboardListItem> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/dashboards`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// GET /api/orgs/:orgId/dashboards/:id
export function getDashboard(token: string, orgId: string, id: string): Promise<Dashboard> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/dashboards/${enc(id)}`)
}

// PATCH /api/orgs/:orgId/dashboards/:id
export function updateDashboard(
  token: string,
  orgId: string,
  id: string,
  patch: { name?: string; visibility?: DashboardVisibility; description?: string },
): Promise<{ ok: boolean }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/dashboards/${enc(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

// DELETE /api/orgs/:orgId/dashboards/:id
export function deleteDashboard(token: string, orgId: string, id: string): Promise<void> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/dashboards/${enc(id)}`, { method: 'DELETE' })
}

// POST /api/orgs/:orgId/dashboards/:id/widgets
export function createWidget(
  token: string,
  orgId: string,
  dashboardId: string,
  body: {
    name: string
    type?: WidgetType
    html?: string
    prompt?: string
    sources?: WidgetSource[]
    gridX?: number
    gridY?: number
    gridW?: number
    gridH?: number
    alertRule?: AlertRule | null
  },
): Promise<Widget> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/dashboards/${enc(dashboardId)}/widgets`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// PATCH /api/orgs/:orgId/dashboards/:id/widgets/:wid
export function updateWidget(
  token: string,
  orgId: string,
  dashboardId: string,
  widgetId: string,
  patch: {
    name?: string
    prompt?: string
    gridX?: number
    gridY?: number
    gridW?: number
    gridH?: number
    sources?: WidgetSource[]
    alertRule?: AlertRule | null
  },
): Promise<Widget> {
  return jsonFetch(
    token,
    `/orgs/${enc(orgId)}/dashboards/${enc(dashboardId)}/widgets/${enc(widgetId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
}

// DELETE /api/orgs/:orgId/dashboards/:id/widgets/:wid
export function deleteWidget(
  token: string,
  orgId: string,
  dashboardId: string,
  widgetId: string,
): Promise<void> {
  return jsonFetch(
    token,
    `/orgs/${enc(orgId)}/dashboards/${enc(dashboardId)}/widgets/${enc(widgetId)}`,
    { method: 'DELETE' },
  )
}

// --------------- org-level widget endpoints (standalone widget flow) --------

// GET /api/orgs/:orgId/widgets/:wid
export function getOrgWidget(token: string, orgId: string, widgetId: string): Promise<Widget> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/widgets/${enc(widgetId)}`)
}

// PATCH /api/orgs/:orgId/widgets/:wid
export function updateOrgWidget(
  token: string,
  orgId: string,
  widgetId: string,
  patch: { name?: string; prompt?: string; gridW?: number; gridH?: number; sources?: WidgetSource[] },
): Promise<Widget> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/widgets/${enc(widgetId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

// GET /api/orgs/:orgId/widgets
export function listOrgWidgets(token: string, orgId: string): Promise<Widget[]> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/widgets`)
}

// DELETE /api/orgs/:orgId/widgets/:wid — permanently deletes the widget
export function deleteOrgWidget(token: string, orgId: string, widgetId: string): Promise<void> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/widgets/${enc(widgetId)}`, { method: 'DELETE' })
}

// POST /api/orgs/:orgId/widgets/:wid/generate
export function generateOrgWidget(
  token: string,
  orgId: string,
  widgetId: string,
  prompt?: string,
  history?: StudioMessage[],
  currentHtml?: string,
): Promise<{ widget: Widget; usedAI: boolean }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/widgets/${enc(widgetId)}/generate`, {
    method: 'POST',
    body: JSON.stringify({ prompt, history, currentHtml }),
  })
}

// ---------------------------------------------------------------------------

// GET /api/orgs/:orgId/dashboards/:id/widgets/:wid
export function getWidget(
  token: string,
  orgId: string,
  dashboardId: string,
  widgetId: string,
): Promise<Widget> {
  return jsonFetch(
    token,
    `/orgs/${enc(orgId)}/dashboards/${enc(dashboardId)}/widgets/${enc(widgetId)}`,
  )
}

// POST /api/orgs/:orgId/dashboards/:id/widgets/:wid/generate
export function generateWidget(
  token: string,
  orgId: string,
  dashboardId: string,
  widgetId: string,
  prompt?: string,
): Promise<{ widget: Widget; usedAI: boolean }> {
  return jsonFetch(
    token,
    `/orgs/${enc(orgId)}/dashboards/${enc(dashboardId)}/widgets/${enc(widgetId)}/generate`,
    { method: 'POST', body: prompt ? JSON.stringify({ prompt }) : undefined },
  )
}

/* ---------------- agents ---------------- */

export interface Agent {
  id: string
  orgId: string
  name: string
  description: string
  model: string
  systemPrompt: string
  schedule: string | null
  lastRunAt: string | null
  isOwner: boolean
  createdAt: string
  updatedAt: string
}

export function listAgents(token: string, orgId: string): Promise<Agent[]> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/agents`)
}

export function createAgent(
  token: string,
  orgId: string,
  body: { name: string; description?: string; model?: string; systemPrompt?: string; schedule?: string | null },
): Promise<Agent> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/agents`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateAgent(
  token: string,
  orgId: string,
  agentId: string,
  body: Partial<{ name: string; description: string; model: string; systemPrompt: string; schedule: string | null }>,
): Promise<Agent> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/agents/${enc(agentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteAgent(token: string, orgId: string, agentId: string): Promise<void> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/agents/${enc(agentId)}`, { method: 'DELETE' })
}

/* ---------------- alerts ---------------- */

export interface Alert {
  id: string
  orgId: string
  name: string
  condition: string
  sources: WidgetSource[]
  notifyEmail: string | null
  status: 'active' | 'paused'
  lastChecked: string | null
  lastFired: string | null
  fireCount: number
  createdAt: string
  updatedAt: string
}

export interface AlertEvent {
  id: string
  alertId: string
  firedAt: string
  summary: string | null
}

export function listAlerts(token: string, orgId: string): Promise<Alert[]> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/alerts`)
}

export function createAlert(
  token: string,
  orgId: string,
  body: { name: string; condition: string; sources?: WidgetSource[]; notifyEmail?: string; status?: 'active' | 'paused' },
): Promise<Alert> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/alerts`, { method: 'POST', body: JSON.stringify(body) })
}

export function updateAlert(
  token: string,
  orgId: string,
  alertId: string,
  body: Partial<{ name: string; condition: string; sources: WidgetSource[]; notifyEmail: string; status: 'active' | 'paused' }>,
): Promise<Alert> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/alerts/${enc(alertId)}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deleteAlert(token: string, orgId: string, alertId: string): Promise<void> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/alerts/${enc(alertId)}`, { method: 'DELETE' })
}

export function checkAlert(token: string, orgId: string, alertId: string): Promise<{ fired: boolean; summary: string; checkedAt: string }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/alerts/${enc(alertId)}/check`, { method: 'POST' })
}

export function listAlertEvents(token: string, orgId: string, alertId: string): Promise<AlertEvent[]> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/alerts/${enc(alertId)}/events`)
}


// ---------------------------------------------------------------------------
// Web search
// ---------------------------------------------------------------------------

export interface SearchResult { title: string; url: string; snippet: string }

export function searchWeb(token: string, orgId: string, q: string, count = 5): Promise<{ results: SearchResult[] }> {
  return jsonFetch(token, `/orgs/${enc(orgId)}/search?q=${encodeURIComponent(q)}&count=${count}`)
}

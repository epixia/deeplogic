// DeepLogic Studio (PRD v3) — org-scoped report builder + context library.
// All routes under /api/orgs/:orgId/studio, protected by requireMember().
// CRUD runs under the caller's RLS client (req.db). Grounding models are loaded
// via repo.getModel(). Rows are mapped snake_case -> the api.ts camelCase shapes
// (isOwner = row.owner_id === req.user.id).
//
//   GET    projects                       GET    projects/:id
//   POST   projects {name,seedHtml?,modelId?}
//   PATCH  projects/:id {name?,visibility?,html?,modelId?}
//   DELETE projects/:id
//   POST   projects/:id/generate {prompt}
//   GET    projects/:id/compiled-context
//   GET    context                        POST   context {kind,name,content?,meta?,scope?}
//   PATCH  context/:id                    DELETE context/:id

import { Router, raw } from 'express';
import { randomUUID } from 'node:crypto';
import { provisionExternalAgent } from '../agents/provision.js';
import { beginRun, appendEvent, finishRun } from '../agents/runLog.js';
import { recallMemory, ingestEpisode } from '../memory/graph.js';
import type { Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireMember, requireRole, callerRole, checkReportLimit, checkTokenBudget, requireFeature } from '../auth.js';
import { logUsageEvent } from '../billing.js';
import { getModel } from '../repo.js';
import { serviceClient } from '../supabase.js';
import { compileContext } from '../studio/context.js';
import { ingest as ingestVaultItem } from '../studio/ingest.js';
import { captionImage, fetchSiteText, normalizeUrl } from '../studio/aiTeam.js';
import { analyzeUrl, parseLenses } from '../studio/urlAnalysis.js';
import { suggestIdeas, parseTarget, type VaultInventoryItem } from '../studio/suggestIdeas.js';
import { suggestCompetitors } from '../studio/suggestCompetitors.js';
import { loadPlatformApiCreds } from './integrations.js';
import { dataforseoDomainIntel, toDomain, type DomainIntel } from '../integrations/dataforseo.js';
import { runAssistant, runAgentTask, type ChatMsg, type WebResult } from '../studio/assistant.js';
import { generateTitle } from '../studio/titler.js';
import { webSearch, wikipediaSummary } from '../webSearch.js';

// Fallback title from content when AI is unavailable (first heading or line).
function heuristicTitle(content: string): string {
  const heading = content.split('\n').find((l) => /^#{1,6}\s/.test(l));
  let base = heading ? heading.replace(/^#{1,6}\s/, '') : (content.trim().split('\n')[0] || 'Note');
  base = base.replace(/^(here'?s|here is|sure[,!]?|below is|this is|the following)\b[:,]?\s*/i, '');
  return base.replace(/[*_`#[\]]/g, '').replace(/[:.;\s]+$/, '').trim().slice(0, 70) || 'Note';
}
import {
  retrieveRelevant,
  resolveEmbeddingKey,
  embedText,
  profileText,
  toVectorLiteral,
} from '../studio/embeddings.js';
import {
  generateReport,
  type AiConfig,
  type AiProvider,
  type PromptAttachment,
} from '../studio/generator.js';
import { parseMultipartFile, slugify as fileSlug, titleize } from '../ingestParse.js';
import {
  parsePbix,
  summaryToMarkdown,
  summaryToScaffold,
} from '../studio/pbix.js';
import type {
  ContextItem,
  StudioMessage,
  StudioProject,
  StudioVersion,
  VaultItem,
} from '../types.js';

export const studioRouter = Router();

// Public router (mounted before auth) for the anonymous onboarding analysis —
// a prospect can see DeepLogic learn their business BEFORE creating an account.
export const onboardingPublicRouter = Router();

const MAX_VERSIONS = 10;

// ---------------------------------------------------------------------------
// Row shapes + mappers
// ---------------------------------------------------------------------------

interface ProjectRow {
  id: string;
  org_id: string;
  owner_id: string;
  name: string;
  slug: string;
  visibility: StudioProject['visibility'];
  html: string;
  model_id: string | null;
  messages: StudioMessage[] | null;
  versions: StudioVersion[] | null;
  vault: VaultItem[] | null;
  dashboard_id: string | null;
  updated_at: string;
}

interface ProjectListRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  visibility: StudioProject['visibility'];
  html: string | null;
  dashboard_id: string | null;
  updated_at: string;
}

interface ContextRow {
  id: string;
  owner_id: string;
  scope: ContextItem['scope'];
  kind: ContextItem['kind'];
  name: string;
  content: string;
  meta: Record<string, unknown> | null;
  enabled: boolean;
}

function mapProject(row: ProjectRow, userId: string): StudioProject {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    visibility: row.visibility,
    ownerId: row.owner_id,
    isOwner: row.owner_id === userId,
    html: row.html ?? '',
    modelId: row.model_id ?? null,
    dashboardId: row.dashboard_id ?? null,
    messages: row.messages ?? [],
    versions: row.versions ?? [],
    vault: row.vault ?? [],
    updatedAt: row.updated_at,
  };
}

function mapContext(row: ContextRow, userId: string): ContextItem {
  return {
    id: row.id,
    scope: row.scope,
    kind: row.kind,
    name: row.name,
    content: row.content ?? '',
    meta: row.meta ?? {},
    enabled: row.enabled,
    isOwner: row.owner_id === userId,
  };
}

/** Resolve auth.users emails for a set of user ids (service role; small N). */
async function resolveEmails(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(userIds)].filter(Boolean);
  await Promise.all(
    unique.map(async (uid) => {
      try {
        const { data } = await serviceClient.auth.admin.getUserById(uid);
        if (data?.user?.email) map.set(uid, data.user.email);
      } catch {
        /* ignore — owner email is best-effort */
      }
    })
  );
  return map;
}

/** slug = kebab(name) + '-' + short random. */
function slugify(name: string): string {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'report';
  const rand = Math.random().toString(36).slice(2, 8);
  return `${base}-${rand}`;
}

const PROJECT_COLS =
  'id, org_id, owner_id, name, slug, visibility, html, model_id, dashboard_id, messages, versions, vault, updated_at';
const CONTEXT_COLS = 'id, owner_id, scope, kind, name, content, meta, enabled';

/** Load a single project row (RLS-scoped). Returns null if not visible/found. */
async function loadProject(
  db: SupabaseClient,
  orgId: string,
  id: string
): Promise<ProjectRow | null> {
  const { data, error } = await db
    .from('studio_projects')
    .select(PROJECT_COLS)
    .eq('org_id', orgId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ProjectRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

// GET projects
studioRouter.get(
  '/orgs/:orgId/studio/projects',
  requireMember(),
  async (req: Request, res: Response) => {
    try {
      const { data, error } = await req
        .db!.from('studio_projects')
        .select('id, owner_id, name, slug, visibility, html, dashboard_id, updated_at')
        .eq('org_id', req.params.orgId)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as ProjectListRow[];
      const emails = await resolveEmails(rows.map((r) => r.owner_id));
      res.json(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          visibility: r.visibility,
          ownerId: r.owner_id,
          ownerEmail: emails.get(r.owner_id) ?? null,
          isOwner: r.owner_id === req.user!.id,
          html: r.html ?? '',
          dashboardId: r.dashboard_id ?? null,
          updatedAt: r.updated_at,
        }))
      );
    } catch (err) {
      console.error('GET studio projects failed', err);
      res.status(500).json({ error: 'Failed to list projects' });
    }
  }
);

// POST projects {name, seedHtml?, modelId?}
studioRouter.post(
  '/orgs/:orgId/studio/projects',
  requireMember(),
  checkReportLimit(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const name = ((req.body && req.body.name) || '').toString().trim();
    if (!name) {
      res.status(400).json({ error: 'Report name is required' });
      return;
    }
    const seedHtml = req.body && req.body.seedHtml ? String(req.body.seedHtml) : '';
    const modelId =
      req.body && req.body.modelId ? String(req.body.modelId) : null;
    const dashboardId =
      req.body && req.body.dashboardId ? String(req.body.dashboardId) : null;
    try {
      const { data, error } = await req
        .db!.from('studio_projects')
        .insert({
          org_id: orgId,
          owner_id: req.user!.id,
          name,
          slug: slugify(name),
          html: seedHtml,
          model_id: modelId,
          dashboard_id: dashboardId,
          messages: [],
          versions: [],
        })
        .select(PROJECT_COLS)
        .single();
      if (error) throw new Error(error.message);
      res.status(201).json(mapProject(data as ProjectRow, req.user!.id));
    } catch (err) {
      console.error('POST studio project failed', err);
      res.status(500).json({ error: 'Failed to create project' });
    }
  }
);

// GET projects/:id
studioRouter.get(
  '/orgs/:orgId/studio/projects/:id',
  requireMember(),
  async (req: Request, res: Response) => {
    try {
      const row = await loadProject(req.db!, req.params.orgId, req.params.id);
      if (!row) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const mapped = mapProject(row, req.user!.id);
      const emails = await resolveEmails([row.owner_id]);
      mapped.ownerEmail = emails.get(row.owner_id);
      res.json(mapped);
    } catch (err) {
      console.error('GET studio project failed', err);
      res.status(500).json({ error: 'Failed to load project' });
    }
  }
);

// PATCH projects/:id {name?, visibility?, html?, modelId?}
studioRouter.patch(
  '/orgs/:orgId/studio/projects/:id',
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId, id } = req.params;
    const body = req.body || {};
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === 'string') patch.name = body.name.trim();
    if (typeof body.visibility === 'string') {
      if (!['private', 'org', 'published'].includes(body.visibility)) {
        res.status(400).json({ error: 'Invalid visibility' });
        return;
      }
      patch.visibility = body.visibility;
    }
    if (typeof body.html === 'string') patch.html = body.html;
    if ('modelId' in body) {
      patch.model_id = body.modelId ? String(body.modelId) : null;
    }
    try {
      const { data, error } = await req
        .db!.from('studio_projects')
        .update(patch)
        .eq('org_id', orgId)
        .eq('id', id)
        .select(PROJECT_COLS)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.json(mapProject(data as ProjectRow, req.user!.id));
    } catch (err) {
      console.error('PATCH studio project failed', err);
      res.status(500).json({ error: 'Failed to update project' });
    }
  }
);

// DELETE projects/:id
studioRouter.delete(
  '/orgs/:orgId/studio/projects/:id',
  requireMember(),
  async (req: Request, res: Response) => {
    try {
      const { error } = await req
        .db!.from('studio_projects')
        .delete()
        .eq('org_id', req.params.orgId)
        .eq('id', req.params.id);
      if (error) throw new Error(error.message);
      res.status(204).end();
    } catch (err) {
      console.error('DELETE studio project failed', err);
      res.status(500).json({ error: 'Failed to delete project' });
    }
  }
);

// ---------------------------------------------------------------------------
// Generate + compiled context
// ---------------------------------------------------------------------------

/** Load the enabled context items visible to the caller in this org. */
async function loadContextItems(
  db: SupabaseClient,
  orgId: string,
  userId: string
): Promise<ContextItem[]> {
  const { data, error } = await db
    .from('context_items')
    .select(CONTEXT_COLS)
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ContextRow[]).map((r) => mapContext(r, userId));
}

type ProviderEntry = { apiKey?: string; model?: string };
type ProviderMap = Partial<Record<AiProvider, ProviderEntry>>;

interface AiSettingsRow {
  provider: AiProvider; // active provider
  providers: ProviderMap | null;
  updated_at: string;
}

const ALL_PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'openrouter'];

async function loadAiRow(orgId: string): Promise<AiSettingsRow | null> {
  const { data } = await serviceClient
    .from('org_ai_settings')
    .select('provider, providers, updated_at')
    .eq('org_id', orgId)
    .maybeSingle();
  return (data as AiSettingsRow | null) ?? null;
}

/** Load the active workspace AI config via the SERVICE role (key stays server-side). */
export async function loadAiConfig(orgId: string): Promise<AiConfig | null> {
  const row = await loadAiRow(orgId);
  if (!row) return null;
  const active = row.provider || 'anthropic';
  const entry = (row.providers ?? {})[active];
  if (!entry?.apiKey) return null;
  return { provider: active, apiKey: entry.apiKey, model: entry.model || undefined };
}

/**
 * Platform-level AI config from a server env key — for flows with NO org context
 * (e.g. anonymous onboarding). Prefers Anthropic, then OpenAI, then OpenRouter.
 * Returns null if no key is set (callers degrade gracefully).
 */
export function serverFallbackAi(): AiConfig | null {
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, model: 'claude-opus-4-8' };
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4o' };
  if (process.env.OPENROUTER_API_KEY) return { provider: 'openrouter', apiKey: process.env.OPENROUTER_API_KEY, model: 'openai/gpt-4o' };
  return null;
}

/** Public (no-secret) view of the settings for the client. */
function aiSettingsView(row: AiSettingsRow | null, canEdit: boolean) {
  const providers = row?.providers ?? {};
  return {
    active: row?.provider ?? 'anthropic',
    providers: ALL_PROVIDERS.map((id) => ({
      id,
      model: providers[id]?.model ?? '',
      hasKey: !!providers[id]?.apiKey,
    })),
    envKey: !!process.env.ANTHROPIC_API_KEY,
    canEdit,
  };
}

/** Validate a provider key with a cheap, no-inference request. */
async function testProviderKey(
  provider: AiProvider,
  apiKey: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    let res: globalThis.Response;
    if (provider === 'anthropic') {
      res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      });
    } else if (provider === 'openai') {
      res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } else {
      res = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    }
    if (res.ok) return { ok: true };
    return { ok: false, error: `${res.status} ${res.statusText}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'request failed' };
  }
}

// POST projects/:id/generate {prompt}
studioRouter.post(
  '/orgs/:orgId/studio/projects/:id/generate',
  requireMember(),
  checkTokenBudget(),
  async (req: Request, res: Response) => {
    const { orgId, id } = req.params;
    const prompt = ((req.body && req.body.prompt) || '').toString();
    if (!prompt.trim()) {
      res.status(400).json({ error: 'A prompt is required' });
      return;
    }
    // Transient per-prompt attachments (images/PDF/text). Cap count + size.
    const rawAtts = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    const attachments: PromptAttachment[] = [];
    for (const a of rawAtts.slice(0, 6)) {
      const kind = (a?.kind || '').toString();
      const name = (a?.name || 'attachment').toString();
      if (!['image', 'pdf', 'text'].includes(kind)) continue;
      if (kind === 'text') {
        attachments.push({ kind: 'text', name, text: String(a.text ?? '').slice(0, 60000) });
      } else if (typeof a.dataBase64 === 'string' && a.dataBase64.length < 14_000_000) {
        attachments.push({
          kind: kind as 'image' | 'pdf',
          name,
          mediaType: typeof a.mediaType === 'string' ? a.mediaType : undefined,
          dataBase64: a.dataBase64,
        });
      }
    }
    try {
      const project = await loadProject(req.db!, orgId, id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const items = await loadContextItems(req.db!, orgId, req.user!.id);
      const model = project.model_id
        ? await getModel(req.db!, orgId, project.model_id).catch(() => null)
        : null;
      const ai = await loadAiConfig(orgId).catch(() => null);

      // Auto-grounding: for large libraries, narrow the textual context to the
      // items most relevant to this prompt (images are always kept — they're
      // attachments). Small libraries pass through unchanged.
      const RETRIEVAL_THRESHOLD = 12;
      let contextItems = items;
      if (items.length > RETRIEVAL_THRESHOLD && prompt.trim()) {
        try {
          const relevant = await retrieveRelevant(
            req.db!, orgId, prompt, 10, resolveEmbeddingKey(ai)
          );
          const keep = new Set(relevant.map((r) => r.id));
          contextItems = items.filter((i) => keep.has(i.id) || i.kind === 'image');
        } catch (e) {
          console.warn('retrieval failed; using full context', e);
        }
      }

      const context = await compileContext(contextItems, model, project.vault ?? []);
      const history = project.messages ?? [];

      // Extract image items from the context library and prepend as attachments.
      // Cap at 2MB base64 per image (~1.5MB file) — client already resizes on upload.
      const libraryImageAtts: PromptAttachment[] = items
        .filter((i) => i.kind === 'image' && i.enabled && i.content && i.content.length < 2_000_000)
        .map((i) => {
          const commaIdx = i.content!.indexOf(',');
          const header = commaIdx > -1 ? i.content!.slice(0, commaIdx) : '';
          const data = commaIdx > -1 ? i.content!.slice(commaIdx + 1) : i.content!;
          const mediaType = header.replace('data:', '').replace(';base64', '') || 'image/png';
          return { kind: 'image' as const, name: i.name, mediaType, dataBase64: data };
        });

      const { html, usedAI, aiError, tokensUsed } = await generateReport({
        prompt,
        currentHtml: project.html ?? '',
        context,
        modelData: model,
        history,
        ai,
        attachments: [...libraryImageAtts, ...attachments],
      });

      // Fire-and-forget usage metering.
      logUsageEvent(
        serviceClient,
        orgId,
        req.user?.id,
        usedAI ? 'ai_generation' : 'template_generation',
        tokensUsed ?? 0,
        ai?.provider ?? undefined,
        id
      ).catch((e) => console.error('usage log failed', e));

      const now = new Date().toISOString();
      const attNote = attachments.length
        ? `\n\n📎 ${attachments.map((a) => a.name).join(', ')}`
        : '';
      const userMessage: StudioMessage = { role: 'user', content: prompt + attNote, ts: now };
      const isFirstBuild = !project.html;
      const assistantMessage: StudioMessage = {
        role: 'assistant',
        content: usedAI
          ? isFirstBuild
            ? `Done. Take a look at the preview and tell me what to change.`
            : `Updated. Let me know what else to tweak.`
          : aiError
            ? `AI provider error: ${aiError}. Fell back to a template. Check your key under [Settings -> AI providers](/app/${orgId}/settings).`
            : `Built a template (no AI key set). Add a key under [Settings -> AI providers](/app/${orgId}/settings) to unlock real AI generation.`,
        ts: now,
      };
      const messages: StudioMessage[] = [...history, userMessage, assistantMessage];

      const version: StudioVersion = { html, prompt, ts: now };
      const versions: StudioVersion[] = [...(project.versions ?? []), version].slice(
        -MAX_VERSIONS
      );

      const { error } = await req
        .db!.from('studio_projects')
        .update({ html, messages, versions, updated_at: now })
        .eq('org_id', orgId)
        .eq('id', id);
      if (error) throw new Error(error.message);

      res.json({ html, message: assistantMessage, usedAI, aiError: aiError ?? null });
    } catch (err) {
      console.error('POST studio generate failed', err);
      res.status(500).json({ error: 'Failed to generate report' });
    }
  }
);

// GET projects/:id/compiled-context -> { markdown }
studioRouter.get(
  '/orgs/:orgId/studio/projects/:id/compiled-context',
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId, id } = req.params;
    try {
      const project = await loadProject(req.db!, orgId, id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const items = await loadContextItems(req.db!, orgId, req.user!.id);
      const model = project.model_id
        ? await getModel(req.db!, orgId, project.model_id).catch(() => null)
        : null;
      const markdown = await compileContext(items, model, project.vault ?? []);
      res.json({ markdown });
    } catch (err) {
      console.error('GET studio compiled-context failed', err);
      res.status(500).json({ error: 'Failed to compile context' });
    }
  }
);

// ---------------------------------------------------------------------------
// Per-report Data Vault (files / MCP / APIs / notes attached to one report)
// ---------------------------------------------------------------------------

const VAULT_KINDS = ['file', 'mcp', 'api', 'note'];
const MAX_VAULT_ITEMS = 40;
const MAX_VAULT_CONTENT = 60000;

// POST projects/:id/vault {kind, name, content?, meta?}
studioRouter.post(
  '/orgs/:orgId/studio/projects/:id/vault',
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId, id } = req.params;
    const body = req.body || {};
    const kind = (body.kind || '').toString();
    const name = (body.name || '').toString().trim();
    if (!VAULT_KINDS.includes(kind)) {
      res.status(400).json({ error: 'Invalid vault kind (file | mcp | api | note)' });
      return;
    }
    if (!name) {
      res.status(400).json({ error: 'A name is required' });
      return;
    }
    try {
      const project = await loadProject(req.db!, orgId, id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const item: VaultItem = {
        id: randomUUID(),
        kind: kind as VaultItem['kind'],
        name,
        content:
          typeof body.content === 'string'
            ? body.content.slice(0, MAX_VAULT_CONTENT)
            : '',
        meta: body.meta && typeof body.meta === 'object' ? body.meta : {},
        enabled: true,
        ts: new Date().toISOString(),
      };
      const vault = [...(project.vault ?? []), item].slice(-MAX_VAULT_ITEMS);
      const { data, error } = await req
        .db!.from('studio_projects')
        .update({ vault, updated_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('id', id)
        .select(PROJECT_COLS)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.status(201).json(mapProject(data as ProjectRow, req.user!.id));
    } catch (err) {
      console.error('POST studio vault failed', err);
      res.status(500).json({ error: 'Failed to add to the report vault' });
    }
  }
);

// DELETE projects/:id/vault/:itemId
studioRouter.delete(
  '/orgs/:orgId/studio/projects/:id/vault/:itemId',
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId, id, itemId } = req.params;
    try {
      const project = await loadProject(req.db!, orgId, id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const vault = (project.vault ?? []).filter((v) => v.id !== itemId);
      const { data, error } = await req
        .db!.from('studio_projects')
        .update({ vault, updated_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('id', id)
        .select(PROJECT_COLS)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.json(mapProject(data as ProjectRow, req.user!.id));
    } catch (err) {
      console.error('DELETE studio vault failed', err);
      res.status(500).json({ error: 'Failed to remove from the report vault' });
    }
  }
);

// PATCH projects/:id/vault/:itemId { name?, meta: { url?, description? } }
studioRouter.patch(
  '/orgs/:orgId/studio/projects/:id/vault/:itemId',
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId, id, itemId } = req.params;
    const body = req.body || {};
    try {
      const project = await loadProject(req.db!, orgId, id);
      if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
      const vault = (project.vault ?? []).map((v) => {
        if (v.id !== itemId) return v;
        const updated = { ...v };
        if (typeof body.name === 'string' && body.name.trim()) updated.name = body.name.trim();
        if (body.meta && typeof body.meta === 'object') {
          updated.meta = { ...(v.meta ?? {}), ...(body.meta as Record<string, unknown>) };
        }
        if (typeof body.enabled === 'boolean') updated.enabled = body.enabled;
        return updated;
      });
      const { data, error } = await req
        .db!.from('studio_projects')
        .update({ vault, updated_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('id', id)
        .select(PROJECT_COLS)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) { res.status(404).json({ error: 'Project not found' }); return; }
      res.json({ ok: true });
    } catch (err) {
      console.error('PATCH studio vault failed', err);
      res.status(500).json({ error: 'Failed to update vault item' });
    }
  }
);

// POST projects/:id/import-pbix (multipart 'file') -> parse Power BI report into
// connectors/visuals/measures, attach a structured brief to the vault, and seed
// a starter HTML scaffold when the report is still empty.
studioRouter.post(
  '/orgs/:orgId/studio/projects/:id/import-pbix',
  requireMember(),
  raw({ type: 'multipart/form-data', limit: '120mb' }),
  async (req: Request, res: Response) => {
    const { orgId, id } = req.params;
    const contentType = req.headers['content-type'] || '';
    try {
      const project = await loadProject(req.db!, orgId, id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const bodyBuf = Buffer.isBuffer(req.body) ? (req.body as Buffer) : null;
      const file = bodyBuf ? parseMultipartFile(bodyBuf, contentType) : null;
      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      const displayName = titleize(fileSlug(file.filename));
      const summary = parsePbix(file.data, displayName);
      if (!summary) {
        res.status(422).json({
          error:
            "Couldn't read this Power BI file. A .pbit (template) export parses best, or attach it as a plain file instead.",
        });
        return;
      }

      const now = new Date().toISOString();
      const note: VaultItem = {
        id: randomUUID(),
        kind: 'note',
        name: `Power BI structure — ${displayName}`,
        content: summaryToMarkdown(summary),
        meta: {
          source: 'pbix',
          connectors: summary.sources,
          pages: summary.pages.length,
          visuals: summary.visuals.length,
          measures: summary.measureCount,
        },
        enabled: true,
        ts: now,
      };
      const vault = [...(project.vault ?? []), note].slice(-MAX_VAULT_ITEMS);
      const seedScaffold = !(project.html ?? '').trim();
      const assistant: StudioMessage = {
        role: 'assistant',
        content:
          `Imported "${displayName}" — found ${summary.sources.length} data connector(s), ` +
          `${summary.visuals.length} visual(s)` +
          (summary.measureCount ? `, ${summary.measureCount} measure(s)` : '') +
          (seedScaffold
            ? '. I scaffolded a starting report from its structure — tell me how to refine it.'
            : '. Added its structure to the report vault.'),
        ts: now,
      };
      const messages = [...(project.messages ?? []), assistant];

      const update: Record<string, unknown> = { vault, messages, updated_at: now };
      if (seedScaffold) update.html = summaryToScaffold(summary);

      const { data, error } = await req
        .db!.from('studio_projects')
        .update(update)
        .eq('org_id', orgId)
        .eq('id', id)
        .select(PROJECT_COLS)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.status(201).json(mapProject(data as ProjectRow, req.user!.id));
    } catch (err) {
      console.error('import-pbix failed', err);
      res.status(500).json({ error: 'Failed to import the Power BI report' });
    }
  }
);

// ---------------------------------------------------------------------------
// Workspace Vault — every connector + document used to generate reports
// ---------------------------------------------------------------------------

interface VaultConnectorRow {
  id: string;
  name: string;
  kind: string;
  sourceType: 'model' | 'report' | 'library';
  sourceName: string;
  deleteRef: string; // "model:{modelId}" | "ctx:{ctxId}" | "proj:{projectId}:{vaultItemId}"
  ownerId?: string | null;
  ownerEmail?: string | null;
  url?: string;
  meta?: Record<string, unknown>;
}
interface VaultDocumentRow {
  id: string;
  name: string;
  kind: string;
  sourceType: 'report' | 'library';
  sourceName: string;
  scope?: string;
  deleteRef: string;
  ownerId?: string | null;
  ownerEmail?: string | null;
  url?: string | null;     // for kind 'website'
  format?: string | null;  // for kind 'data' (CSV, XLSX, …)
}

// GET vault -> { connectors, documents } aggregated across models, the context
// library, and every report vault the caller can see. Owner-attributed.
studioRouter.get(
  '/orgs/:orgId/vault',
  requireMember(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const db = req.db!;
    try {
      const [modelsRes, ctxRes, projRes] = await Promise.all([
        db.from('models').select('id, name, data').eq('org_id', orgId),
        db
          .from('context_items')
          .select('id, owner_id, scope, kind, name, meta, enabled')
          .eq('org_id', orgId),
        db
          .from('studio_projects')
          .select('id, name, owner_id, vault, visibility')
          .eq('org_id', orgId),
      ]);

      const connectors: VaultConnectorRow[] = [];
      const documents: VaultDocumentRow[] = [];
      const ownerIds = new Set<string>();

      // 1) Connectors from org semantic models (workspace-level).
      for (const m of (modelsRes.data ?? []) as {
        id: string;
        name: string;
        data: { connectors?: { id?: string; name: string; kind: string }[] };
      }[]) {
        for (const c of m.data?.connectors ?? []) {
          connectors.push({
            id: `model-${m.id}-${c.id ?? c.kind}`,
            name: c.name,
            kind: c.kind,
            sourceType: 'model',
            sourceName: m.name,
            deleteRef: `model:${m.id}`,
            ownerEmail: null, // workspace-owned
          });
        }
      }

      // 2) Context Library items.
      for (const c of (ctxRes.data ?? []) as {
        id: string;
        owner_id: string;
        scope: string;
        kind: string;
        name: string;
        meta: Record<string, unknown> | null;
      }[]) {
        ownerIds.add(c.owner_id);
        const srcName = c.scope === 'org' ? 'Org library' : 'Personal library';
        if (c.kind === 'mcp') {
          connectors.push({
            id: `ctx-${c.id}`,
            name: c.name,
            kind: 'mcp',
            sourceType: 'library',
            sourceName: srcName,
            deleteRef: `ctx:${c.id}`,
            ownerId: c.owner_id,
            url: typeof c.meta?.url === 'string' ? c.meta.url : undefined,
            meta: (c.meta ?? {}) as Record<string, unknown>,
          });
        } else {
          documents.push({
            id: `ctx-${c.id}`,
            name: c.name,
            kind: c.kind,
            sourceType: 'library',
            sourceName: srcName,
            scope: c.scope,
            deleteRef: `ctx:${c.id}`,
            ownerId: c.owner_id,
            url: typeof c.meta?.url === 'string' ? c.meta.url : null,
            format: typeof c.meta?.format === 'string' ? c.meta.format : null,
          });
        }
      }

      // 3) Per-report vault items (incl. Power BI import-detected connectors).
      for (const p of (projRes.data ?? []) as {
        id: string;
        name: string;
        owner_id: string;
        vault: VaultItem[] | null;
      }[]) {
        ownerIds.add(p.owner_id);
        for (const v of p.vault ?? []) {
          if (v.kind === 'mcp' || v.kind === 'api') {
            const vMeta = (v.meta ?? {}) as Record<string, unknown>;
            connectors.push({
              id: `pv-${v.id}`,
              name: v.name,
              kind: v.kind,
              sourceType: 'report',
              sourceName: p.name,
              deleteRef: `proj:${p.id}:${v.id}`,
              ownerId: p.owner_id,
              url: typeof vMeta.url === 'string' ? vMeta.url : undefined,
              meta: vMeta,
            });
          } else {
            documents.push({
              id: `pv-${v.id}`,
              name: v.name,
              kind: v.kind,
              sourceType: 'report',
              sourceName: p.name,
              deleteRef: `proj:${p.id}:${v.id}`,
              ownerId: p.owner_id,
            });
          }
          // Power BI import notes carry detected connectors in meta.
          const meta = (v.meta ?? {}) as { source?: string; connectors?: { name: string; kind: string }[] };
          if (v.kind === 'note' && meta.source === 'pbix' && Array.isArray(meta.connectors)) {
            for (const c of meta.connectors) {
              connectors.push({
                id: `pbix-${v.id}-${c.kind}`,
                name: c.name,
                kind: c.kind,
                sourceType: 'report',
                sourceName: p.name,
                deleteRef: `proj:${p.id}:${v.id}`,
                ownerId: p.owner_id,
              });
            }
          }
        }
      }

      // Resolve owner emails and strip internal ids.
      const emails = await resolveEmails([...ownerIds]);
      const finishC = connectors.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        sourceType: r.sourceType,
        sourceName: r.sourceName,
        deleteRef: r.deleteRef,
        ownerEmail: r.ownerId ? emails.get(r.ownerId) ?? null : (r.ownerEmail ?? null),
        url: r.url ?? null,
        meta: r.meta ?? {},
      }));
      const finishD = documents.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        sourceType: r.sourceType,
        sourceName: r.sourceName,
        scope: r.scope ?? null,
        deleteRef: r.deleteRef,
        ownerEmail: r.ownerId ? emails.get(r.ownerId) ?? null : (r.ownerEmail ?? null),
        url: r.url ?? null,
        format: r.format ?? null,
      }));

      res.json({ connectors: finishC, documents: finishD });
    } catch (err) {
      console.error('GET vault failed', err);
      res.status(500).json({ error: 'Failed to load the workspace vault' });
    }
  }
);

// POST /orgs/:orgId/vault/ingest — unified intake: classify → profile → store.
// Body: { name?, url?, text?, dataBase64?, mediaType?, filename? }
// Returns the created item + its proposed categorization (category + confidence).
studioRouter.post(
  '/orgs/:orgId/vault/ingest',
  requireMember(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const body = (req.body || {}) as Record<string, unknown>;
    const input = {
      name: typeof body.name === 'string' ? body.name : undefined,
      url: typeof body.url === 'string' ? body.url : undefined,
      text: typeof body.text === 'string' ? body.text : undefined,
      dataBase64: typeof body.dataBase64 === 'string' ? body.dataBase64 : undefined,
      mediaType: typeof body.mediaType === 'string' ? body.mediaType : undefined,
      filename: typeof body.filename === 'string' ? body.filename : undefined,
    };
    if (!input.url && !input.text && !input.dataBase64 && !input.name) {
      res.status(400).json({ error: 'Provide a file, URL, or text to ingest.' });
      return;
    }
    try {
      const result = await ingestVaultItem(input);
      // Workspace BYOK first; else fall back to the server ANTHROPIC_API_KEY
      // (same resolution the report generator uses).
      const ai =
        (await loadAiConfig(orgId).catch(() => null)) ??
        (process.env.ANTHROPIC_API_KEY
          ? ({ provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, model: 'claude-opus-4-8' } as AiConfig)
          : null);

      // Image vision caption — makes images searchable + usable in widgets.
      if (result.category === 'image' && ai && input.dataBase64) {
        const caption = await captionImage(ai, input.dataBase64, input.mediaType ?? 'image/png');
        if (caption) {
          result.profile = { ...result.profile, caption };
          result.content = caption;
          if (!result.tags.includes('image')) result.tags.push('image');
        }
      }

      // Embed the profile for similarity retrieval (best-effort; null if no key).
      const embedKey = resolveEmbeddingKey(ai);
      let embedding: string | null = null;
      if (embedKey) {
        const vec = await embedText(
          profileText({ name: result.name, tags: result.tags, profile: result.profile, content: result.content }),
          embedKey
        );
        if (vec) embedding = toVectorLiteral(vec);
      }

      const { data, error } = await req
        .db!.from('context_items')
        .insert({
          org_id: orgId,
          owner_id: req.user!.id,
          scope: 'org',
          kind: result.kind,
          category: result.category,
          name: result.name,
          content: result.content,
          profile: result.profile,
          tags: result.tags,
          meta: result.meta,
          embedding,
          enabled: true,
        })
        .select('id, kind, category, name, profile, tags')
        .single();
      if (error) throw new Error(error.message);
      res.status(201).json({
        item: data,
        category: result.category,
        confidence: result.confidence,
      });
    } catch (err) {
      console.error('POST vault/ingest failed', err);
      res.status(500).json({ error: 'Failed to ingest item' });
    }
  }
);

// GET /orgs/:orgId/vault/powerbi — Power BI reports in the vault, with their
// detected tables, connectors and KPIs (from the parse profile) for rich cards.
studioRouter.get('/orgs/:orgId/vault/powerbi', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  try {
    const { data, error } = await req.db!
      .from('context_items')
      .select('id, name, profile, meta, created_at')
      .eq('org_id', orgId).eq('category', 'powerbi')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const items = ((data ?? []) as { id: string; name: string; profile: unknown; meta: unknown; created_at: string }[]).map((r) => {
      const profile = (r.profile ?? {}) as {
        tables?: { name: string; columns?: string[]; measures?: string[] }[];
        measureCount?: number; pages?: string[]; sources?: { name: string; kind: string }[];
        inspection?: Record<string, unknown>;
      };
      const meta = (r.meta ?? {}) as { connectors?: { name: string; kind: string }[] };
      const tables = (profile.tables ?? []).map((t) => ({ name: t.name, columns: t.columns ?? [], measures: t.measures ?? [] }));
      const connectors = (profile.sources?.length ? profile.sources : (meta.connectors ?? [])) as { name: string; kind: string }[];
      const kpis = tables.flatMap((t) => t.measures);
      return {
        id: r.id, name: r.name, deleteRef: `ctx:${r.id}`, createdAt: r.created_at,
        tables, connectors, kpis, measureCount: profile.measureCount ?? kpis.length,
        pages: profile.pages ?? [],
        // Phase-1 deep inspection (connectors typed, source systems, KPIs, entities, risks…), when present.
        inspection: profile.inspection ?? null,
      };
    });
    res.json(items);
  } catch (err) {
    console.error('GET vault/powerbi failed', err);
    res.status(500).json({ error: 'Failed to load Power BI reports' });
  }
});

// GET /orgs/:orgId/vault/kpis — company KPIs identified across the workspace
// (Power BI inspections today; DB/API sources slot in here later). Deduped by
// name, with the sources each KPI was detected in.
studioRouter.get('/orgs/:orgId/vault/kpis', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  try {
    const { data, error } = await req.db!
      .from('context_items')
      .select('id, name, category, profile, meta')
      .eq('org_id', orgId)
      .eq('category', 'powerbi');
    if (error) throw new Error(error.message);

    type KpiAgg = {
      name: string; businessMeaning?: string; source: string; confidence: string;
      expression?: string; table?: string; origins: { type: string; name: string }[];
    };
    const byName = new Map<string, KpiAgg>();
    const rank = { high: 3, medium: 2, low: 1 } as Record<string, number>;
    const add = (k: { name: string; businessMeaning?: string; source: string; confidence?: string; expression?: string; table?: string }, origin: { type: string; name: string }) => {
      const clean = (k.name ?? '').trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      const conf = k.confidence ?? 'low';
      let agg = byName.get(key);
      if (!agg) { agg = { name: clean, businessMeaning: k.businessMeaning, source: k.source, confidence: conf, expression: k.expression, table: k.table, origins: [] }; byName.set(key, agg); }
      else {
        if ((rank[conf] ?? 0) > (rank[agg.confidence] ?? 0)) { agg.confidence = conf; agg.source = k.source; }
        if (!agg.expression && k.expression) agg.expression = k.expression;
        if (!agg.businessMeaning && k.businessMeaning) agg.businessMeaning = k.businessMeaning;
      }
      if (!agg.origins.some((o) => o.type === origin.type && o.name === origin.name)) agg.origins.push(origin);
    };

    for (const r of (data ?? []) as { id: string; name: string; profile: unknown }[]) {
      const profile = (r.profile ?? {}) as {
        inspection?: { kpis?: { name: string; source: string; confidence?: string; expression?: string; table?: string; businessMeaningGuess?: string }[] };
        tables?: { name: string; measures?: string[] }[];
      };
      const insp = profile.inspection?.kpis;
      if (insp?.length) {
        for (const k of insp) add({ name: k.name, businessMeaning: k.businessMeaningGuess, source: k.source, confidence: k.confidence, expression: k.expression, table: k.table }, { type: 'powerbi', name: r.name });
      } else {
        // Legacy items (parsed before the inspector): KPIs = measures on tables.
        for (const t of profile.tables ?? []) for (const m of t.measures ?? []) add({ name: m, source: 'measure', confidence: 'high', table: t.name }, { type: 'powerbi', name: r.name });
      }
    }

    const kpis = [...byName.values()].sort((a, b) => (rank[b.confidence] ?? 0) - (rank[a.confidence] ?? 0) || a.name.localeCompare(b.name));
    res.json({ kpis, sourceCounts: { powerbi: (data ?? []).length } });
  } catch (err) {
    console.error('GET vault/kpis failed', err);
    res.status(500).json({ error: 'Failed to load KPIs' });
  }
});

// DELETE /orgs/:orgId/vault/kpis/:name — remove a detected KPI (by name) from
// every Power BI source it was detected in. KPIs are derived metadata, so we
// edit the stored inspection rather than delete a row; re-uploading the report
// would re-detect it.
studioRouter.delete('/orgs/:orgId/vault/kpis/:name', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const target = (req.params.name ?? '').trim().toLowerCase();
  if (!target) { res.status(400).json({ error: 'KPI name required' }); return; }
  try {
    const { data, error } = await req.db!
      .from('context_items')
      .select('id, profile')
      .eq('org_id', orgId)
      .eq('category', 'powerbi');
    if (error) throw new Error(error.message);

    let removed = 0;
    for (const r of (data ?? []) as { id: string; profile: unknown }[]) {
      const profile = (r.profile ?? {}) as {
        inspection?: { kpis?: { name: string }[] };
        tables?: { name: string; measures?: string[] }[];
      };
      let changed = false;
      const insp = profile.inspection?.kpis;
      if (insp?.length) {
        const next = insp.filter((k) => (k.name ?? '').trim().toLowerCase() !== target);
        if (next.length !== insp.length) { profile.inspection!.kpis = next; changed = true; }
      }
      // Legacy items: KPIs are measures listed on tables.
      for (const t of profile.tables ?? []) {
        if (!t.measures?.length) continue;
        const next = t.measures.filter((m) => (m ?? '').trim().toLowerCase() !== target);
        if (next.length !== t.measures.length) { t.measures = next; changed = true; }
      }
      if (changed) {
        const { error: upErr } = await req.db!.from('context_items').update({ profile }).eq('id', r.id).eq('org_id', orgId);
        if (upErr) throw new Error(upErr.message);
        removed++;
      }
    }
    res.json({ removed });
  } catch (err) {
    console.error('DELETE vault/kpis failed', err);
    res.status(500).json({ error: 'Failed to delete KPI' });
  }
});

// GET /orgs/:orgId/vault/doc/content?ref=ctx:{id}|proj:{pid}:{vid}
// Returns the stored content for a single document (fetched on demand, not in listing).
studioRouter.get(
  '/orgs/:orgId/vault/doc/content',
  requireMember(),
  async (req: Request, res: Response) => {
    const ref = (req.query.ref ?? '').toString().trim();
    const orgId = req.params.orgId;
    const db = req.db!;

    try {
      if (ref.startsWith('ctx:')) {
        const ctxId = ref.slice(4);
        const { data, error } = await db
          .from('context_items')
          .select('name, kind, content, meta')
          .eq('id', ctxId)
          .eq('org_id', orgId)
          .maybeSingle();
        if (error || !data) {
          res.status(404).json({ error: 'No preview available' });
          return;
        }
        // meta.pdf holds the base64 data URI for actual file preview
        const pdfData = (data.meta as Record<string, string> | null)?.pdf;
        const previewContent = pdfData ?? data.content ?? '';
        if (!previewContent) {
          res.status(404).json({ error: 'No preview available' });
          return;
        }
        res.json({ name: data.name, kind: data.kind, content: previewContent });
        return;
      }

      if (ref.startsWith('proj:')) {
        const [, projectId, itemId] = ref.split(':');
        const { data, error } = await db
          .from('studio_projects')
          .select('vault')
          .eq('id', projectId)
          .eq('org_id', orgId)
          .maybeSingle();
        if (error || !data) { res.status(404).json({ error: 'Project not found' }); return; }
        const item = ((data.vault ?? []) as { id: string; name: string; kind: string; content?: string }[])
          .find((v) => v.id === itemId);
        if (!item || !item.content) { res.status(404).json({ error: 'No preview available' }); return; }
        res.json({ name: item.name, kind: item.kind, content: item.content });
        return;
      }

      res.status(400).json({ error: 'Invalid ref' });
    } catch (err) {
      console.error('GET vault doc content failed', err);
      res.status(500).json({ error: 'Failed to load document content' });
    }
  }
);

// POST /orgs/:orgId/vault/test { url } — ping the URL from the server (avoids CORS)
studioRouter.post(
  '/orgs/:orgId/vault/test',
  requireMember(),
  async (req: Request, res: Response) => {
    const url = (req.body?.url ?? '').toString().trim();
    if (!url) { res.status(400).json({ error: 'url is required' }); return; }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let r = await fetch(url, { method: 'HEAD', signal: controller.signal }).catch(() =>
        fetch(url, { method: 'GET', signal: controller.signal })
      );
      if (r.status === 405) r = await fetch(url, { method: 'GET', signal: controller.signal });
      clearTimeout(timer);
      res.json({ ok: r.ok, status: r.status, statusText: r.statusText });
    } catch (e) {
      res.json({ ok: false, error: e instanceof Error ? e.message : 'Connection failed' });
    }
  }
);

// GET /orgs/:orgId/vault/test-stream?url=... — stream live diagnostics via SSE
studioRouter.get(
  '/orgs/:orgId/vault/test-stream',
  requireMember(),
  async (req: Request, res: Response) => {
    const url = ((req.query.url as string) ?? '').trim();
    if (!url) { res.status(400).json({ error: 'url required' }); return; }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const emit = (msg: string, ok?: boolean, done = false) => {
      res.write(`data: ${JSON.stringify({ msg, ok, done })}\n\n`);
    };

    let host = '';
    try { host = new URL(url).hostname; } catch { /* ignore */ }

    emit(`Resolving ${host || url}…`);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => { controller.abort(); }, 10000);
      const start = Date.now();

      emit('Connecting…');

      let r = await fetch(url, { method: 'HEAD', signal: controller.signal }).catch(() =>
        fetch(url, { method: 'GET', signal: controller.signal })
      );
      if (r.status === 405) r = await fetch(url, { method: 'GET', signal: controller.signal });
      clearTimeout(timer);

      const ms = Date.now() - start;
      const ct = r.headers.get('content-type') ?? '';

      if (r.ok) {
        emit(`${r.status} ${r.statusText}`, true);
        if (ct) emit(`Content-Type: ${ct}`);
        emit(`Latency: ${ms}ms`, true);
        emit('Connected', true, true);
      } else {
        emit(`${r.status} ${r.statusText} — ${ms}ms`, false);
        emit('Connection failed', false, true);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Connection failed';
      emit(msg, false);
      emit('Connection failed', false, true);
    }

    res.end();
  }
);

// PATCH /orgs/:orgId/vault/ctx/:ctxId { name?, url?, description? } — update a context-library MCP connector
studioRouter.patch(
  '/orgs/:orgId/vault/ctx/:ctxId',
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId, ctxId } = req.params;
    const db = req.db!;
    const userId = req.user!.id;
    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (body.meta && typeof body.meta === 'object') {
      const { data } = await db.from('context_items').select('meta').eq('id', ctxId).eq('org_id', orgId).single();
      const existingMeta = (data?.meta ?? {}) as Record<string, unknown>;
      patch.meta = { ...existingMeta, ...(body.meta as Record<string, unknown>) };
    }
    if (Object.keys(patch).length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }
    try {
      const role = callerRole(req);
      const { error } = await db
        .from('context_items')
        .update(patch)
        .eq('id', ctxId)
        .eq('org_id', orgId)
        .eq(role === 'member' ? 'owner_id' : 'org_id', role === 'member' ? userId : orgId);
      if (error) throw new Error(error.message);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'Update failed' });
    }
  }
);

// PATCH /orgs/:orgId/vault/model-connector { modelId, connectorKind, meta }
// Merges credential meta into models.data.connectors[].meta for the matching connector kind.
studioRouter.patch(
  '/orgs/:orgId/vault/model-connector',
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const { modelId, connectorKind, meta } = req.body ?? {};
    if (!modelId || !connectorKind || typeof meta !== 'object') {
      res.status(400).json({ error: 'modelId, connectorKind, and meta are required' });
      return;
    }
    try {
      const { data, error } = await req.db!
        .from('models')
        .select('data')
        .eq('id', modelId)
        .eq('org_id', orgId)
        .single();
      if (error || !data) { res.status(404).json({ error: 'Model not found' }); return; }
      const modelData = (data as any).data as {
        connectors?: { id?: string; name: string; kind: string; meta?: Record<string, unknown> }[];
        [k: string]: unknown;
      };
      const connectors = (modelData.connectors ?? []).map((c) =>
        c.kind === connectorKind
          ? { ...c, meta: { ...(c.meta ?? {}), ...(meta as Record<string, unknown>) } }
          : c
      );
      const { error: upErr } = await req.db!
        .from('models')
        .update({ data: { ...modelData, connectors } })
        .eq('id', modelId)
        .eq('org_id', orgId);
      if (upErr) throw new Error(upErr.message);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'Update failed' });
    }
  }
);

// DELETE vault entry — routes by deleteRef prefix.
// "model:{modelId}"         → delete the semantic model row
// "ctx:{contextItemId}"     → delete the context_items row (caller must own or be admin)
// "proj:{projectId}:{itemId}" → remove one item from studio_projects.vault[]
studioRouter.delete(
  '/orgs/:orgId/vault',
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const ref: string = req.body?.deleteRef ?? '';
    if (!ref) { res.status(400).json({ error: 'deleteRef is required' }); return; }

    const db = req.db!;
    const userId = req.user!.id;
    const role = callerRole(req);

    try {
      if (ref.startsWith('model:')) {
        const modelId = ref.slice('model:'.length);
        if (role !== 'owner' && role !== 'admin') {
          res.status(403).json({ error: 'Only owners and admins can delete models.' });
          return;
        }
        const { error } = await db.from('models').delete().eq('id', modelId).eq('org_id', orgId);
        if (error) throw error;
        res.json({ ok: true });

      } else if (ref.startsWith('ctx:')) {
        const ctxId = ref.slice('ctx:'.length);
        // owners/admins can delete any; members can delete their own
        let q = serviceClient.from('context_items').delete().eq('id', ctxId).eq('org_id', orgId);
        if (role === 'member') q = q.eq('owner_id', userId);
        const { error } = await q;
        if (error) throw error;
        res.json({ ok: true });

      } else if (ref.startsWith('proj:')) {
        const rest = ref.slice('proj:'.length);
        const colonIdx = rest.indexOf(':');
        if (colonIdx === -1) { res.status(400).json({ error: 'Invalid deleteRef' }); return; }
        const projectId = rest.slice(0, colonIdx);
        const vaultItemId = rest.slice(colonIdx + 1);

        const { data: proj, error: fetchErr } = await db
          .from('studio_projects')
          .select('owner_id, vault')
          .eq('id', projectId)
          .eq('org_id', orgId)
          .single();
        if (fetchErr || !proj) { res.status(404).json({ error: 'Project not found' }); return; }

        const canEdit = proj.owner_id === userId || role === 'owner' || role === 'admin';
        if (!canEdit) { res.status(403).json({ error: 'Not authorised' }); return; }

        const newVault = ((proj.vault as VaultItem[]) ?? []).filter((v) => v.id !== vaultItemId);
        const { error: updErr } = await db
          .from('studio_projects')
          .update({ vault: newVault })
          .eq('id', projectId);
        if (updErr) throw updErr;
        res.json({ ok: true });

      } else {
        res.status(400).json({ error: 'Unknown deleteRef format' });
      }
    } catch (err) {
      console.error('DELETE vault entry failed', err);
      res.status(500).json({ error: 'Delete failed' });
    }
  }
);

// ---------------------------------------------------------------------------
// Workspace AI provider settings (BYOK) — key handled server-side only
// ---------------------------------------------------------------------------

// GET ai-settings -> { active, providers:[{id,model,hasKey}], envKey, canEdit }
studioRouter.get(
  '/orgs/:orgId/studio/ai-settings',
  requireMember(),
  async (req: Request, res: Response) => {
    try {
      const row = await loadAiRow(req.params.orgId);
      res.json(aiSettingsView(row, ['owner', 'admin'].includes(callerRole(req) ?? '')));
    } catch (err) {
      console.error('GET ai-settings failed', err);
      res.status(500).json({ error: 'Failed to load AI settings' });
    }
  }
);

// PUT ai-settings { active?, entries?:[{provider,model?,apiKey?}] } — owner/admin only.
// Each entry sets that provider's model + (optionally) key. An apiKey of "" clears
// it; omitting apiKey keeps the existing key.
studioRouter.put(
  '/orgs/:orgId/studio/ai-settings',
  requireRole(['owner', 'admin']),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const body = req.body || {};
    try {
      const row = await loadAiRow(orgId);
      const providers: ProviderMap = { ...(row?.providers ?? {}) };

      const entries = Array.isArray(body.entries) ? body.entries : [];
      for (const e of entries) {
        const p = (e?.provider || '').toString() as AiProvider;
        if (!ALL_PROVIDERS.includes(p)) continue;
        const cur = providers[p] ?? {};
        const next: ProviderEntry = { ...cur };
        if (typeof e.model === 'string') next.model = e.model.trim();
        if ('apiKey' in e) next.apiKey = String(e.apiKey ?? '');
        providers[p] = next;
      }

      let active: AiProvider = row?.provider ?? 'anthropic';
      if (ALL_PROVIDERS.includes(body.active)) active = body.active;

      const { data, error } = await serviceClient
        .from('org_ai_settings')
        .upsert({
          org_id: orgId,
          provider: active,
          providers,
          updated_by: req.user!.id,
          updated_at: new Date().toISOString(),
        })
        .select('provider, providers, updated_at')
        .single();
      if (error) throw new Error(error.message);
      res.json(aiSettingsView(data as AiSettingsRow, true));
    } catch (err) {
      console.error('PUT ai-settings failed', err);
      res.status(500).json({ error: 'Failed to save AI settings' });
    }
  }
);

// POST ai-settings/test -> tests every provider that has a saved key (no inference).
//   -> [{ id, hasKey, ok, error? }]
studioRouter.post(
  '/orgs/:orgId/studio/ai-settings/test',
  requireMember(),
  async (req: Request, res: Response) => {
    try {
      const row = await loadAiRow(req.params.orgId);
      const providers = row?.providers ?? {};
      const results = await Promise.all(
        ALL_PROVIDERS.map(async (id) => {
          const key = providers[id]?.apiKey;
          if (!key) return { id, hasKey: false, ok: false };
          const r = await testProviderKey(id, key);
          return { id, hasKey: true, ok: r.ok, error: r.error };
        })
      );
      res.json(results);
    } catch (err) {
      console.error('POST ai-settings/test failed', err);
      res.status(500).json({ error: 'Failed to test AI keys' });
    }
  }
);

// ---------------------------------------------------------------------------
// Context Library
// ---------------------------------------------------------------------------

// POST context/summarize {filename, content} -> {description}
// Uses the org's active AI provider to generate a short description of a document.
// Falls back to extracting the first 400 chars if no AI key is configured.
studioRouter.post(
  '/orgs/:orgId/studio/context/summarize',
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const filename: string = req.body?.filename ?? 'document';
    const raw: string = (req.body?.content ?? '').slice(0, 80_000);
    if (!raw.trim()) { res.status(400).json({ error: 'content is required' }); return; }

    try {
      const ai = await loadAiConfig(orgId);
      if (!ai) {
        // No AI — return truncated preview as description
        const preview = raw.replace(/\s+/g, ' ').trim().slice(0, 400);
        res.json({ description: preview });
        return;
      }

      const prompt =
        `You are a document analyst. A user has uploaded a file named "${filename}". ` +
        `Read its content and write a concise description (2–4 sentences) that explains: ` +
        `what this document is, what topics or data it covers, and how an AI might use it as context. ` +
        `Output ONLY the description text — no headings, no bullet points, no markdown.\n\n` +
        `=== DOCUMENT CONTENT ===\n${raw}`;

      const DEFAULT_MODEL: Record<AiProvider, string> = {
        anthropic: 'claude-haiku-4-5-20251001',
        openai: 'gpt-4o-mini',
        openrouter: 'openai/gpt-4o-mini',
      };
      const model = ai.model || DEFAULT_MODEL[ai.provider];

      let description = '';
      if (ai.provider === 'anthropic') {
        const mod = await import('@anthropic-ai/sdk');
        const client = new mod.default({ apiKey: ai.apiKey });
        const resp = await client.messages.create({
          model,
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        });
        description = (resp.content ?? [])
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text).join('').trim();
      } else {
        const baseUrl = ai.provider === 'openai'
          ? 'https://api.openai.com/v1'
          : 'https://openrouter.ai/api/v1';
        const r = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}` },
          body: JSON.stringify({ model, max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
        });
        const data = await r.json() as { choices?: { message?: { content?: string } }[] };
        description = data.choices?.[0]?.message?.content?.trim() ?? '';
      }

      res.json({ description: description || raw.replace(/\s+/g, ' ').trim().slice(0, 400) });
    } catch (err) {
      console.error('context/summarize failed', err);
      // Graceful fallback — never block the upload
      const preview = raw.replace(/\s+/g, ' ').trim().slice(0, 400);
      res.json({ description: preview });
    }
  }
);

// GET context
studioRouter.get(
  '/orgs/:orgId/studio/context',
  requireMember(),
  async (req: Request, res: Response) => {
    try {
      const items = await loadContextItems(req.db!, req.params.orgId, req.user!.id);
      res.json(items);
    } catch (err) {
      console.error('GET studio context failed', err);
      res.status(500).json({ error: 'Failed to list context' });
    }
  }
);

// POST context {kind, name, content?, meta?, scope?}
studioRouter.post(
  '/orgs/:orgId/studio/context',
  requireMember(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const body = req.body || {};
    const kind = (body.kind || '').toString();
    const name = (body.name || '').toString().trim();
    if (!['doc', 'html', 'mcp', 'note', 'image', 'website', 'data'].includes(kind)) {
      res.status(400).json({ error: 'Invalid kind' });
      return;
    }
    if (!name) {
      res.status(400).json({ error: 'A name is required' });
      return;
    }
    const scope = body.scope === 'org' ? 'org' : 'user';
    try {
      const { data, error } = await req
        .db!.from('context_items')
        .insert({
          org_id: orgId,
          owner_id: req.user!.id,
          scope,
          kind,
          name,
          content: typeof body.content === 'string' ? body.content : '',
          meta: body.meta && typeof body.meta === 'object' ? body.meta : {},
          enabled: true,
        })
        .select(CONTEXT_COLS)
        .single();
      if (error) throw new Error(error.message);
      res.status(201).json(mapContext(data as ContextRow, req.user!.id));

      // Auto-grow the memory graph from substantial new content (best-effort,
      // fire-and-forget — never blocks or fails the create).
      const content = typeof body.content === 'string' ? body.content : '';
      if (['doc', 'note', 'data', 'website'].includes(kind) && content.trim().length > 80) {
        const itemId = (data as { id: string }).id;
        void (async () => {
          try {
            const ai = await loadAiConfig(orgId).catch(() => null);
            if (!ai) return;
            await ingestEpisode(req.db!, orgId,
              { sourceKind: 'vault', sourceRef: itemId, title: name, text: content }, ai, resolveEmbeddingKey(ai));
          } catch { /* best-effort */ }
        })();
      }
    } catch (err) {
      console.error('POST studio context failed', err);
      res.status(500).json({ error: 'Failed to create context item' });
    }
  }
);

// POST analyze-url { url, lenses?: string[] } — fetch a URL and run AI analysis
// lenses through it (api / company / competitive / metrics). Read-only; the
// caller acts on the results separately (create connector/agent/context).
studioRouter.post(
  '/orgs/:orgId/studio/analyze-url',
  requireMember(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const body = req.body || {};
    const normalized = normalizeUrl((body.url ?? '').toString());
    if (!normalized) {
      res.status(400).json({ error: 'Enter a valid public URL (e.g. https://acme.com).' });
      return;
    }
    const lenses = parseLenses(body.lenses);
    try {
      let siteText = '';
      let siteTitle = '';
      try {
        const site = await fetchSiteText(normalized);
        siteText = site.text;
        siteTitle = site.title;
      } catch (e) {
        res.status(422).json({
          error: e instanceof Error ? `Couldn't read that URL: ${e.message}` : "Couldn't read that URL.",
        });
        return;
      }
      const ai = await loadAiConfig(orgId).catch(() => null);
      // Enrich with a web search about the company (website alone is thin).
      let web: WebResult[] = [];
      try {
        const host = new URL(normalized).hostname.replace(/^www\./, '');
        const q = `${siteTitle || host} company overview revenue employees`;
        web = await webSearch(q, 8);
      } catch { /* web enrichment optional */ }
      const result = await analyzeUrl({ ai, siteText, siteTitle, url: normalized, lenses, web });
      res.json(result);
    } catch (err) {
      console.error('POST studio analyze-url failed', err);
      res.status(500).json({ error: 'Failed to analyse the URL.' });
    }
  }
);

// Domain age via RDAP (free, no key) — registration/creation date.
async function rdapDomainAge(domain: string): Promise<{ createdAt: string; ageYears: number } | null> {
  try {
    const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { Accept: 'application/rdap+json' }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { events?: { eventAction?: string; eventDate?: string }[] };
    const ev = (d.events ?? []).find((e) => /regist|creat/i.test(e.eventAction ?? ''));
    if (!ev?.eventDate) return null;
    const created = new Date(ev.eventDate);
    if (Number.isNaN(created.getTime())) return null;
    const years = (Date.now() - created.getTime()) / (365.25 * 86_400_000);
    return { createdAt: ev.eventDate, ageYears: Math.round(years * 10) / 10 };
  } catch { return null; }
}

// Gather (live) insights for a website — shared by the GET endpoint and the
// persist endpoint below.
interface SiteInsightData {
  url: string; domain: string; title: string;
  age: { createdAt: string; ageYears: number } | null;
  overview: string; facts: { label: string; value: string }[];
  sources: WebResult[]; usedAI: boolean;
}
async function gatherSiteInsights(orgId: string, normalized: string): Promise<SiteInsightData> {
  const domain = (() => { try { return new URL(normalized).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  let siteText = '', siteTitle = '';
  try { const s = await fetchSiteText(normalized); siteText = s.text; siteTitle = s.title; } catch { /* site unreachable */ }
  const [age, web, ai] = await Promise.all([
    rdapDomainAge(domain),
    webSearch(`${siteTitle || domain} company traffic visitors`, 8).catch(() => [] as WebResult[]),
    loadAiConfig(orgId).catch(() => null),
  ]);
  const analysis = await analyzeUrl({ ai, siteText, siteTitle, url: normalized, lenses: ['company'], web });
  return {
    url: normalized, domain, title: siteTitle || domain, age,
    overview: analysis.company?.summary ?? '', facts: analysis.company?.facts ?? [],
    sources: web, usedAI: analysis.usedAI,
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const slugifyName = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'competitor';

function insightMarkdown(name: string, d: SiteInsightData): string {
  const lines = [`# Insights — ${name}`, '', `**Website:** ${d.url}`];
  if (d.age) lines.push(`**Domain age:** ${d.age.ageYears} yrs (registered ${new Date(d.age.createdAt).toLocaleDateString()})`);
  if (d.overview) lines.push('', '## Overview', d.overview);
  if (d.facts.length) { lines.push('', '## Company facts'); for (const f of d.facts) lines.push(`- **${f.label}:** ${f.value}`); }
  if (d.sources.length) { lines.push('', '## Around the web'); for (const s of d.sources.slice(0, 8)) lines.push(`- [${s.title}](${s.url})${s.snippet ? ` — ${s.snippet}` : ''}`); }
  lines.push('', '---', `*Generated by DeepLogic site insights · ${new Date().toLocaleString()}*`);
  return lines.join('\n');
}

function insightWidgetHtml(name: string, d: SiteInsightData): string {
  const facts = d.facts.map((f) => `<li><strong>${esc(f.label)}:</strong> ${esc(f.value)}</li>`).join('');
  const srcs = d.sources.slice(0, 5).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.title)}</a></li>`).join('');
  return `<div class="wg" style="font:14px/1.5 system-ui,sans-serif;color:inherit;padding:16px;display:flex;flex-direction:column;gap:12px">
    <div style="font-weight:800;font-size:16px">⚔ ${esc(name)} — Insights</div>
    ${d.age ? `<div style="opacity:.75;font-size:12px">Domain age: ${d.age.ageYears} yrs</div>` : ''}
    ${d.overview ? `<p style="margin:0">${esc(d.overview)}</p>` : ''}
    ${facts ? `<div><div style="font-weight:700;font-size:12px;text-transform:uppercase;opacity:.6;margin-bottom:4px">Facts</div><ul style="margin:0;padding-left:18px">${facts}</ul></div>` : ''}
    ${srcs ? `<div><div style="font-weight:700;font-size:12px;text-transform:uppercase;opacity:.6;margin-bottom:4px">Around the web</div><ul style="margin:0;padding-left:18px">${srcs}</ul></div>` : ''}
    <div style="opacity:.5;font-size:11px;margin-top:auto">Updated ${new Date().toLocaleDateString()}</div>
  </div>`;
}

// GET site-insights?url=[&refresh=1] — insights about a competitor/company
// website. Served from the org_site_insights cache so revisiting is instant;
// a fresh gather (AI + web search) runs only on a cache miss or ?refresh=1.
studioRouter.get(
  '/orgs/:orgId/studio/site-insights',
  requireMember(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const normalized = normalizeUrl((req.query.url ?? '').toString());
    if (!normalized) { res.status(400).json({ error: 'Enter a valid public URL.' }); return; }
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const domain = toDomain(normalized);
    try {
      if (!refresh && domain) {
        const { data } = await req.db!
          .from('org_site_insights').select('data, fetched_at').eq('org_id', orgId).eq('domain', domain).maybeSingle();
        const row = data as { data: SiteInsightData; fetched_at: string } | null;
        if (row?.data) { res.json({ ...row.data, cached: true, cachedAt: row.fetched_at }); return; }
      }
      const fresh = await gatherSiteInsights(orgId, normalized);
      const fetchedAt = new Date().toISOString();
      if (domain) {
        await req.db!.from('org_site_insights')
          .upsert({ org_id: orgId, domain, data: fresh, fetched_at: fetchedAt }, { onConflict: 'org_id,domain' });
      }
      res.json({ ...fresh, cached: false, cachedAt: fetchedAt });
    } catch (err) {
      console.error('GET site-insights failed', err);
      res.status(500).json({ error: 'Failed to load site insights.' });
    }
  }
);

// POST site-insights/persist — generate insights and STORE them: a markdown doc
// in the Data Vault (DB) and, by default, a card on the competitor's dashboard
// (created under the Competitors group if it doesn't exist). Idempotent per url.
studioRouter.post(
  '/orgs/:orgId/studio/site-insights/persist',
  requireMember(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const body = req.body || {};
    const normalized = normalizeUrl((body.url ?? '').toString());
    if (!normalized) { res.status(400).json({ error: 'Enter a valid public URL.' }); return; }
    const toDashboard = body.toDashboard !== false;
    try {
      const d = await gatherSiteInsights(orgId, normalized);
      const name = String(body.name || d.title || d.domain).slice(0, 120);

      // 1) Data Vault markdown doc (stores both the structured data in meta and
      //    the rendered .md in content). Upsert by the source url.
      const meta = {
        format: 'md', source: 'site-insights', siteInsightUrl: normalized, domain: d.domain,
        competitor: true, overview: d.overview, facts: d.facts, age: d.age, generatedAt: new Date().toISOString(),
      };
      const { data: existingDoc } = await req.db!
        .from('context_items').select('id').eq('org_id', orgId).eq('meta->>siteInsightUrl', normalized).maybeSingle();
      let itemId: string | null = (existingDoc as { id: string } | null)?.id ?? null;
      if (itemId) {
        await req.db!.from('context_items').update({ name: `Insights — ${name}`, content: insightMarkdown(name, d), meta, enabled: true }).eq('id', itemId);
      } else {
        const { data: ins } = await req.db!.from('context_items')
          .insert({ org_id: orgId, owner_id: req.user!.id, scope: 'org', kind: 'doc', name: `Insights — ${name}`, content: insightMarkdown(name, d), meta, enabled: true })
          .select('id').maybeSingle();
        itemId = (ins as { id: string } | null)?.id ?? null;
      }

      // 2) Competitor dashboard card (by default).
      let dashboardId: string | null = null, widgetId: string | null = null;
      if (toDashboard) {
        const { data: boards } = await req.db!.from('dashboards').select('id, name').eq('org_id', orgId).eq('group_name', 'Competitors');
        let board = (boards ?? []).find((b) => (b.name as string).toLowerCase() === name.toLowerCase()) as { id: string } | undefined;
        if (!board) {
          let slug = slugifyName(name);
          const { data: ex } = await req.db!.from('dashboards').select('slug').eq('org_id', orgId).like('slug', `${slug}%`);
          const taken = new Set((ex ?? []).map((r) => r.slug)); let cand = slug, n = 2;
          while (taken.has(cand)) cand = `${slug}-${n++}`; slug = cand;
          const { data: nb } = await req.db!.from('dashboards')
            .insert({ id: randomUUID(), org_id: orgId, owner_id: req.user!.id, name, slug, description: `Competitive dashboard for ${name}`, group_name: 'Competitors' })
            .select('id').maybeSingle();
          board = nb as { id: string } | undefined;
        }
        if (board) {
          dashboardId = board.id;
          const wname = `${name} — Insights`;
          const html = insightWidgetHtml(name, d);
          const { data: exW } = await req.db!.from('widgets').select('id').eq('org_id', orgId).eq('dashboard_id', board.id).eq('name', wname).maybeSingle();
          if (exW) {
            widgetId = (exW as { id: string }).id;
            await req.db!.from('widgets').update({ html, last_refreshed: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', widgetId);
          } else {
            const { data: maxRow } = await req.db!.from('widgets').select('grid_y, grid_h').eq('dashboard_id', board.id).order('grid_y', { ascending: false }).limit(1).maybeSingle();
            const gy = maxRow ? ((maxRow.grid_y as number) + (maxRow.grid_h as number)) : 0;
            const wid = randomUUID(); const now = new Date().toISOString();
            await req.db!.from('widgets').insert({
              id: wid, org_id: orgId, dashboard_id: board.id, owner_id: req.user!.id, name: wname, type: 'insight',
              html, prompt: null, grid_x: 0, grid_y: gy, grid_w: 4, grid_h: 3, sources: [], alert_rule: null,
              created_at: now, updated_at: now, last_refreshed: now,
            });
            widgetId = wid;
          }
        }
      }

      res.json({ ok: true, itemId, dashboardId, widgetId, savedAt: new Date().toISOString(), usedAI: d.usedAI });
    } catch (err) {
      console.error('POST site-insights/persist failed', err);
      res.status(500).json({ error: 'Failed to save insights.' });
    }
  }
);

// Wikipedia pageviews — a FREE, keyless, reliable proxy for public interest in a
// company over time (the only no-cost way to graph & compare competitor demand;
// real traffic numbers need a paid provider like SimilarWeb/Semrush). Two steps:
// resolve the company name to a Wikipedia article, then pull monthly pageviews.
const WIKI_UA = { 'User-Agent': 'DeepLogic/1.0 (https://deeplogic.app; michael@epixia.com)' };
interface TrendSeries { term: string; title: string | null; confident: boolean; points: { date: string; value: number }[] }

// Resolve a free-text company name to a Wikipedia article title. `confident` is
// true only when the company's distinctive name actually appears in the hit —
// guards against matching an unrelated/acquirer page (e.g. Hexo -> Tilray).
async function wikiResolveTitle(q: string): Promise<{ title: string; confident: boolean } | null> {
  try {
    const u = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=3`;
    const r = await fetch(u, { headers: WIKI_UA, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { query?: { search?: { title: string; snippet?: string }[] } };
    const hits = j.query?.search ?? [];
    const token = (q.split(/\s+/)[0] ?? '').toLowerCase();
    for (const h of hits) {
      const hay = `${h.title} ${(h.snippet ?? '').replace(/<[^>]+>/g, '')}`.toLowerCase();
      if (token.length >= 3 && hay.includes(token)) return { title: h.title, confident: true };
    }
    return hits[0] ? { title: hits[0].title, confident: false } : null;
  } catch { return null; }
}

// Pull `months` of monthly pageviews for a Wikipedia article, oldest -> newest.
async function wikiPageviews(title: string, months: number): Promise<{ date: string; value: number }[]> {
  const fmt = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}0100`;
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, 1));
  const enc = encodeURIComponent(title.replace(/ /g, '_'));
  const u = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/all-agents/${enc}/monthly/${fmt(start)}/${fmt(end)}`;
  try {
    const r = await fetch(u, { headers: WIKI_UA, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const j = (await r.json()) as { items?: { timestamp: string; views: number }[] };
    const now = new Date();
    const curMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    // Drop the in-progress current month — its partial count makes a false cliff.
    return (j.items ?? [])
      .map((i) => ({ date: `${i.timestamp.slice(0, 4)}-${i.timestamp.slice(4, 6)}`, value: i.views }))
      .filter((p) => p.date !== curMonth);
  } catch { return []; }
}

// GET competitor-trends?terms=a,b,c — free monthly public-interest series per
// company (Wikipedia pageviews). Each series carries the matched article title
// so the UI can be honest about what was graphed.
studioRouter.get(
  '/orgs/:orgId/studio/competitor-trends',
  requireMember(),
  async (req: Request, res: Response) => {
    const terms = (req.query.terms ?? '').toString().split(',').map((t) => t.trim()).filter(Boolean).slice(0, 5);
    if (terms.length === 0) { res.status(400).json({ error: 'Provide at least one company name.' }); return; }
    const months = Math.min(36, Math.max(3, Number(req.query.months) || 12));
    try {
      const series: TrendSeries[] = await Promise.all(
        terms.map(async (term): Promise<TrendSeries> => {
          const resolved = await wikiResolveTitle(term);
          if (!resolved) return { term, title: null, confident: false, points: [] };
          const points = await wikiPageviews(resolved.title, months);
          return { term, title: resolved.title, confident: resolved.confident, points };
        }),
      );
      res.json({ source: 'wikipedia-pageviews', unit: 'Monthly Wikipedia pageviews', months, series });
    } catch (err) {
      console.error('GET competitor-trends failed', err);
      res.status(500).json({ error: 'Failed to load trends.' });
    }
  }
);

// A compact SEO summary (for the competitors table / note meta) derived from a
// full intel bundle — so the table and the detail page always agree.
function seoSummary(intel: DomainIntel) {
  return {
    provider: 'dataforseo',
    domain: intel.domain,
    organicKeywords: intel.overview.organicKeywords,
    organicTraffic: intel.overview.organicTraffic,
    organicTrafficCost: intel.overview.organicTrafficCost,
    pos1: intel.overview.pos1,
    pos2_3: intel.overview.pos2_3,
    fetchedAt: intel.fetchedAt,
  };
}

// POST competitors/analyze { ids } — fetch FULL DataForSEO intel for each
// selected competitor's domain and store it in BOTH places so it shows
// everywhere without re-fetching: the shared org_domain_intel cache (used by the
// detail page) and a summary on the competitor's note meta.seo (used by the
// competitors table). Requires DataForSEO configured in Settings → APIs.
studioRouter.post(
  '/orgs/:orgId/studio/competitors/analyze',
  requireMember(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const ids = Array.isArray(req.body?.ids)
      ? (req.body.ids as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 25)
      : [];
    if (ids.length === 0) { res.status(400).json({ error: 'Select at least one competitor.' }); return; }

    const creds = await loadPlatformApiCreds(orgId, 'dataforseo');
    if (!creds?.login || !creds?.password) {
      res.status(400).json({ error: 'Connect DataForSEO first in Settings → APIs.' });
      return;
    }
    const dfsCreds = { login: creds.login, password: creds.password };

    try {
      const { data: rows } = await req.db!
        .from('context_items')
        .select('id, name, content, meta')
        .eq('org_id', orgId)
        .in('id', ids);
      const items = (rows ?? []) as { id: string; name: string; content: string | null; meta: Record<string, unknown> | null }[];

      const results = await Promise.all(items.map(async (it) => {
        const meta = (it.meta ?? {}) as Record<string, unknown>;
        const name = (typeof meta.name === 'string' && meta.name) || it.name.replace(/^Competitor:\s*/, '');
        const website = typeof meta.website === 'string' ? meta.website : '';
        const domain = toDomain(website || name);
        if (!domain || !domain.includes('.')) {
          return { id: it.id, name, ok: false, error: 'No valid website to analyze.' };
        }
        try {
          const intel = await dataforseoDomainIntel(dfsCreds, domain);
          const seo = seoSummary(intel);
          await req.db!.from('org_domain_intel')
            .upsert({ org_id: orgId, domain, intel, fetched_at: intel.fetchedAt }, { onConflict: 'org_id,domain' });
          await req.db!.from('context_items').update({ meta: { ...meta, seo } }).eq('id', it.id);
          return { id: it.id, name, ok: true, seo };
        } catch (e) {
          return { id: it.id, name, ok: false, error: e instanceof Error ? e.message : 'Analyze failed.' };
        }
      }));

      res.json({ results });
    } catch (err) {
      console.error('POST competitors/analyze failed', err);
      res.status(500).json({ error: 'Failed to analyze competitors.' });
    }
  }
);

// GET domain-intel?url= — return the CACHED DataForSEO intel for a domain (DB
// only, no external call). intel is null when nothing has been fetched yet.
studioRouter.get(
  '/orgs/:orgId/studio/domain-intel',
  requireMember(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const domain = toDomain((req.query.url ?? '').toString());
    if (!domain) { res.status(400).json({ error: 'Provide a url.' }); return; }
    try {
      const { data } = await req.db!
        .from('org_domain_intel').select('intel, fetched_at').eq('org_id', orgId).eq('domain', domain).maybeSingle();
      const row = data as { intel: unknown; fetched_at: string } | null;
      res.json({ domain, intel: row?.intel ?? null, fetchedAt: row?.fetched_at ?? null });
    } catch (err) {
      console.error('GET domain-intel failed', err);
      res.status(500).json({ error: 'Failed to load intel.' });
    }
  }
);

// POST domain-intel { url } — fetch FRESH intel from DataForSEO, cache it in
// org_domain_intel, and return it. The only path that spends DataForSEO credit.
studioRouter.post(
  '/orgs/:orgId/studio/domain-intel',
  requireMember(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const domain = toDomain((req.body?.url ?? '').toString());
    if (!domain || !domain.includes('.')) { res.status(400).json({ error: 'Provide a valid website url.' }); return; }
    const creds = await loadPlatformApiCreds(orgId, 'dataforseo');
    if (!creds?.login || !creds?.password) {
      res.status(400).json({ error: 'Connect DataForSEO first in Settings → APIs.' });
      return;
    }
    try {
      const intel = await dataforseoDomainIntel({ login: creds.login, password: creds.password }, domain);
      await req.db!.from('org_domain_intel').upsert(
        { org_id: orgId, domain, intel, fetched_at: intel.fetchedAt },
        { onConflict: 'org_id,domain' },
      );
      // Mirror a summary onto any competitor note for this domain, so the
      // competitors table reflects intel fetched from the detail page too.
      try {
        const { data } = await req.db!
          .from('context_items').select('id, meta').eq('org_id', orgId).like('name', 'Competitor: %');
        const seo = seoSummary(intel);
        for (const row of (data ?? []) as { id: string; meta: Record<string, unknown> | null }[]) {
          const site = typeof row.meta?.website === 'string' ? row.meta.website : '';
          if (site && toDomain(site) === domain) {
            await req.db!.from('context_items').update({ meta: { ...(row.meta ?? {}), seo } }).eq('id', row.id);
          }
        }
      } catch { /* mirror is best-effort */ }
      res.json({ domain, intel, fetchedAt: intel.fetchedAt });
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : 'Failed to fetch intel.' });
    }
  }
);

// One-shot execution of an agent: run its system prompt now and return the
// output. Uses the agent's model when it matches the org provider, else the
// provider default.
export async function runAgentOnce(ai: AiConfig, agentModel: string, systemPrompt: string): Promise<string> {
  const system = systemPrompt?.trim() || 'You are a helpful AI agent. Produce your output now.';
  const userMsg = 'Run now using the current workspace context. Produce your output concisely in markdown.';
  if (ai.provider === 'openai' || ai.provider === 'openrouter') {
    const model = /^gpt|\//.test(agentModel) ? agentModel : (ai.model ?? 'gpt-4o');
    const baseURL = ai.provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
    const r = await fetch(baseURL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ai.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }] }),
    });
    const j = await r.json() as { choices?: { message?: { content?: string } }[] };
    return (j.choices?.[0]?.message?.content ?? '').trim() || '(the agent returned no output)';
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ai.apiKey });
  const model = /^claude/.test(agentModel) ? agentModel : (ai.model ?? 'claude-sonnet-4-6');
  const msg = await client.messages.create({ model, max_tokens: 1500, system, messages: [{ role: 'user', content: userMsg }] });
  return (msg.content.find((b) => b.type === 'text')?.text ?? '').trim() || '(the agent returned no output)';
}

// Harvest a finished agent run's output into durable, reusable knowledge:
//  1) a living "Agent findings — <Agent>" markdown doc in the Data Vault (newest
//     finding on top, with provenance), and
//  2) the bi-temporal memory graph (entities + facts) so future runs recall it.
// Best-effort: any failure here is logged, never thrown into the run.
async function harvestAgentFinding(
  req: Request, orgId: string,
  agent: { id: string; name: string },
  output: string, ai: AiConfig | null,
  opts: { runId: string | null; goalId?: string; goalTitle?: string; onStep?: (s: { icon: string; text: string }) => void },
): Promise<void> {
  const finding = (output ?? '').trim();
  // Skip trivial / refusal-ish outputs — not worth storing as knowledge.
  if (finding.length < 80 || /^\(the agent returned no output\)$/i.test(finding)) return;

  const title = `Agent findings — ${agent.name}`;
  const stamp = new Date().toLocaleString();
  const tag = opts.goalTitle ? ` · Goal: ${opts.goalTitle}` : '';
  const entry = `## ${stamp}${tag}\n\n${finding}\n`;

  // Upsert one living findings doc per agent (newest entry first, capped).
  const meta: Record<string, unknown> = {
    format: 'md', source: 'agent-finding', findingAgentId: agent.id, lastRunId: opts.runId ?? null,
    ...(opts.goalId ? { goalId: opts.goalId, goalTitle: opts.goalTitle } : {}),
  };
  let itemId: string | null = null;
  try {
    const { data: existing } = await req.db!
      .from('context_items').select('id, content').eq('org_id', orgId).eq('meta->>findingAgentId', agent.id).maybeSingle();
    if (existing) {
      itemId = (existing as { id: string }).id;
      const prior = String((existing as { content?: string }).content ?? '').replace(/^# .*?\n+/, '');
      const content = `# ${title}\n\n${entry}\n---\n\n${prior}`.slice(0, 40000);
      await req.db!.from('context_items').update({ name: title, content, meta, enabled: true }).eq('id', itemId);
    } else {
      const { data: ins } = await req.db!
        .from('context_items')
        .insert({ org_id: orgId, owner_id: req.user!.id, scope: 'org', kind: 'doc', name: title, content: `# ${title}\n\n${entry}`, meta, enabled: true })
        .select('id').maybeSingle();
      itemId = (ins as { id: string } | null)?.id ?? null;
    }
  } catch (e) { console.error('[harvest] vault doc failed', e); }

  // Feed the memory graph so the finding becomes recallable knowledge.
  try {
    await ingestEpisode(
      req.db!, orgId,
      { sourceKind: 'agent', sourceRef: itemId ?? opts.runId ?? undefined, title: `${agent.name} finding`, text: finding },
      ai, resolveEmbeddingKey(ai),
    );
  } catch (e) { console.error('[harvest] memory ingest failed', e); }

  opts.onStep?.({ icon: '🧠', text: 'Saved finding to Data Vault & memory' });
}

// Run an internal agent autonomously: gather workspace context, let it use its
// tools (research + Data Vault), record the whole trace to the activity log, and
// keep the agent's live status in sync. Shared by the chat run_agent tool and
// the POST /agents/:id/run endpoint.
export async function executeInternalAgentRun(
  req: Request, orgId: string,
  agent: { id: string; name: string; model: string; system_prompt: string },
  opts: {
    trigger: 'manual' | 'chat' | 'schedule' | 'goal';
    triggerContext?: Record<string, unknown>;
    groupId?: string | null;
    groupLabel?: string | null;
    onStep?: (s: { icon: string; text: string }) => void;
  },
): Promise<{ output: string; runId: string | null }> {
  const ai = (await loadAiConfig(orgId).catch(() => null)) ?? serverFallbackAi();
  if (!ai) throw new Error('No AI provider configured — add a key in Settings → AI providers.');

  // Workspace context so the agent can actually ground its work.
  const items = await loadContextItems(req.db!, orgId, req.user!.id).catch(() => []);
  const inventory: VaultInventoryItem[] = items.map((it) => ({
    kind: it.kind, name: it.name, snippet: typeof it.content === 'string' ? it.content.slice(0, 200) : '',
  }));
  const profileItem = items.find((it) => (it.meta as Record<string, unknown> | undefined)?.companyProfile === true);
  const companyProfile = typeof profileItem?.content === 'string' ? profileItem.content : '';
  let goals: { title: string; plan: string[]; agents: { name: string; role: string }[]; status: string }[] = [];
  try {
    const { data } = await req.db!.from('goals').select('title, plan, agents, status').eq('org_id', orgId).limit(50);
    goals = (data ?? []) as typeof goals;
  } catch { /* optional */ }
  const recallQuery = `${agent.name} ${agent.system_prompt}`.slice(0, 400);
  const memory = await recallMemory(req.db!, orgId, recallQuery, 10, resolveEmbeddingKey(ai))
    .then((f) => f.map((x) => x.statement)).catch(() => [] as string[]);

  const executeTool = assistantToolExecutor(req, orgId);

  // Whether this agent loops (has a cron schedule) or is a one-time run.
  let schedule: string | null = null;
  try {
    const { data } = await req.db!.from('agents').select('schedule').eq('id', agent.id).eq('org_id', orgId).maybeSingle();
    schedule = (data as { schedule: string | null } | null)?.schedule ?? null;
  } catch { /* optional */ }
  const triggerContext = { ...(opts.triggerContext ?? {}), schedule, recurring: !!schedule };

  await req.db!.from('agents').update({ status: 'running' }).eq('id', agent.id).eq('org_id', orgId);
  const runId = await beginRun(req.db!, { orgId, agentId: agent.id, agentKind: 'internal', agentName: agent.name, trigger: opts.trigger, model: agent.model, triggerContext, groupId: opts.groupId, groupLabel: opts.groupLabel });
  await appendEvent(req.db!, orgId, runId, 'step', `Started "${agent.name}"`, '▶️');

  try {
    const { text } = await runAgentTask({
      ai, agentName: agent.name, agentSystemPrompt: agent.system_prompt, executeTool,
      inventory, companyProfile, memory, goals,
      onStep: (s) => {
        // 🧠 = the agent's own reasoning; everything else is a tool action.
        void appendEvent(req.db!, orgId, runId, s.icon === '🧠' ? 'reasoning' : 'tool_call', s.text, s.icon);
        opts.onStep?.(s);
      },
    });
    const output = text || '(the agent returned no output)';
    await appendEvent(req.db!, orgId, runId, 'output', output.slice(0, 2000), '📄');
    await finishRun(req.db!, runId, 'succeeded', { result: output });
    await req.db!.from('agents').update({ status: 'idle', last_run_at: new Date().toISOString(), last_run_status: 'ok' }).eq('id', agent.id).eq('org_id', orgId);
    // Harvest the finding into the Data Vault + memory graph so it compounds the
    // workspace's knowledge (best-effort — never fails the run).
    const tctx = triggerContext as Record<string, unknown>;
    await harvestAgentFinding(req, orgId, agent, output, ai, {
      runId,
      goalId: typeof tctx.goalId === 'string' ? tctx.goalId : undefined,
      goalTitle: typeof tctx.goalTitle === 'string' ? tctx.goalTitle : undefined,
      onStep: opts.onStep,
    }).catch((e) => console.error('[harvest] failed', e));
    return { output, runId };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Agent run failed.';
    await appendEvent(req.db!, orgId, runId, 'step', `Failed: ${errMsg}`, '✗');
    await finishRun(req.db!, runId, 'failed', { error: errMsg });
    await req.db!.from('agents').update({ status: 'idle', last_run_at: new Date().toISOString(), last_run_status: 'error' }).eq('id', agent.id).eq('org_id', orgId);
    throw e;
  }
}

// Tools the assistant can dispatch — executed under the caller's RLS db.
// `onAgentStep`, when provided, receives an inner agent's live thoughts so a
// chat-triggered run_agent streams the sub-agent's reasoning to the client too.
function assistantToolExecutor(req: Request, orgId: string, onAgentStep?: (s: { icon: string; text: string }) => void) {
  return async (name: string, input: Record<string, unknown>): Promise<unknown> => {
    if (name === 'web_research') {
      const results = await webSearch(String(input.query ?? ''));
      return results.length ? results : { note: 'No web results — try wikipedia_lookup or fetch_url on the company site instead.' };
    }
    if (name === 'wikipedia_lookup') {
      const wiki = await wikipediaSummary(String(input.query ?? ''));
      return wiki ?? { note: 'No Wikipedia article found — try web_research or fetch_url.' };
    }
    if (name === 'fetch_url') {
      const url = normalizeUrl(String(input.url ?? ''));
      if (!url) return { error: 'Invalid or non-public URL.' };
      try {
        const site = await fetchSiteText(url);
        return { title: site.title, text: site.text.slice(0, 8000) };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Fetch failed.' };
      }
    }
    if (name === 'add_to_vault') {
      const kind = ['note', 'website', 'data', 'doc'].includes(String(input.kind)) ? String(input.kind) : 'note';
      const nm = String(input.name ?? '').trim().slice(0, 200) || 'Untitled';
      const meta = kind === 'website' && input.url ? { url: String(input.url) } : {};
      const { data, error } = await req
        .db!.from('context_items')
        .insert({
          org_id: orgId, owner_id: req.user!.id, scope: 'org', kind, name: nm,
          content: typeof input.content === 'string' ? input.content.slice(0, 60_000) : '',
          meta, enabled: true,
        })
        .select('id, name')
        .single();
      if (error) return { error: error.message };
      return { ok: true, id: (data as { id: string }).id, name: nm };
    }
    if (name === 'add_connector') {
      const url = String(input.url ?? '').trim();
      if (!url) return { error: 'A connector needs a url/endpoint.' };
      const nm = String(input.name ?? '').trim().slice(0, 200) || 'API connector';
      const ctype = ['rest', 'graphql', 'odata', 'soap', 'database'].includes(String(input.type)) ? String(input.type) : 'rest';
      const desc = String(input.description ?? '').trim().slice(0, 4000);
      const apiKey = String(input.apiKey ?? '').trim();
      const content = [`Endpoint: ${url}`, desc ? `Description: ${desc}` : '', apiKey ? 'Auth: Bearer token configured' : '']
        .filter(Boolean).join('\n');
      const meta: Record<string, unknown> = { connectorType: ctype, url, description: desc };
      if (apiKey) meta.apiKey = apiKey;
      // kind 'mcp' is what the Vault classifies as a connector (Connectors tab).
      const { data, error } = await req
        .db!.from('context_items')
        .insert({ org_id: orgId, owner_id: req.user!.id, scope: 'org', kind: 'mcp', name: nm, content, meta, enabled: true })
        .select('id, name')
        .single();
      if (error) return { error: error.message };
      return {
        ok: true, id: (data as { id: string }).id, name: nm, type: ctype, url,
        note: 'Added as a queryable connector — visible in the Data Vault → Connectors tab.',
      };
    }
    if (name === 'create_agent') {
      const allowed = new Set(['0 * * * *', '0 9 * * *', '0 9 * * 1', '0 9 1 * *']);
      const sched = input.schedule && allowed.has(String(input.schedule)) ? String(input.schedule) : null;
      const { data, error } = await req
        .db!.from('agents')
        .insert({
          org_id: orgId, created_by: req.user!.id,
          name: String(input.name ?? '').trim().slice(0, 80) || 'New agent',
          description: String(input.description ?? '').trim().slice(0, 240),
          model: 'claude-sonnet-4-6',
          system_prompt: String(input.systemPrompt ?? '').slice(0, 8000),
          schedule: sched,
        })
        .select('id, name')
        .single();
      if (error) return { error: error.message };
      return { ok: true, id: (data as { id: string }).id, name: (data as { name: string }).name };
    }
    if (name === 'run_agent') {
      const want = String(input.name ?? '').trim();
      if (!want) return { error: 'Provide the name of the agent to run.' };
      const { data: rows } = await req.db!
        .from('agents').select('id, name, model, system_prompt').eq('org_id', orgId).limit(100);
      const list = (rows ?? []) as { id: string; name: string; model: string; system_prompt: string }[];
      // Exact (case-insensitive) match first, then a contains-match fallback.
      const lc = want.toLowerCase();
      const agent = list.find((a) => a.name.toLowerCase() === lc)
        ?? list.find((a) => a.name.toLowerCase().includes(lc) || lc.includes(a.name.toLowerCase()));
      if (!agent) {
        return { error: `No agent named "${want}". Existing agents: ${list.map((a) => a.name).join(', ') || '(none)'}.` };
      }
      try {
        const { output } = await executeInternalAgentRun(
          req, orgId,
          { id: agent.id, name: agent.name, model: agent.model, system_prompt: agent.system_prompt },
          { trigger: 'chat', onStep: onAgentStep },
        );
        return { ok: true, name: agent.name, output: output.slice(0, 6000) };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Agent run failed.' };
      }
    }
    if (name === 'create_widget') {
      const allowed = ['kpi', 'chart', 'table', 'insight', 'alert', 'embed', 'news'];
      const type = allowed.includes(String(input.type)) ? String(input.type) : 'insight';
      const nm = String(input.name ?? '').trim().slice(0, 120) || 'New widget';
      const prompt = String(input.prompt ?? '').trim().slice(0, 2000);
      const wid = randomUUID();
      const now = new Date().toISOString();
      // dashboard_id stays null — board-less widgets still appear on the Widgets
      // page (GET /widgets lists all org widgets) and can be added to a board later.
      const { data, error } = await req
        .db!.from('widgets')
        .insert({
          id: wid, org_id: orgId, dashboard_id: null, owner_id: req.user!.id,
          name: nm, type, html: null, prompt: prompt || null,
          grid_x: 0, grid_y: 0, grid_w: 2, grid_h: 2, sources: [], alert_rule: null,
          created_at: now, updated_at: now,
        })
        .select('id, name')
        .single();
      if (error) return { error: error.message };
      return {
        ok: true, id: (data as { id: string }).id, name: nm, type,
        url: `/app/${orgId}/widgets/${wid}`,
        note: 'Widget created and now visible on the Widgets page. Open it to generate the live visual from this prompt.',
      };
    }
    if (name === 'deploy_agent') {
      const provider = ['hermes', 'openclaw'].includes(String(input.provider)) ? String(input.provider) : null;
      if (!provider) return { error: "provider must be 'hermes' or 'openclaw'." };
      const mission = String(input.mission ?? '').trim();
      if (!mission) return { error: 'A mission is required to deploy an agent.' };
      const nm = String(input.name ?? '').trim().slice(0, 80) || `${provider === 'hermes' ? 'Hermes' : 'OpenClaw'} mission`;
      try {
        const { row, runtime } = await provisionExternalAgent(req.db!, {
          orgId, userId: req.user!.id, provider: provider as 'hermes' | 'openclaw',
          name: nm, mission, reason: String(input.reason ?? ''), deployedVia: 'chat',
        });
        return {
          ok: true, id: (row as { id: string }).id, name: nm, provider, runtime,
          note: runtime === 'orgo'
            ? 'Provisioning a real Orgo virtual computer and running the mission on it. Progress & results report back to DeepLogic central — watch it on the Agents page.'
            : 'VM is provisioning (simulated — connect Orgo in Settings → Integrations for real VMs). It will run the mission and report back on the Agents page.',
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Deploy failed.' };
      }
    }
    return { error: `Unknown tool: ${name}` };
  };
}

// Shared setup for both assistant endpoints: vault inventory + company profile
// + optional pre-fetched web context for the latest user message.
async function assistantContext(req: Request, orgId: string, rawMessages: ChatMsg[], webResearch: boolean) {
  const items = await loadContextItems(req.db!, orgId, req.user!.id);
  const inventory: VaultInventoryItem[] = items.map((it) => ({
    kind: it.kind, name: it.name,
    snippet: typeof it.content === 'string' ? it.content.slice(0, 200) : '',
  }));
  const profileItem = items.find((it) => (it.meta as Record<string, unknown> | undefined)?.companyProfile === true);
  const companyProfile = typeof profileItem?.content === 'string' ? profileItem.content : '';

  // The workspace's goals — so the assistant knows what the user is working toward.
  let goals: { title: string; plan: string[]; agents: { name: string; role: string }[]; status: string }[] = [];
  try {
    const { data } = await req.db!
      .from('goals').select('title, plan, agents, status')
      .eq('org_id', orgId).order('created_at', { ascending: false }).limit(50);
    goals = (data ?? []) as typeof goals;
  } catch { /* goals are optional context */ }

  // The workspace's existing agents — so the assistant can list and run them.
  let agents: { name: string; description: string; schedule: string | null }[] = [];
  try {
    const { data } = await req.db!
      .from('agents').select('name, description, schedule')
      .eq('org_id', orgId).order('created_at', { ascending: false }).limit(60);
    agents = (data ?? []) as typeof agents;
  } catch { /* agents are optional context */ }

  const lastUser = [...rawMessages].reverse().find((m) => m.role === 'user');
  let web: WebResult[] = [];
  if (webResearch && lastUser?.content) web = await webSearch(lastUser.content);
  const ai = await loadAiConfig(orgId).catch(() => null);

  // Ground the assistant in the memory graph: recall facts relevant to the last
  // user message (semantic when embeddings exist, keyword fallback otherwise).
  let memory: string[] = [];
  if (lastUser?.content) {
    const embedKey = resolveEmbeddingKey(ai);
    const facts = await recallMemory(req.db!, orgId, lastUser.content, 12, embedKey).catch(() => []);
    memory = facts.map((f) => f.statement);
  }
  return { inventory, companyProfile, web, ai, memory, goals, agents };
}

// GET status — platform health for the Settings → Status tab.
studioRouter.get(
  '/orgs/:orgId/status',
  requireMember(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    // Database reachability (lightweight query under the caller's RLS).
    let dbOk = false;
    try {
      const { error } = await req.db!.from('organizations').select('id').eq('id', orgId).limit(1);
      dbOk = !error;
    } catch { dbOk = false; }

    const ai = await loadAiConfig(orgId).catch(() => null);
    const braveKey = !!process.env.BRAVE_SEARCH_API_KEY;
    const anthropicEnv = !!process.env.ANTHROPIC_API_KEY;

    res.json({
      api: { ok: true },
      database: { ok: dbOk },
      auth: { ok: true }, // reaching this route means the JWT verified
      ai: {
        configured: !!ai,
        provider: ai?.provider ?? null,
        model: ai?.model ?? null,
        envKey: anthropicEnv,
      },
      webSearch: { mode: braveKey ? 'brave' : 'duckduckgo', ok: true },
      checkedAt: new Date().toISOString(),
    });
  }
);

// POST assistant/title { content } — a concise title for a markdown note.
studioRouter.post(
  '/orgs/:orgId/assistant/title',
  requireMember(),
  async (req: Request, res: Response) => {
    const content = ((req.body || {}).content ?? '').toString();
    if (!content.trim()) { res.status(400).json({ error: 'content is required' }); return; }
    try {
      const ai = await loadAiConfig(req.params.orgId).catch(() => null);
      const title = (await generateTitle(ai, content)) || heuristicTitle(content);
      res.json({ title });
    } catch {
      res.json({ title: heuristicTitle(content) });
    }
  }
);

// POST assistant/chat { messages, webResearch? } — non-streaming (one JSON reply).
studioRouter.post(
  '/orgs/:orgId/assistant/chat',
  requireMember(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const body = req.body || {};
    const rawMessages: ChatMsg[] = Array.isArray(body.messages) ? body.messages : [];
    if (rawMessages.length === 0) {
      res.status(400).json({ error: 'messages is required' });
      return;
    }
    try {
      const { inventory, companyProfile, web, ai, memory, goals, agents } = await assistantContext(req, orgId, rawMessages, !!body.webResearch);
      const executeTool = assistantToolExecutor(req, orgId);
      const reply = await runAssistant({ ai, inventory, messages: rawMessages, executeTool, web, companyProfile, memory, goals, agents });
      res.json({ ...reply, sources: web });
    } catch (err) {
      console.error('POST assistant/chat failed', err);
      res.status(500).json({ error: 'Assistant request failed.' });
    }
  }
);

// POST assistant/chat/stream { messages, webResearch? } — SSE. Streams the
// assistant's live "thinking" steps (tool decisions + interim reasoning) as it
// works, then a final { type:'done' } event with the answer and actions.
studioRouter.post(
  '/orgs/:orgId/assistant/chat/stream',
  requireMember(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const body = req.body || {};
    const rawMessages: ChatMsg[] = Array.isArray(body.messages) ? body.messages : [];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    if (rawMessages.length === 0) {
      send({ type: 'error', error: 'messages is required' });
      res.end();
      return;
    }
    try {
      if (body.webResearch) send({ type: 'step', icon: '🔍', text: 'Gathering initial web context' });
      const { inventory, companyProfile, web, ai, memory, goals, agents } = await assistantContext(req, orgId, rawMessages, !!body.webResearch);
      send({ type: 'step', icon: '🧭', text: 'Reviewing your Data Vault & company profile' });
      if (goals.length) send({ type: 'step', icon: '🎯', text: `Checking your ${goals.length} goal${goals.length === 1 ? '' : 's'}` });
      if (agents.length) send({ type: 'step', icon: '🤖', text: `Reviewing your ${agents.length} agent${agents.length === 1 ? '' : 's'}` });
      if (memory.length) send({ type: 'step', icon: '🧠', text: `Recalling ${memory.length} facts from memory` });
      const sendStep = (s: { icon: string; text: string }) => send({ type: 'step', ...s });
      const executeTool = assistantToolExecutor(req, orgId, sendStep);
      const reply = await runAssistant({
        ai, inventory, messages: rawMessages, executeTool, web, companyProfile, memory, goals, agents,
        onStep: sendStep,
      });
      send({ type: 'done', text: reply.text, actions: reply.actions ?? [], suggestions: reply.suggestions ?? [], usedAI: reply.usedAI, aiError: reply.aiError ?? null, sources: web });
      res.end();
    } catch (err) {
      console.error('POST assistant/chat/stream failed', err);
      send({ type: 'error', error: 'Assistant request failed.' });
      res.end();
    }
  }
);

// POST /orgs/:orgId/onboarding/run { website } — SSE. The guided-onboarding
// engine: it primes a fresh workspace from the company's website while streaming
// every AI decision live (company profile, website stats, competitors, memory).
studioRouter.post(
  '/orgs/:orgId/onboarding/run',
  requireMember(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const website = normalizeUrl((req.body?.website ?? '').toString());

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const step = (icon: string, text: string) => send({ type: 'step', icon, text });
    const detail = (text: string) => send({ type: 'detail', text });

    if (!website) { send({ type: 'error', error: 'Enter a valid website URL (e.g. https://acme.com).' }); res.end(); return; }
    const domain = (() => { try { return new URL(website).hostname.replace(/^www\./, ''); } catch { return website; } })();

    try {
      // New users won't have a provider key yet — fall back to the platform key
      // so onboarding is AI-powered out of the box.
      const ai = (await loadAiConfig(orgId).catch(() => null)) ?? serverFallbackAi();
      const embedKey = resolveEmbeddingKey(ai);

      // 1) Read the website.
      step('🌐', `Opening ${domain} and reading the site…`);
      let siteText = '', siteTitle = '';
      try { const s = await fetchSiteText(website); siteText = s.text; siteTitle = s.title; } catch { detail('Could not fully read the site — continuing with what we have.'); }
      if (siteTitle) detail(`Loaded “${siteTitle}”.`);

      // 2) Analyse the business + gather public stats in parallel.
      step('🧠', 'Analysing your business with AI…');
      const [age, web] = await Promise.all([
        rdapDomainAge(domain),
        webSearch(`${siteTitle || domain} company`, 6).catch(() => [] as WebResult[]),
      ]);
      const analysis = await analyzeUrl({ ai, siteText, siteTitle, url: website, lenses: ['company', 'competitive'], web });
      const companyName = analysis.sourceTitle || siteTitle || domain;
      send({ type: 'company', name: companyName, summary: analysis.company?.summary ?? '', facts: analysis.company?.facts ?? [] });
      if (analysis.company?.facts?.length) detail(`Extracted ${analysis.company.facts.length} company facts.`);

      step('📊', 'Gathering website stats & public presence…');
      send({ type: 'stats', domain, age, sources: web.slice(0, 5).map((w) => ({ title: w.title, url: w.url })) });
      if (age) detail(`Domain registered ${new Date(age.createdAt).toLocaleDateString()} (~${age.ageYears} yrs old).`);

      // 3) Save the company profile to the vault.
      step('💾', 'Saving your company profile to the Data Vault…');
      const profileLines = [
        `# ${companyName}`, website,
        analysis.company?.summary ? `\n${analysis.company.summary}` : '',
        ...(analysis.company?.facts ?? []).map((f) => `- ${f.label}: ${f.value}`),
      ].filter(Boolean);
      const profileText = profileLines.join('\n');
      await req.db!.from('context_items').insert({
        org_id: orgId, owner_id: req.user!.id, scope: 'org', kind: 'note',
        name: `Company: ${companyName}`, content: profileText,
        meta: { companyProfile: true, name: companyName, website }, enabled: true,
      });
      detail('Company profile added.');

      // 4) Discover competitors and track them.
      step('🔭', 'Discovering your competitors…');
      const comp = await suggestCompetitors({ ai, companyProfile: profileText });
      for (const c of comp.competitors) {
        const content = [`# Competitor — ${c.name}`, c.website ? `Website: ${c.website}` : '', c.reason ? `\n${c.reason}` : ''].filter(Boolean).join('\n');
        await req.db!.from('context_items').insert({
          org_id: orgId, owner_id: req.user!.id, scope: 'org', kind: 'note',
          name: `Competitor: ${c.name}`, content,
          meta: { competitor: true, name: c.name, website: c.website, summary: c.reason, notes: '' }, enabled: true,
        });
        send({ type: 'competitor', name: c.name, website: c.website, reason: c.reason });
      }
      detail(comp.competitors.length ? `Tracking ${comp.competitors.length} competitors.` : (comp.note || 'No competitors found yet.'));

      // 5) Seed the memory graph from everything we just learned.
      step('🕸', 'Building your memory graph…');
      if (ai) {
        try {
          const r = await ingestEpisode(req.db!, orgId, { sourceKind: 'onboarding', title: `Company: ${companyName}`, text: profileText }, ai, embedKey);
          detail(`Memory graph seeded — ${r.entities} entities, ${r.facts} facts.`);
        } catch { detail('Memory graph will build as you add data.'); }
      }

      step('✅', 'Your workspace is ready.');
      send({
        type: 'done',
        summary: { company: companyName, website, competitors: comp.competitors.length, domainAgeYears: age?.ageYears ?? null, sources: web.length, usedAI: analysis.usedAI },
      });
      res.end();
    } catch (err) {
      console.error('onboarding/run failed', err);
      send({ type: 'error', error: 'Onboarding hit a snag — you can still finish and explore your workspace.' });
      res.end();
    }
  }
);

// POST /api/onboarding/analyze { website } — PUBLIC (no auth). Streams the AI
// learning the business from its website WITHOUT saving anything. The prospect
// watches the live monitor; we only persist once they claim a workspace.
onboardingPublicRouter.post('/onboarding/analyze', async (req: Request, res: Response) => {
  const website = normalizeUrl((req.body?.website ?? '').toString());

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const step = (icon: string, text: string) => send({ type: 'step', icon, text });
  const detail = (text: string) => send({ type: 'detail', text });

  if (!website) { send({ type: 'error', error: 'Enter a valid website URL (e.g. https://acme.com).' }); res.end(); return; }
  const domain = (() => { try { return new URL(website).hostname.replace(/^www\./, ''); } catch { return website; } })();
  // No org yet → use the platform server key for AI (any provider; graceful if absent).
  const ai = serverFallbackAi();

  try {
    step('🌐', `Opening ${domain} and reading the site…`);
    let siteText = '', siteTitle = '';
    try { const s = await fetchSiteText(website); siteText = s.text; siteTitle = s.title; } catch { detail('Could not fully read the site — continuing.'); }
    if (siteTitle) detail(`Loaded “${siteTitle}”.`);

    step('🧠', 'Analysing your business with AI…');
    const [age, web] = await Promise.all([
      rdapDomainAge(domain),
      webSearch(`${siteTitle || domain} company`, 6).catch(() => [] as WebResult[]),
    ]);
    const analysis = await analyzeUrl({ ai, siteText, siteTitle, url: website, lenses: ['company', 'competitive', 'products', 'metrics'], web });
    const companyName = analysis.sourceTitle || siteTitle || domain;
    send({ type: 'company', name: companyName, summary: analysis.company?.summary ?? '', facts: analysis.company?.facts ?? [] });
    if (analysis.company?.facts?.length) detail(`Extracted ${analysis.company.facts.length} company facts.`);

    step('📊', 'Gathering website stats & public presence…');
    send({ type: 'stats', domain, age, sources: web.slice(0, 5).map((w) => ({ title: w.title, url: w.url })) });
    if (age) detail(`Domain registered ${new Date(age.createdAt).toLocaleDateString()} (~${age.ageYears} yrs old).`);

    step('🛍', 'Cataloguing what they sell…');
    const products = analysis.products?.products ?? [];
    for (const p of products) send({ type: 'product', name: p.name, description: p.description });
    detail(products.length ? `Catalogued ${products.length} product${products.length === 1 ? '' : 's'}.` : 'No distinct products identified.');

    step('🔭', 'Discovering your competitors…');
    const profileText = [`# ${companyName}`, website, analysis.company?.summary ?? '', ...(analysis.company?.facts ?? []).map((f) => `- ${f.label}: ${f.value}`)].filter(Boolean).join('\n');
    const comp = await suggestCompetitors({ ai, companyProfile: profileText });
    for (const c of comp.competitors) send({ type: 'competitor', name: c.name, website: c.website, reason: c.reason });
    detail(comp.competitors.length ? `Found ${comp.competitors.length} competitors.` : (comp.note || 'No competitors found yet.'));

    step('🤖', 'Designing a starter agent team…');
    const agents = analysis.metrics?.agents ?? [];
    for (const a of agents) send({ type: 'agent', name: a.name, description: a.description, model: a.model, systemPrompt: a.systemPrompt, schedule: a.schedule });
    detail(agents.length ? `Drafted ${agents.length} agent${agents.length === 1 ? '' : 's'} for your workspace.` : 'No agents drafted.');

    step('✅', 'Done — activate your workspace to put it to work.');
    send({
      type: 'done',
      summary: {
        company: companyName, website, competitors: comp.competitors.length,
        products: products.length, agents: agents.length,
        domainAgeYears: age?.ageYears ?? null, sources: web.length, usedAI: analysis.usedAI,
      },
    });
    res.end();
  } catch (err) {
    console.error('onboarding/analyze failed', err);
    send({ type: 'error', error: 'Analysis hit a snag — you can still claim a workspace and explore.' });
    res.end();
  }
});

// POST /api/onboarding/scan-powerbi { dataBase64, filename } — PUBLIC. Parses a
// Power BI export and returns the connectors / tables / measures it detects,
// WITHOUT saving anything — drives live feedback on the onboarding upload step.
onboardingPublicRouter.post('/onboarding/scan-powerbi', async (req: Request, res: Response) => {
  const body = (req.body || {}) as { dataBase64?: string; filename?: string };
  if (!body.dataBase64) { res.status(400).json({ error: 'No file data.' }); return; }
  try {
    const result = await ingestVaultItem({ dataBase64: body.dataBase64, filename: body.filename, name: body.filename });
    const profile = result.profile as {
      tableCount?: number; measureCount?: number; pages?: string[];
      tables?: { name: string; columns?: string[]; measures?: string[] }[];
      sources?: { name: string; kind: string }[];
    };
    const meta = result.meta as { connectors?: { name: string; kind: string }[] };
    const connectors = (profile.sources?.length ? profile.sources : (Array.isArray(meta.connectors) ? meta.connectors : []));
    const tables = (profile.tables ?? []).map((t) => ({
      name: t.name, columns: t.columns ?? [], measures: t.measures ?? [],
    }));
    const tableCount = profile.tableCount ?? tables.length;
    const measureCount = profile.measureCount ?? 0;
    res.json({
      // ok = we actually parsed Power BI internals (not just a .pbit extension).
      ok: result.category === 'powerbi' && (connectors.length > 0 || tableCount > 0 || measureCount > 0),
      name: result.name,
      connectors, tables, tableCount, measureCount,
      pages: profile.pages ?? [],
    });
  } catch (err) {
    console.error('scan-powerbi failed', err);
    res.status(500).json({ error: 'Could not read this file.' });
  }
});

// POST /orgs/:orgId/onboarding/persist — authenticated. Saves the data gathered
// anonymously (company profile, competitors) + seeds memory. No AI re-analysis.
studioRouter.post('/orgs/:orgId/onboarding/persist', requireMember(), async (req: Request, res: Response) => {
  const orgId = req.params.orgId;
  const body = (req.body || {}) as {
    website?: string;
    company?: { name?: string; summary?: string; facts?: { label: string; value: string }[] };
    competitors?: { name: string; website?: string; reason?: string }[];
    products?: { name: string; description?: string }[];
    agents?: { name: string; description?: string; model?: string; systemPrompt?: string; schedule?: string | null }[];
  };
  const website = (body.website ?? '').toString();
  const companyName = (body.company?.name ?? website ?? 'My company').toString().slice(0, 120);
  const AGENT_MODELS = new Set(['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001', 'gpt-4o', 'gpt-4o-mini']);
  const SCHEDULES = new Set(['0 * * * *', '0 9 * * *', '0 9 * * 1', '0 9 1 * *']);
  try {
    const profileText = [
      `# ${companyName}`, website,
      body.company?.summary ? `\n${body.company.summary}` : '',
      ...(body.company?.facts ?? []).map((f) => `- ${f.label}: ${f.value}`),
    ].filter(Boolean).join('\n');

    await req.db!.from('context_items').insert({
      org_id: orgId, owner_id: req.user!.id, scope: 'org', kind: 'note',
      name: `Company: ${companyName}`, content: profileText,
      meta: { companyProfile: true, name: companyName, website }, enabled: true,
    });

    for (const c of (body.competitors ?? []).slice(0, 12)) {
      const content = [`# Competitor — ${c.name}`, c.website ? `Website: ${c.website}` : '', c.reason ? `\n${c.reason}` : ''].filter(Boolean).join('\n');
      await req.db!.from('context_items').insert({
        org_id: orgId, owner_id: req.user!.id, scope: 'org', kind: 'note',
        name: `Competitor: ${c.name}`, content,
        meta: { competitor: true, name: c.name, website: c.website ?? '', summary: c.reason ?? '', notes: '' }, enabled: true,
      });
    }

    // Products → vault (grounds reports, widgets, agents & the assistant).
    const products = (body.products ?? []).slice(0, 12).filter((p) => p.name?.trim());
    for (const p of products) {
      const content = [`# Product — ${p.name}`, p.description ? `\n${p.description}` : ''].filter(Boolean).join('\n');
      await req.db!.from('context_items').insert({
        org_id: orgId, owner_id: req.user!.id, scope: 'org', kind: 'note',
        name: `Product: ${p.name}`, content,
        meta: { product: true, name: p.name, description: p.description ?? '' }, enabled: true,
      });
    }

    // Starter agents — drafted from the gathered material.
    const agentRows = (body.agents ?? []).slice(0, 6)
      .filter((a) => a.name?.trim() && a.systemPrompt?.trim())
      .map((a) => ({
        org_id: orgId, created_by: req.user!.id,
        name: a.name.trim().slice(0, 80), description: (a.description ?? '').trim().slice(0, 240),
        model: AGENT_MODELS.has(String(a.model)) ? a.model : 'claude-sonnet-4-6',
        system_prompt: (a.systemPrompt ?? '').slice(0, 8000),
        schedule: a.schedule && SCHEDULES.has(a.schedule) ? a.schedule : null,
      }));
    if (agentRows.length) { try { await req.db!.from('agents').insert(agentRows); } catch { /* best-effort */ } }

    // Starter dashboard — a Company Overview board with seeded widgets.
    let dashboardId: string | null = null;
    try {
      const dashId = randomUUID();
      const slug = `company-overview-${dashId.slice(0, 6)}`;
      const { data: board } = await req.db!.from('dashboards').insert({
        id: dashId, org_id: orgId, owner_id: req.user!.id, name: `${companyName} — Overview`,
        slug, description: 'Auto-created from your onboarding analysis.', group_name: 'Company',
      }).select('id').single();
      dashboardId = (board as { id: string } | null)?.id ?? null;
      if (dashboardId) {
        const now = new Date().toISOString();
        const widgets = [
          { name: `${companyName} — Snapshot`, type: 'insight', prompt: `Write an executive snapshot of ${companyName} using the company profile in the workspace context.`, grid_x: 0, grid_y: 0, grid_w: 4, grid_h: 2 },
          { name: 'Competitor landscape', type: 'table', prompt: 'A table of our tracked competitors: what they do and how they compare to us.', grid_x: 4, grid_y: 0, grid_w: 2, grid_h: 2 },
          ...(products.length ? [{ name: 'Product lineup', type: 'insight', prompt: 'Summarise our product lineup and positioning, using the products in the workspace context.', grid_x: 0, grid_y: 2, grid_w: 3, grid_h: 2 }] : []),
        ];
        for (const w of widgets) {
          try {
            await req.db!.from('widgets').insert({
              id: randomUUID(), org_id: orgId, dashboard_id: dashboardId, owner_id: req.user!.id,
              name: w.name, type: w.type, html: null, prompt: w.prompt,
              grid_x: w.grid_x, grid_y: w.grid_y, grid_w: w.grid_w, grid_h: w.grid_h,
              sources: [], alert_rule: null, created_at: now, updated_at: now,
            });
          } catch { /* skip a failed widget */ }
        }
      }
    } catch { /* best-effort — dashboard is a bonus */ }

    // Seed the memory graph from company + products (best-effort).
    const ai = (await loadAiConfig(orgId).catch(() => null)) ?? serverFallbackAi();
    if (ai) {
      const memText = [profileText, products.length ? `\n## Products\n${products.map((p) => `- ${p.name}: ${p.description ?? ''}`).join('\n')}` : ''].filter(Boolean).join('\n');
      try { await ingestEpisode(req.db!, orgId, { sourceKind: 'onboarding', title: `Company: ${companyName}`, text: memText }, ai, resolveEmbeddingKey(ai)); } catch { /* best-effort */ }
    }

    res.json({
      ok: true, company: companyName,
      competitors: (body.competitors ?? []).length, products: products.length,
      agents: agentRows.length, dashboardId,
    });
  } catch (err) {
    console.error('onboarding/persist failed', err);
    res.status(500).json({ error: 'Failed to save your workspace data.' });
  }
});

// GET ai/openrouter-balance — live OpenRouter credit balance for the header.
// Uses the org's stored OpenRouter key (read server-side; never sent to client).
studioRouter.get(
  '/orgs/:orgId/ai/openrouter-balance',
  requireMember(),
  async (req: Request, res: Response) => {
    try {
      const row = await loadAiRow(req.params.orgId);
      const key = row?.providers?.openrouter?.apiKey;
      if (!key) { res.json({ configured: false }); return; }
      const r = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) { res.json({ configured: true, error: `OpenRouter ${r.status}` }); return; }
      const data = (await r.json()) as { data?: { total_credits?: number; total_usage?: number } };
      const totalCredits = data.data?.total_credits ?? 0;
      const totalUsage = data.data?.total_usage ?? 0;
      res.json({ configured: true, totalCredits, totalUsage, remaining: totalCredits - totalUsage });
    } catch (err) {
      res.json({ configured: true, error: err instanceof Error ? err.message : 'Failed' });
    }
  }
);

// POST suggest-competitors — propose competitors from the company profile.
studioRouter.post(
  '/orgs/:orgId/studio/suggest-competitors',
  requireMember(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const existing = Array.isArray((req.body || {}).existing) ? (req.body.existing as string[]) : [];
    try {
      const items = await loadContextItems(req.db!, orgId, req.user!.id);
      const profileItem = items.find((it) => (it.meta as Record<string, unknown> | undefined)?.companyProfile === true);
      const companyProfile = typeof profileItem?.content === 'string' ? profileItem.content : '';
      const ai = await loadAiConfig(orgId).catch(() => null);
      const result = await suggestCompetitors({ ai, companyProfile, existing });
      res.json(result);
    } catch (err) {
      console.error('POST studio suggest-competitors failed', err);
      res.status(500).json({ error: 'Failed to suggest competitors.' });
    }
  }
);

// POST suggest-ideas { target: 'report'|'widget', widgetType? } — propose
// valuable reports/widgets grounded in the org's Data Vault inventory.
studioRouter.post(
  '/orgs/:orgId/studio/suggest-ideas',
  requireMember(),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const target = parseTarget((req.body || {}).target);
    try {
      const items = await loadContextItems(req.db!, orgId, req.user!.id);
      const inventory: VaultInventoryItem[] = items.map((it) => ({
        kind: it.kind,
        name: it.name,
        snippet: typeof it.content === 'string' ? it.content.slice(0, 200) : '',
      }));
      const ai = await loadAiConfig(orgId).catch(() => null);
      const result = await suggestIdeas({ ai, inventory, target });
      res.json(result);
    } catch (err) {
      console.error('POST studio suggest-ideas failed', err);
      res.status(500).json({ error: 'Failed to suggest ideas.' });
    }
  }
);

// PATCH context/:id {enabled?, name?, content?, scope?, meta?}
studioRouter.patch(
  '/orgs/:orgId/studio/context/:id',
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId, id } = req.params;
    const body = req.body || {};
    const patch: Record<string, unknown> = {};
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.name === 'string') patch.name = body.name.trim();
    if (typeof body.content === 'string') patch.content = body.content;
    if (typeof body.scope === 'string') {
      if (!['user', 'org'].includes(body.scope)) {
        res.status(400).json({ error: 'Invalid scope' });
        return;
      }
      patch.scope = body.scope;
    }
    if (body.meta && typeof body.meta === 'object') patch.meta = body.meta;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }
    try {
      const { data, error } = await req
        .db!.from('context_items')
        .update(patch)
        .eq('org_id', orgId)
        .eq('id', id)
        .select(CONTEXT_COLS)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        res.status(404).json({ error: 'Context item not found' });
        return;
      }
      res.json(mapContext(data as ContextRow, req.user!.id));
    } catch (err) {
      console.error('PATCH studio context failed', err);
      res.status(500).json({ error: 'Failed to update context item' });
    }
  }
);

// DELETE context/:id
studioRouter.delete(
  '/orgs/:orgId/studio/context/:id',
  requireMember(),
  async (req: Request, res: Response) => {
    try {
      const { error } = await req
        .db!.from('context_items')
        .delete()
        .eq('org_id', req.params.orgId)
        .eq('id', req.params.id);
      if (error) throw new Error(error.message);
      res.status(204).end();
    } catch (err) {
      console.error('DELETE studio context failed', err);
      res.status(500).json({ error: 'Failed to delete context item' });
    }
  }
);

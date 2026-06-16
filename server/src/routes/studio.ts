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
import type { Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireMember, requireRole, callerRole, checkReportLimit, checkTokenBudget, requireFeature } from '../auth.js';
import { logUsageEvent } from '../billing.js';
import { getModel } from '../repo.js';
import { serviceClient } from '../supabase.js';
import { compileContext } from '../studio/context.js';
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
  updated_at: string;
}

interface ProjectListRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  visibility: StudioProject['visibility'];
  html: string | null;
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
  'id, org_id, owner_id, name, slug, visibility, html, model_id, messages, versions, vault, updated_at';
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
        .select('id, owner_id, name, slug, visibility, html, updated_at')
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
async function loadAiConfig(orgId: string): Promise<AiConfig | null> {
  const row = await loadAiRow(orgId);
  if (!row) return null;
  const active = row.provider || 'anthropic';
  const entry = (row.providers ?? {})[active];
  if (!entry?.apiKey) return null;
  return { provider: active, apiKey: entry.apiKey, model: entry.model || undefined };
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

      const context = await compileContext(items, model, project.vault ?? []);
      const history = project.messages ?? [];
      const ai = await loadAiConfig(orgId).catch(() => null);

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
      }));

      res.json({ connectors: finishC, documents: finishD });
    } catch (err) {
      console.error('GET vault failed', err);
      res.status(500).json({ error: 'Failed to load the workspace vault' });
    }
  }
);

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
    if (!['doc', 'html', 'mcp', 'note', 'image'].includes(kind)) {
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
    } catch (err) {
      console.error('POST studio context failed', err);
      res.status(500).json({ error: 'Failed to create context item' });
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

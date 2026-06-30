// Innovation Lab routes — vibecode static web tools in e2b sandboxes with a
// coding agent, persist files in the DB (source of truth), rehydrate the sandbox
// on demand. Garden publish is a thin flag on top (full wall lands later).
//
//   GET    /orgs/:orgId/innovation/projects?scope=mine|garden
//   POST   /orgs/:orgId/innovation/projects            { brief, engine?, name? }
//   GET    /orgs/:orgId/innovation/projects/:id
//   POST   /orgs/:orgId/innovation/projects/:id/chat   { message }  -> agent builds
//   POST   /orgs/:orgId/innovation/projects/:id/sandbox            -> resume + preview
//   POST   /orgs/:orgId/innovation/projects/:id/publish { tagline?, tags? }
//   DELETE /orgs/:orgId/innovation/projects/:id

import { Router, type Request, type Response } from 'express';
import { Sandbox } from 'e2b';
import { requireMember } from '../auth.js';
import { loadAiConfig } from './studio.js';
import { runCodingAgent, type SandboxOps, type AgentChatMsg } from '../innovation/codingAgent.js';

export const innovationRouter = Router();

const E2B_KEY = process.env.E2B_API_KEY ?? '';
const SBX_TIMEOUT_MS = 10 * 60 * 1000; // 10 min idle
const APP_DIR = '/home/user/app';
const PORT = 3000;
const sbxOpts = () => ({ apiKey: E2B_KEY, timeoutMs: SBX_TIMEOUT_MS });

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ProjectRow {
  id: string; org_id: string; owner_id: string; name: string; brief: string; engine: string;
  files: Record<string, string> | null; entry_cmd: string; port: number;
  sandbox_id: string | null; preview_url: string | null; status: string;
  messages: { role: string; content: string; ts: string }[] | null;
  published: boolean; featured: boolean; tagline: string; tags: string[] | null;
  stars: number; fork_of: string | null; data_access: string[] | null;
  created_at: string; updated_at: string;
}

const COLS =
  'id, org_id, owner_id, name, brief, engine, files, entry_cmd, port, sandbox_id, preview_url, status, messages, published, featured, tagline, tags, stars, fork_of, data_access, created_at, updated_at';

function mapProject(r: ProjectRow, userId: string) {
  return {
    id: r.id, name: r.name, brief: r.brief, engine: r.engine,
    files: r.files ?? {}, previewUrl: r.preview_url, status: r.status,
    messages: r.messages ?? [], published: r.published, featured: r.featured,
    tagline: r.tagline, tags: r.tags ?? [], stars: r.stars, forkOf: r.fork_of,
    dataSources: r.data_access ?? [],
    isOwner: r.owner_id === userId, updatedAt: r.updated_at,
  };
}

async function loadProject(db: any, orgId: string, id: string): Promise<ProjectRow | null> {
  const { data } = await db.from('innovation_projects').select(COLS).eq('org_id', orgId).eq('id', id).maybeSingle();
  return (data as ProjectRow | null) ?? null;
}

// Connect to the project's sandbox if still alive, else create a fresh one and
// rehydrate it from the persisted files. Returns the live handle + its id.
async function ensureSandbox(project: ProjectRow): Promise<{ sbx: Sandbox; sandboxId: string }> {
  if (project.sandbox_id) {
    try {
      const sbx = await Sandbox.connect(project.sandbox_id, sbxOpts());
      return { sbx, sandboxId: project.sandbox_id };
    } catch { /* expired — make a new one */ }
  }
  const sbx = await Sandbox.create(sbxOpts());
  for (const [path, content] of Object.entries(project.files ?? {})) {
    await sbx.files.write(`${APP_DIR}/${path.replace(/^\/+/, '')}`, content);
  }
  return { sbx, sandboxId: sbx.sandboxId };
}

// Start the static file server (idempotent — ignore "already bound") and return
// the public preview URL.
async function startPreview(sbx: Sandbox): Promise<string> {
  try {
    await sbx.commands.run(
      `mkdir -p ${APP_DIR} && cd ${APP_DIR} && (python3 -m http.server ${PORT} > /tmp/serve.log 2>&1 &)`,
      { background: true },
    );
  } catch { /* server may already be running */ }
  await new Promise((r) => setTimeout(r, 400));
  return `https://${sbx.getHost(PORT)}`;
}

// GET projects — ?scope=garden lists published tools across the org; default lists the caller's own.
innovationRouter.get('/orgs/:orgId/innovation/projects', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const scope = String(req.query.scope ?? 'mine');
  try {
    let q = req.db!.from('innovation_projects').select(COLS).eq('org_id', orgId);
    q = scope === 'garden'
      ? q.eq('published', true).order('featured', { ascending: false }).order('stars', { ascending: false })
      : q.eq('owner_id', req.user!.id).order('updated_at', { ascending: false });
    const { data, error } = await q.limit(100);
    if (error) throw new Error(error.message);
    res.json({ projects: ((data ?? []) as ProjectRow[]).map((p) => mapProject(p, req.user!.id)) });
  } catch (err) {
    console.error('innovation list failed', err);
    res.status(500).json({ error: 'Failed to load projects' });
  }
});

// POST projects — create a draft (no sandbox yet; first chat builds it).
innovationRouter.post('/orgs/:orgId/innovation/projects', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const brief = (req.body?.brief ?? '').toString().trim();
  const engine = ['claude', 'gemini', 'codex', 'openrouter'].includes(req.body?.engine) ? req.body.engine : 'claude';
  if (!brief) { res.status(400).json({ error: 'A brief is required' }); return; }
  const name = (req.body?.name ?? '').toString().trim() || brief.slice(0, 48);
  try {
    const { data, error } = await req.db!.from('innovation_projects')
      .insert({ org_id: orgId, owner_id: req.user!.id, name, brief, engine, status: 'draft' })
      .select(COLS).single();
    if (error) throw new Error(error.message);
    res.status(201).json(mapProject(data as ProjectRow, req.user!.id));
  } catch (err) {
    console.error('innovation create failed', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

innovationRouter.get('/orgs/:orgId/innovation/projects/:id', requireMember(), async (req: Request, res: Response) => {
  try {
    const p = await loadProject(req.db!, req.params.orgId, req.params.id);
    if (!p) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json(mapProject(p, req.user!.id));
  } catch (err) {
    console.error('innovation get failed', err);
    res.status(500).json({ error: 'Failed to load project' });
  }
});

// Grounding: when the project has SELECTED Data Vault sources, inline their full
// content (docs) / connector descriptors (MCP/API) so the agent builds against
// them. Otherwise just list what's available by name.
async function buildContext(db: any, orgId: string, sourceIds?: string[]): Promise<string> {
  try {
    if (sourceIds && sourceIds.length) {
      // Connector sources (databases / APIs) carry their descriptor inline as
      // `conn:<json>`; context-library items are plain ids.
      const connEntries = sourceIds.filter((s) => typeof s === 'string' && s.startsWith('conn:'));
      const ctxIds = sourceIds.filter((s) => typeof s === 'string' && !s.startsWith('conn:'));
      const parts: string[] = ['# Selected Data Vault sources — build the tool against these:'];
      if (ctxIds.length) {
        const { data } = await db.from('context_items')
          .select('name, kind, content, meta').eq('org_id', orgId).in('id', ctxIds).limit(40);
        for (const r of (data ?? []) as { name: string; kind: string; content: string | null; meta: any }[]) {
          const meta = r.meta ?? {};
          if (r.kind === 'mcp') {
            const url = typeof meta.url === 'string' ? meta.url : '';
            const desc = typeof meta.description === 'string' ? meta.description : (r.content ?? '');
            parts.push(`## ${r.name} — MCP${url ? ` (${url})` : ''}${desc ? `\n${desc}` : ''}`);
          } else {
            parts.push(`## ${r.name}`);
            if (r.content) parts.push('```\n' + r.content.slice(0, 6000) + '\n```');
          }
        }
      }
      const DB_RE = /postgres|mysql|supabase|snowflake|bigquery|redshift|oracle|mssql|sqlserver|mariadb|mongodb|databricks|db2|sap/i;
      for (const e of connEntries) {
        try {
          const d = JSON.parse(e.slice(5)) as { name?: string; kind?: string; url?: string; sourceName?: string };
          const isDb = !!d.kind && DB_RE.test(d.kind);
          parts.push(`## ${d.name} — ${isDb ? 'database' : 'API'}${d.kind ? ` (${d.kind})` : ''}${d.url ? ` · ${d.url}` : ''}${d.sourceName ? ` · from ${d.sourceName}` : ''}`);
          if (isDb) parts.push('Build the tool to query this database via its connector; if credentials are required, prompt the user to supply the connection.');
        } catch { /* skip malformed */ }
      }
      return parts.length > 1 ? parts.join('\n') : '';
    }
    const { data } = await db.from('context_items').select('name, kind').eq('org_id', orgId).eq('enabled', true).limit(40);
    const rows = (data ?? []) as { name: string; kind: string }[];
    if (!rows.length) return '';
    return 'Available data in the workspace Data Vault:\n' + rows.map((r) => `- [${r.kind}] ${r.name}`).join('\n');
  } catch { return ''; }
}

// POST chat — run the coding agent against the (rehydrated) sandbox.
innovationRouter.post('/orgs/:orgId/innovation/projects/:id/chat', requireMember(), async (req: Request, res: Response) => {
  const { orgId, id } = req.params;
  const message = (req.body?.message ?? '').toString().trim();
  if (!message) { res.status(400).json({ error: 'A message is required' }); return; }
  if (!E2B_KEY) { res.status(503).json({ error: 'Sandboxes are not configured (missing E2B_API_KEY).' }); return; }
  try {
    const project = await loadProject(req.db!, orgId, id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    const ai = await loadAiConfig(orgId).catch(() => null);
    if (!ai) { res.status(400).json({ error: 'Connect an AI provider in Settings → AI to build.' }); return; }

    const { sbx, sandboxId } = await ensureSandbox(project);

    // Files map mirrors the sandbox and becomes the persisted source of truth.
    const files: Record<string, string> = { ...(project.files ?? {}) };
    const ops: SandboxOps = {
      async writeFile(p, content) {
        const path = p.replace(/^\/+/, '');
        files[path] = content;
        await sbx.files.write(`${APP_DIR}/${path}`, content);
      },
      async readFile(p) { return files[p.replace(/^\/+/, '')] ?? ''; },
      async listFiles() { return Object.keys(files); },
    };

    const history: AgentChatMsg[] = (project.messages ?? [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const context = await buildContext(req.db!, orgId, project.data_access ?? undefined);
    const result = await runCodingAgent(ai, ops, { brief: project.brief, context, message, history });

    const previewUrl = Object.keys(files).length ? await startPreview(sbx) : project.preview_url;
    const now = new Date().toISOString();
    const messages = [
      ...(project.messages ?? []),
      { role: 'user', content: message, ts: now },
      { role: 'assistant', content: result.reply, ts: now },
    ].slice(-40);

    const { data, error } = await req.db!.from('innovation_projects').update({
      files, messages, sandbox_id: sandboxId, preview_url: previewUrl,
      status: Object.keys(files).length ? 'running' : 'draft', updated_at: now,
    }).eq('org_id', orgId).eq('id', id).select(COLS).single();
    if (error) throw new Error(error.message);

    res.json({ project: mapProject(data as ProjectRow, req.user!.id), reply: result.reply, steps: result.steps, touched: result.touched });
  } catch (err) {
    console.error('innovation chat failed', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Build failed' });
  }
});

// POST sandbox — resume (rehydrate) and return a fresh preview URL.
innovationRouter.post('/orgs/:orgId/innovation/projects/:id/sandbox', requireMember(), async (req: Request, res: Response) => {
  const { orgId, id } = req.params;
  if (!E2B_KEY) { res.status(503).json({ error: 'Sandboxes are not configured (missing E2B_API_KEY).' }); return; }
  try {
    const project = await loadProject(req.db!, orgId, id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    const { sbx, sandboxId } = await ensureSandbox(project);
    const previewUrl = await startPreview(sbx);
    await req.db!.from('innovation_projects')
      .update({ sandbox_id: sandboxId, preview_url: previewUrl, status: 'running', updated_at: new Date().toISOString() })
      .eq('org_id', orgId).eq('id', id);
    res.json({ previewUrl, sandboxId, status: 'running' });
  } catch (err) {
    console.error('innovation sandbox failed', err);
    res.status(500).json({ error: 'Failed to start sandbox' });
  }
});

// POST publish — flip the project onto the org garden wall.
innovationRouter.post('/orgs/:orgId/innovation/projects/:id/publish', requireMember(), async (req: Request, res: Response) => {
  const { orgId, id } = req.params;
  const tagline = (req.body?.tagline ?? '').toString().trim().slice(0, 200);
  const tags = Array.isArray(req.body?.tags)
    ? (req.body.tags as unknown[]).map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
    : [];
  try {
    const { data, error } = await req.db!.from('innovation_projects')
      .update({ published: true, ...(tagline ? { tagline } : {}), ...(tags.length ? { tags } : {}), updated_at: new Date().toISOString() })
      .eq('org_id', orgId).eq('id', id).eq('owner_id', req.user!.id).select(COLS).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json(mapProject(data as ProjectRow, req.user!.id));
  } catch (err) {
    console.error('innovation publish failed', err);
    res.status(500).json({ error: 'Failed to publish' });
  }
});

// POST sources — set which Data Vault items ground this project's builds.
innovationRouter.post('/orgs/:orgId/innovation/projects/:id/sources', requireMember(), async (req: Request, res: Response) => {
  const { orgId, id } = req.params;
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map((x) => String(x)).slice(0, 50) : [];
  try {
    const { data, error } = await req.db!.from('innovation_projects')
      .update({ data_access: ids, updated_at: new Date().toISOString() })
      .eq('org_id', orgId).eq('id', id).select(COLS).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json(mapProject(data as ProjectRow, req.user!.id));
  } catch (err) {
    console.error('innovation sources failed', err);
    res.status(500).json({ error: 'Failed to update data sources' });
  }
});

innovationRouter.delete('/orgs/:orgId/innovation/projects/:id', requireMember(), async (req: Request, res: Response) => {
  const { orgId, id } = req.params;
  try {
    const project = await loadProject(req.db!, orgId, id);
    if (project?.sandbox_id) {
      try { const sbx = await Sandbox.connect(project.sandbox_id, sbxOpts()); await sbx.kill(); } catch { /* already dead */ }
    }
    await req.db!.from('innovation_projects').delete().eq('org_id', orgId).eq('id', id);
    res.status(204).end();
  } catch (err) {
    console.error('innovation delete failed', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});
/* eslint-enable @typescript-eslint/no-explicit-any */

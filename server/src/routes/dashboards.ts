// Signal Dashboards — CRUD for dashboards + widgets, plus AI widget generation.
// Widgets are vibe-coded: a prompt + data sources → self-contained HTML cell.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { requireMember, checkTokenBudget } from '../auth.js';
import { serviceClient } from '../supabase.js';
import { generateReport, type AiConfig, type AiProvider } from '../studio/generator.js';

async function loadAiConfig(orgId: string): Promise<AiConfig | null> {
  const { data } = await serviceClient
    .from('org_ai_settings')
    .select('provider, providers')
    .eq('org_id', orgId)
    .maybeSingle();
  if (!data) return null;
  const active: AiProvider = (data.provider as AiProvider) || 'anthropic';
  const entry = ((data.providers ?? {}) as Record<string, { apiKey?: string; model?: string }>)[active];
  if (!entry?.apiKey) return null;
  return { provider: active, apiKey: entry.apiKey, model: entry.model || undefined };
}

export const dashboardsRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'dashboard';
}

async function loadDashboard(db: Request['db'], orgId: string, id: string) {
  const { data } = await db!
    .from('dashboards')
    .select('*')
    .eq('org_id', orgId)
    .eq('id', id)
    .maybeSingle();
  return data;
}

// ---------------------------------------------------------------------------
// Dashboards CRUD
// ---------------------------------------------------------------------------

// GET /orgs/:orgId/dashboards
dashboardsRouter.get('/orgs/:orgId/dashboards', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  try {
    const { data: boards, error } = await req.db!
      .from('dashboards')
      .select('*')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);

    // count widgets per dashboard
    const ids = (boards ?? []).map((b) => b.id);
    let counts: Record<string, number> = {};
    if (ids.length) {
      const { data: wData } = await req.db!
        .from('widgets')
        .select('dashboard_id')
        .in('dashboard_id', ids);
      for (const w of wData ?? []) {
        counts[w.dashboard_id] = (counts[w.dashboard_id] ?? 0) + 1;
      }
    }

    res.json((boards ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      visibility: b.visibility,
      description: b.description,
      group: b.group_name ?? null,
      ownerId: b.owner_id,
      isOwner: b.owner_id === req.user!.id,
      widgetCount: counts[b.id] ?? 0,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    })));
  } catch (err) {
    console.error('GET dashboards failed', err);
    res.status(500).json({ error: 'Failed to load dashboards' });
  }
});

// POST /orgs/:orgId/dashboards { name, description? }
dashboardsRouter.post('/orgs/:orgId/dashboards', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const { name, description, group } = req.body ?? {};
  if (!name?.trim()) { res.status(400).json({ error: 'Name required' }); return; }

  let slug = slugify(name.trim());
  // ensure uniqueness
  const { data: existing } = await req.db!.from('dashboards').select('slug').eq('org_id', orgId).like('slug', `${slug}%`);
  const taken = new Set((existing ?? []).map((r) => r.slug));
  let candidate = slug;
  let n = 2;
  while (taken.has(candidate)) { candidate = `${slug}-${n++}`; }
  slug = candidate;

  try {
    const { data, error } = await req.db!
      .from('dashboards')
      .insert({ id: randomUUID(), org_id: orgId, owner_id: req.user!.id, name: name.trim(), slug, description: description?.trim() || null, group_name: (typeof group === 'string' && group.trim()) ? group.trim() : null })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    res.status(201).json({
      id: data.id, name: data.name, slug: data.slug, visibility: data.visibility,
      description: data.description, group: data.group_name ?? null, ownerId: data.owner_id, isOwner: true, widgetCount: 0,
      createdAt: data.created_at, updatedAt: data.updated_at,
    });
  } catch (err) {
    console.error('POST dashboard failed', err);
    res.status(500).json({ error: 'Failed to create dashboard' });
  }
});

// GET /orgs/:orgId/dashboards/:id
dashboardsRouter.get('/orgs/:orgId/dashboards/:id', requireMember(), async (req: Request, res: Response) => {
  const { orgId, id } = req.params;
  try {
    const board = await loadDashboard(req.db, orgId, id);
    if (!board) { res.status(404).json({ error: 'Dashboard not found' }); return; }

    const { data: widgets } = await serviceClient
      .from('widgets')
      .select('*')
      .eq('dashboard_id', id)
      .order('grid_y').order('grid_x');

    res.json({
      id: board.id, name: board.name, slug: board.slug, visibility: board.visibility,
      description: board.description, group: board.group_name ?? null, ownerId: board.owner_id,
      isOwner: board.owner_id === req.user!.id,
      widgets: (widgets ?? []).map((r) => mapWidget(r as Record<string, unknown>)),
      createdAt: board.created_at, updatedAt: board.updated_at,
    });
  } catch (err) {
    console.error('GET dashboard failed', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// PATCH /orgs/:orgId/dashboards/:id { name?, visibility?, description? }
dashboardsRouter.patch('/orgs/:orgId/dashboards/:id', requireMember(), async (req: Request, res: Response) => {
  const { orgId, id } = req.params;
  const body = req.body ?? {};
  try {
    const board = await loadDashboard(req.db, orgId, id);
    if (!board) { res.status(404).json({ error: 'Not found' }); return; }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (['private', 'org', 'published'].includes(body.visibility)) patch.visibility = body.visibility;
    if (typeof body.description === 'string') patch.description = body.description.trim() || null;
    if (typeof body.group === 'string') patch.group_name = body.group.trim() || null;
    const { error } = await req.db!.from('dashboards').update(patch).eq('id', id).eq('org_id', orgId);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH dashboard failed', err);
    res.status(500).json({ error: 'Failed to update dashboard' });
  }
});

// DELETE /orgs/:orgId/dashboards/:id
dashboardsRouter.delete('/orgs/:orgId/dashboards/:id', requireMember(), async (req: Request, res: Response) => {
  const { orgId, id } = req.params;
  try {
    await req.db!.from('dashboards').delete().eq('id', id).eq('org_id', orgId);
    res.status(204).end();
  } catch (err) {
    console.error('DELETE dashboard failed', err);
    res.status(500).json({ error: 'Failed to delete dashboard' });
  }
});

// ---------------------------------------------------------------------------
// Widget helpers
// ---------------------------------------------------------------------------

function mapWidget(row: Record<string, unknown>, userId?: string) {
  return {
    id: row.id,
    dashboardId: row.dashboard_id,
    ownerId: row.owner_id,
    isOwner: userId ? row.owner_id === userId : undefined,
    name: row.name,
    type: row.type,
    html: row.html ?? null,
    prompt: row.prompt ?? null,
    gridX: row.grid_x,
    gridY: row.grid_y,
    gridW: row.grid_w,
    gridH: row.grid_h,
    sources: row.sources ?? [],
    alertRule: row.alert_rule ?? null,
    alertStatus: row.alert_status ?? null,
    lastRefreshed: row.last_refreshed ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const WIDGET_SYSTEM = `You are a data widget generator for the DeepLogic dashboard — a platform with BOTH light and dark themes.
Generate a SINGLE self-contained HTML fragment (no <html>/<head>/<body> wrapper) — just a root <div class="wg"> with inline styles and vanilla JS/SVG if needed.

CRITICAL — stay on-brand and theme-aware. The platform injects these CSS variables (they flip automatically between light and dark). USE them and do NOT hardcode hex colors or a fixed/opaque page background:
- primary text: var(--ink)    muted text: var(--mut)
- card/panel surface: var(--card)    subtle panel: var(--card2)
- borders: var(--line)
- accent / highlight / links: var(--cyan)    secondary accent: var(--blue)
- success: var(--good)    warning: var(--warn)    error/alert: var(--bad)
- gradient for emphasis (big numbers, bars): var(--grad)
The widget's own background must be transparent or var(--card) — never a fixed dark color. Font: inherit (system-ui). It MUST look correct in both light and dark.

Layout: rounded 12px cards; the widget fills 100% of its container width and height.

Widget type rules:
- kpi: key metric very large (≥32px) in var(--ink); label above in var(--mut); trend arrow + pct vs prev period in var(--good)/var(--bad); sparkline if data available
- chart: pure inline SVG (bar, line, or pie) — NO external libraries; series in var(--cyan)/var(--blue), axes/labels in var(--mut), gridlines in var(--line); include a legend
- table: max 10 rows, sticky header; alternate row shading with a faint neutral overlay like rgba(127,127,127,0.06) so it works on any background
- insight: a short AI-written narrative with a headline, in a card using var(--card) + 1px var(--line) border
- alert: large icon (✓ or ⚠), status label, metric value, threshold; var(--good) when ok, var(--bad) when fired
- news: list of headlines with source + time in var(--mut); links in var(--cyan)
- embed: not generated by AI — skip

Return ONLY the HTML starting with <div class="wg". No markdown fences, no explanation.`;

/** Parse the URL from a connector content block ("API Endpoint: https://..."). */
function parseConnectorUrl(content: string): string | null {
  const m = /^API Endpoint:\s*(\S+)/im.exec(content);
  return m ? m[1] : null;
}

/** Fetch a URL for a connector and return the body, truncated to 5000 chars. */
async function fetchConnectorData(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json, text/plain, */*' } });
    clearTimeout(timer);
    if (!r.ok) return `[fetch failed: ${r.status} ${r.statusText}]`;
    const raw = await r.text();
    try { return JSON.stringify(JSON.parse(raw) as unknown, null, 2).slice(0, 5000); } catch { return raw.slice(0, 5000); }
  } catch (e) {
    return `[fetch failed: ${e instanceof Error ? e.message : 'error'}]`;
  }
}

async function buildWidgetContext(
  db: Request['db'],
  orgId: string,
  sources: { type: string; ref: string; name: string }[]
): Promise<string> {
  const parts: string[] = [];
  for (const src of sources) {
    if (src.type === 'library') {
      const { data } = await db!.from('context_items').select('name, kind, content').eq('id', src.ref).eq('org_id', orgId).maybeSingle();
      if (data?.content) {
        parts.push(`## ${data.name} (${data.kind})`);
        parts.push(data.content.slice(0, 4000));
        // For MCP/API connectors, also fetch the live data from the URL.
        if ((data.kind === 'mcp' || data.kind === 'api') && data.content) {
          const url = parseConnectorUrl(data.content as string);
          if (url) {
            const live = await fetchConnectorData(url);
            parts.push('### Live data');
            parts.push('```json\n' + live + '\n```');
          }
        }
      }
    } else if (src.type === 'model') {
      const { data } = await db!.from('models').select('name, data').eq('id', src.ref).eq('org_id', orgId).maybeSingle();
      if (data) {
        parts.push(`## Semantic model: ${data.name}`);
        parts.push(JSON.stringify(data.data ?? {}).slice(0, 4000));
      }
    }
  }
  return parts.length ? `# Widget data sources\n\n${parts.join('\n\n')}` : '';
}

// POST /orgs/:orgId/dashboards/:id/widgets { name, type, prompt, sources, gridW?, gridH?, gridX?, gridY?, alertRule? }
dashboardsRouter.post(
  '/orgs/:orgId/dashboards/:id/widgets',
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId, id: dashboardId } = req.params;
    const body = req.body ?? {};
    const { name, type, prompt, html: seedHtml, sources, gridW = 1, gridH = 1, gridX = 0, gridY = 0, alertRule } = body;
    if (!name?.trim()) { res.status(400).json({ error: 'Name required' }); return; }

    try {
      const board = await loadDashboard(req.db, orgId, dashboardId);
      if (!board) { res.status(404).json({ error: 'Dashboard not found' }); return; }

      const wid = randomUUID();
      const now = new Date().toISOString();
      const { data, error } = await req.db!
        .from('widgets')
        .insert({
          id: wid, org_id: orgId, dashboard_id: dashboardId, owner_id: req.user!.id,
          name: name.trim(), type: type ?? 'insight', html: seedHtml ?? null, prompt: prompt ?? null,
          grid_x: gridX, grid_y: gridY, grid_w: Math.min(12, Math.max(1, gridW)),
          grid_h: Math.min(12, Math.max(1, gridH)),
          sources: sources ?? [], alert_rule: alertRule ?? null,
          created_at: now, updated_at: now,
        })
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      res.status(201).json(mapWidget(data as Record<string, unknown>));
    } catch (err) {
      console.error('POST widget failed', err);
      res.status(500).json({ error: 'Failed to create widget' });
    }
  }
);

// PATCH /orgs/:orgId/dashboards/:id/widgets/:wid
dashboardsRouter.patch(
  '/orgs/:orgId/dashboards/:id/widgets/:wid',
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId, id: dashboardId, wid } = req.params;
    const body = req.body ?? {};
    try {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
      if (typeof body.prompt === 'string') patch.prompt = body.prompt;
      if (typeof body.gridX === 'number') patch.grid_x = body.gridX;
      if (typeof body.gridY === 'number') patch.grid_y = body.gridY;
      if (typeof body.gridW === 'number') patch.grid_w = Math.min(12, Math.max(1, body.gridW));
      if (typeof body.gridH === 'number') patch.grid_h = Math.min(12, Math.max(1, body.gridH));
      if (Array.isArray(body.sources)) patch.sources = body.sources;
      if (body.alertRule !== undefined) patch.alert_rule = body.alertRule;
      const { data, error } = await serviceClient
        .from('widgets').update(patch)
        .eq('id', wid).eq('dashboard_id', dashboardId).eq('org_id', orgId)
        .select('*').maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) { res.status(404).json({ error: 'Widget not found' }); return; }
      res.json(mapWidget(data as Record<string, unknown>));
    } catch (err) {
      console.error('PATCH widget failed', err);
      res.status(500).json({ error: 'Failed to update widget' });
    }
  }
);

// DELETE /orgs/:orgId/dashboards/:id/widgets/:wid — detaches widget from dashboard (does NOT delete it)
dashboardsRouter.delete(
  '/orgs/:orgId/dashboards/:id/widgets/:wid',
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId, id: dashboardId, wid } = req.params;
    try {
      const { error } = await req.db!
        .from('widgets')
        .update({ dashboard_id: null, updated_at: new Date().toISOString() })
        .eq('id', wid)
        .eq('dashboard_id', dashboardId)
        .eq('org_id', orgId);
      if (error) throw new Error(error.message);
      res.status(204).end();
    } catch (err) {
      console.error('DETACH widget failed', err);
      res.status(500).json({ error: 'Failed to remove widget from dashboard' });
    }
  }
);

// ---------------------------------------------------------------------------
// Org-level widget endpoints (no dashboardId needed — for standalone widget flow)
// ---------------------------------------------------------------------------

// DELETE /orgs/:orgId/widgets/:wid — permanently deletes the widget
dashboardsRouter.delete('/orgs/:orgId/widgets/:wid', requireMember(), async (req: Request, res: Response) => {
  const { orgId, wid } = req.params;
  try {
    const { error } = await req.db!.from('widgets').delete().eq('id', wid).eq('org_id', orgId);
    if (error) throw new Error(error.message);
    res.status(204).end();
  } catch (err) {
    console.error('DELETE org widget failed', err);
    res.status(500).json({ error: 'Failed to delete widget' });
  }
});

// GET /orgs/:orgId/widgets  — list all widgets in the org
dashboardsRouter.get('/orgs/:orgId/widgets', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  try {
    const { data, error } = await req.db!
      .from('widgets').select('*').eq('org_id', orgId)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json((data ?? []).map((w) => mapWidget(w as Record<string, unknown>, req.user!.id)));
  } catch (err) {
    console.error('GET /widgets failed', err);
    res.status(500).json({ error: 'Failed to load widgets' });
  }
});

// GET /orgs/:orgId/widgets/:wid
dashboardsRouter.get('/orgs/:orgId/widgets/:wid', requireMember(), async (req: Request, res: Response) => {
  const { orgId, wid } = req.params;
  try {
    const { data, error } = await req.db!.from('widgets').select('*').eq('id', wid).eq('org_id', orgId).maybeSingle();
    if (error || !data) { res.status(404).json({ error: 'Widget not found' }); return; }
    res.json(mapWidget(data as Record<string, unknown>, req.user!.id));
  } catch (err) {
    console.error('GET /widgets/:wid failed', err);
    res.status(500).json({ error: 'Failed to load widget' });
  }
});

// PATCH /orgs/:orgId/widgets/:wid { name?, prompt?, gridW?, gridH?, sources? }
dashboardsRouter.patch('/orgs/:orgId/widgets/:wid', requireMember(), async (req: Request, res: Response) => {
  const { orgId, wid } = req.params;
  const body = req.body ?? {};
  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.prompt === 'string') patch.prompt = body.prompt;
    if (typeof body.gridW === 'number') patch.grid_w = Math.min(12, Math.max(1, body.gridW));
    if (typeof body.gridH === 'number') patch.grid_h = Math.min(12, Math.max(1, body.gridH));
    if (Array.isArray(body.sources)) patch.sources = body.sources;
    const { data, error } = await req.db!.from('widgets').update(patch).eq('id', wid).eq('org_id', orgId).select('*').maybeSingle();
    if (error || !data) { res.status(404).json({ error: 'Widget not found' }); return; }
    res.json(mapWidget(data as Record<string, unknown>));
  } catch (err) {
    console.error('PATCH /widgets/:wid failed', err);
    res.status(500).json({ error: 'Failed to update widget' });
  }
});

// POST /orgs/:orgId/widgets/:wid/generate { prompt?, history?, currentHtml? }
dashboardsRouter.post('/orgs/:orgId/widgets/:wid/generate', requireMember(), checkTokenBudget(), async (req: Request, res: Response) => {
  const { orgId, wid } = req.params;
  try {
    const { data: widget, error: wErr } = await req.db!.from('widgets').select('*').eq('id', wid).eq('org_id', orgId).maybeSingle();
    if (wErr || !widget) { res.status(404).json({ error: 'Widget not found' }); return; }
    const inlinePrompt: string | undefined = req.body?.prompt?.trim() || undefined;
    if (inlinePrompt) {
      await req.db!.from('widgets').update({ prompt: inlinePrompt, updated_at: new Date().toISOString() }).eq('id', wid);
      widget.prompt = inlinePrompt;
    }
    if (!widget.prompt) { res.status(400).json({ error: 'Widget has no prompt' }); return; }

    // Client passes conversation history and the current HTML so the AI can
    // iterate on the widget rather than rebuilding from scratch each time.
    const history = Array.isArray(req.body?.history) ? req.body.history : undefined;
    const currentHtml: string | undefined =
      typeof req.body?.currentHtml === 'string' && req.body.currentHtml.trim()
        ? req.body.currentHtml
        : (widget.html ?? undefined);

    const context = await buildWidgetContext(req.db, orgId, widget.sources ?? []);
    const ai = await loadAiConfig(orgId);
    const sizeHint = `Grid size: ${widget.grid_w} columns × ${widget.grid_h} rows. `;
    const fullPrompt = `${sizeHint}${widget.type.toUpperCase()} WIDGET: ${widget.prompt}`;
    const result = await generateReport({
      prompt: fullPrompt,
      currentHtml,
      history,
      context,
      ai,
      systemOverride: WIDGET_SYSTEM,
    });
    const now = new Date().toISOString();
    const { data: updated, error: uErr } = await req.db!.from('widgets').update({ html: result.html, last_refreshed: now, updated_at: now }).eq('id', wid).select('*').maybeSingle();
    if (uErr) throw new Error(uErr.message);
    res.json({ widget: mapWidget(updated as Record<string, unknown>), usedAI: result.usedAI });
  } catch (err) {
    console.error('widget generate (org-level) failed', err);
    res.status(500).json({ error: 'Generation failed' });
  }
});

// ---------------------------------------------------------------------------
// Dashboard-scoped widget endpoints (used by the grid editor)
// ---------------------------------------------------------------------------

// GET /orgs/:orgId/dashboards/:id/widgets/:wid
dashboardsRouter.get(
  '/orgs/:orgId/dashboards/:id/widgets/:wid',
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId, id: dashboardId, wid } = req.params;
    try {
      const { data, error } = await req.db!
        .from('widgets').select('*')
        .eq('id', wid).eq('dashboard_id', dashboardId).eq('org_id', orgId)
        .maybeSingle();
      if (error || !data) { res.status(404).json({ error: 'Widget not found' }); return; }
      res.json(mapWidget(data as Record<string, unknown>));
    } catch (err) {
      console.error('GET widget failed', err);
      res.status(500).json({ error: 'Failed to load widget' });
    }
  }
);

// POST /orgs/:orgId/dashboards/:id/widgets/:wid/generate
// Vibe-codes the widget HTML from its prompt + data sources.
dashboardsRouter.post(
  '/orgs/:orgId/dashboards/:id/widgets/:wid/generate',
  requireMember(),
  checkTokenBudget(),
  async (req: Request, res: Response) => {
    const { orgId, id: dashboardId, wid } = req.params;
    try {
      const { data: widget, error: wErr } = await req.db!
        .from('widgets').select('*')
        .eq('id', wid).eq('dashboard_id', dashboardId).eq('org_id', orgId)
        .maybeSingle();
      if (wErr || !widget) { res.status(404).json({ error: 'Widget not found' }); return; }

      // Optional inline prompt — if provided, persist it first.
      const inlinePrompt: string | undefined = req.body?.prompt?.trim() || undefined;
      if (inlinePrompt) {
        await req.db!.from('widgets').update({ prompt: inlinePrompt, updated_at: new Date().toISOString() }).eq('id', wid);
        widget.prompt = inlinePrompt;
      }

      if (!widget.prompt) { res.status(400).json({ error: 'Widget has no prompt — set one first' }); return; }

      const context = await buildWidgetContext(req.db, orgId, widget.sources ?? []);
      const ai = await loadAiConfig(orgId);

      const sizeHint = `Grid size: ${widget.grid_w} columns × ${widget.grid_h} rows. `;
      const fullPrompt = `${sizeHint}${widget.type.toUpperCase()} WIDGET: ${widget.prompt}`;

      const result = await generateReport({
        prompt: fullPrompt,
        context,
        ai,
        systemOverride: WIDGET_SYSTEM,
      });

      const now = new Date().toISOString();
      const { data: updated, error: uErr } = await req.db!
        .from('widgets')
        .update({ html: result.html, last_refreshed: now, updated_at: now })
        .eq('id', wid)
        .select('*')
        .maybeSingle();
      if (uErr) throw new Error(uErr.message);

      res.json({ widget: mapWidget(updated as Record<string, unknown>), usedAI: result.usedAI });
    } catch (err) {
      console.error('widget generate failed', err);
      res.status(500).json({ error: 'Generation failed' });
    }
  }
);

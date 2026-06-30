// Alerts — condition-based triggers evaluated by AI against data sources.
// Each alert stores a natural-language condition (e.g. "notify me if cannabis
// news mentions a supply disruption"). POST /:id/check runs it against the
// configured sources and fires the alert (email + event log) if the AI says YES.

import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireMember } from '../auth.js';
import { serviceClient } from '../supabase.js';
import { sendEmail } from '../email.js';
import { type AiProvider } from '../studio/generator.js';

export const alertsRouter = Router();

// ---------------------------------------------------------------------------
// Helpers shared with dashboards route
// ---------------------------------------------------------------------------

async function loadAiConfig(orgId: string) {
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

async function buildContext(orgId: string, sources: { type: string; ref: string; name: string }[]) {
  const parts: string[] = [];
  for (const src of sources) {
    if (src.type === 'library') {
      const { data } = await serviceClient.from('context_items').select('name, kind, content').eq('id', src.ref).eq('org_id', orgId).maybeSingle();
      if (data?.content) { parts.push(`## ${data.name} (${data.kind})`); parts.push(data.content.slice(0, 4000)); }
    } else if (src.type === 'model') {
      const { data } = await serviceClient.from('models').select('name, data').eq('id', src.ref).eq('org_id', orgId).maybeSingle();
      if (data) { parts.push(`## Semantic model: ${data.name}`); parts.push(JSON.stringify(data.data ?? {}).slice(0, 4000)); }
    }
  }
  return parts.length ? `# Alert context\n\n${parts.join('\n\n')}` : '';
}

async function evaluateCondition(
  condition: string,
  context: string,
  ai: { provider: AiProvider; apiKey: string; model?: string },
): Promise<{ fired: boolean; summary: string }> {
  const system =
    'You are an alert evaluation engine. The user will give you data and a condition. ' +
    'Evaluate whether the condition is currently TRUE based on the data. ' +
    'Respond ONLY with valid JSON: { "fired": true or false, "summary": "one-sentence explanation" }. ' +
    'No markdown, no code blocks, no other text.';

  const userMsg = context
    ? `${context}\n\n---\n\nCondition to evaluate: ${condition}`
    : `Condition to evaluate: ${condition}\n\n(No data sources configured — base evaluation on general knowledge.)`;

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    // For OpenAI/OpenRouter providers, use their API via direct fetch since we
    // only have the Anthropic SDK installed; Anthropic is the common case.
    if (ai.provider === 'openai' || ai.provider === 'openrouter') {
      const baseURL = ai.provider === 'openrouter'
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      const r = await fetch(baseURL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ai.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ai.model ?? 'gpt-4o-mini',
          max_tokens: 256,
          messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
          response_format: { type: 'json_object' },
        }),
      });
      const j = await r.json() as { choices?: { message?: { content?: string } }[] };
      return JSON.parse(j.choices?.[0]?.message?.content ?? '{}') as { fired: boolean; summary: string };
    }
    // Anthropic (default)
    const client = new Anthropic({ apiKey: ai.apiKey });
    const msg = await client.messages.create({
      model: ai.model ?? 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system,
      messages: [{ role: 'user', content: userMsg }],
    });
    const text = msg.content.find((b) => b.type === 'text')?.text ?? '{}';
    return JSON.parse(text) as { fired: boolean; summary: string };
  } catch (err) {
    console.error('[alert eval] AI call failed', err);
  }
  return { fired: false, summary: 'Evaluation failed — AI call error.' };
}

// ---------------------------------------------------------------------------
// Structured triggers (no AI): keyword / uptime / threshold. Fire on the
// state-CHANGE (so we don't re-notify every tick), using the alert's `state`.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
async function fetchTimeout(url: string, opts: any = {}, ms = 12_000): Promise<globalThis.Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
}
function getPath(obj: any, path: string): any {
  return String(path || '').split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), obj);
}

type CheckResult = { fired: boolean; summary: string; state?: Record<string, unknown> };

async function evaluateStructured(alert: Record<string, any>): Promise<CheckResult> {
  const kind = alert.kind as string;
  const cfg = (alert.config ?? {}) as Record<string, any>;
  const state = (alert.state ?? {}) as Record<string, any>;
  const url = String(cfg.url ?? '').trim();

  if (kind === 'uptime') {
    if (!url) return { fired: false, summary: 'No URL configured', state };
    let up = false, code = 0;
    try { const r = await fetchTimeout(url, { method: 'GET' }); code = r.status; up = r.ok; } catch { up = false; }
    const prev = state.status as string | undefined;
    const now = up ? 'up' : 'down';
    const newState = { ...state, status: now };
    if (prev !== undefined && now !== prev) {
      return { fired: true, summary: up ? `Recovered — site is back up (HTTP ${code})` : `DOWN — site not responding${code ? ` (HTTP ${code})` : ''}`, state: newState };
    }
    if (prev === undefined && !up) return { fired: true, summary: `DOWN — site not responding${code ? ` (HTTP ${code})` : ''}`, state: newState };
    return { fired: false, summary: up ? `Up (HTTP ${code})` : `Down (HTTP ${code})`, state: newState };
  }

  if (kind === 'keyword') {
    if (!url) return { fired: false, summary: 'No URL configured', state };
    const list = Array.isArray(cfg.keywords) ? cfg.keywords : String(cfg.keywords ?? '').split(',');
    const keywords = list.map((k: any) => String(k).trim().toLowerCase()).filter(Boolean);
    let text = '';
    try { const r = await fetchTimeout(url); text = (await r.text()).toLowerCase(); } catch { return { fired: false, summary: 'Fetch failed', state }; }
    const matched = keywords.filter((k: string) => text.includes(k));
    const present = matched.length > 0;
    const lastFired = state.lastFired ? new Date(state.lastFired).getTime() : 0;
    const cooled = Date.now() - lastFired > 6 * 3600 * 1000; // 6h cooldown
    if (present && (!state.present || cooled)) {
      return { fired: true, summary: `Keyword match: ${matched.join(', ')}`, state: { ...state, present, lastFired: new Date().toISOString() } };
    }
    return { fired: false, summary: present ? `Present: ${matched.join(', ')}` : 'No keyword match', state: { ...state, present } };
  }

  if (kind === 'threshold') {
    if (!url) return { fired: false, summary: 'No URL configured', state };
    // Supabase/PostgREST column alerts pass an apiKey so the query authenticates.
    const headers = cfg.apiKey ? { apikey: String(cfg.apiKey), Authorization: 'Bearer ' + String(cfg.apiKey) } : undefined;
    let val: number;
    try { const r = await fetchTimeout(url, headers ? { headers } : {}); val = Number(getPath(await r.json(), cfg.path)); } catch { return { fired: false, summary: 'Fetch/parse failed', state }; }
    if (!isFinite(val)) return { fired: false, summary: `No numeric value at "${cfg.path}"`, state };
    const target = Number(cfg.value);
    const op = (cfg.op as string) || 'gt';
    const breached = op === 'gt' ? val > target : op === 'lt' ? val < target : val === target;
    const sym = op === 'gt' ? '>' : op === 'lt' ? '<' : '=';
    const newState = { ...state, breached, value: val };
    if (breached && !state.breached) return { fired: true, summary: `${cfg.path} = ${val} ${sym} ${target}`, state: newState };
    return { fired: false, summary: `${cfg.path} = ${val} (threshold ${sym} ${target})`, state: newState };
  }

  return { fired: false, summary: 'Unknown alert kind', state };
}

// Route a single alert to the right evaluator (AI condition or structured).
async function performCheck(orgId: string, alert: Record<string, any>): Promise<CheckResult> {
  if ((alert.kind ?? 'ai') === 'ai') {
    const ai = await loadAiConfig(orgId);
    if (!ai) return { fired: false, summary: 'No AI provider configured — add an API key in Settings.' };
    const context = await buildContext(orgId, alert.sources ?? []);
    const r = await evaluateCondition(alert.condition as string, context, ai);
    return { fired: r.fired, summary: r.summary };
  }
  return evaluateStructured(alert);
}

// Persist a check result: timestamps, fire bookkeeping, event log, email.
async function applyCheckResult(orgId: string, alert: Record<string, any>, result: CheckResult): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { last_checked: now, updated_at: now };
  if (result.state) patch.state = result.state;
  if (result.fired) {
    patch.last_fired = now;
    patch.fire_count = (Number(alert.fire_count) || 0) + 1;
    await serviceClient.from('alert_events').insert({ alert_id: alert.id, org_id: orgId, fired_at: now, summary: result.summary });
    if (alert.notify_email) {
      await sendEmail({
        to: alert.notify_email as string,
        subject: `🔔 Alert fired: ${alert.name}`,
        html: `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:560px;margin:40px auto;color:#1a1a1a">
          <h2 style="margin-bottom:4px">Alert fired: <strong>${alert.name}</strong></h2>
          <p style="color:#555;background:#f5f5f5;padding:12px;border-radius:6px;margin:16px 0">${result.summary}</p>
          <p style="color:#aaa;font-size:12px">Fired at ${new Date(now).toLocaleString()}</p>
        </body></html>`,
      }).catch((e: Error) => console.error('[alert email] failed:', e.message));
    }
  }
  await serviceClient.from('alerts').update(patch).eq('id', alert.id);
}

// Scheduler entry point — evaluate every active alert. Structured alerts run
// each tick (cheap fetches); AI alerts are throttled to ~30 min (token cost).
export async function checkAllActiveAlerts(): Promise<void> {
  const { data } = await serviceClient.from('alerts').select('*').eq('status', 'active');
  for (const a of (data ?? []) as Record<string, any>[]) {
    if ((a.kind ?? 'ai') === 'ai') {
      const last = a.last_checked ? new Date(a.last_checked).getTime() : 0;
      if (Date.now() - last < 30 * 60 * 1000) continue;
    }
    try {
      const r = await performCheck(a.org_id, a);
      await applyCheckResult(a.org_id, a, r);
    } catch (e) {
      console.error('[alert tick] failed', a.id, e);
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function mapAlert(row: Record<string, unknown>) {
  return {
    id: row.id,
    orgId: row.org_id,
    createdBy: row.created_by,
    name: row.name,
    kind: row.kind ?? 'ai',
    config: row.config ?? {},
    condition: row.condition,
    sources: row.sources ?? [],
    widgetId: row.widget_id ?? null,
    notifyEmail: row.notify_email ?? null,
    status: row.status,
    lastChecked: row.last_checked ?? null,
    lastFired: row.last_fired ?? null,
    fireCount: row.fire_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// GET /orgs/:orgId/alerts
alertsRouter.get('/orgs/:orgId/alerts', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  try {
    const { data, error } = await serviceClient
      .from('alerts').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json((data ?? []).map((r) => mapAlert(r as Record<string, unknown>)));
  } catch (err) {
    console.error('GET alerts failed', err);
    res.status(500).json({ error: 'Failed to load alerts' });
  }
});

// POST /orgs/:orgId/alerts
alertsRouter.post('/orgs/:orgId/alerts', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const { name, condition, sources = [], notifyEmail, status = 'active', kind = 'ai', config = {}, widgetId } = req.body ?? {};
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  if (kind === 'ai' && !condition?.trim()) { res.status(400).json({ error: 'condition is required' }); return; }
  try {
    const { data, error } = await serviceClient
      .from('alerts')
      .insert({
        org_id: orgId, created_by: req.user!.id, name: name.trim(),
        condition: (condition ?? '').trim(), sources, notify_email: notifyEmail || null, status,
        kind, config: config ?? {}, widget_id: widgetId || null,
      })
      .select('*').maybeSingle();
    if (error) throw new Error(error.message);
    res.status(201).json(mapAlert(data as Record<string, unknown>));
  } catch (err) {
    console.error('POST alert failed', err);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

// PATCH /orgs/:orgId/alerts/:id
alertsRouter.patch('/orgs/:orgId/alerts/:id', requireMember(), async (req: Request, res: Response) => {
  const { orgId, id } = req.params;
  const body = req.body ?? {};
  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.condition === 'string') patch.condition = body.condition.trim();
    if (Array.isArray(body.sources)) patch.sources = body.sources;
    if (typeof body.notifyEmail === 'string') patch.notify_email = body.notifyEmail || null;
    if (body.status === 'active' || body.status === 'paused') patch.status = body.status;
    if (typeof body.kind === 'string') patch.kind = body.kind;
    if (body.config && typeof body.config === 'object') { patch.config = body.config; patch.state = {}; }
    if (typeof body.widgetId === 'string') patch.widget_id = body.widgetId || null;
    const { data, error } = await serviceClient
      .from('alerts').update(patch).eq('id', id).eq('org_id', orgId).select('*').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) { res.status(404).json({ error: 'Alert not found' }); return; }
    res.json(mapAlert(data as Record<string, unknown>));
  } catch (err) {
    console.error('PATCH alert failed', err);
    res.status(500).json({ error: 'Failed to update alert' });
  }
});

// DELETE /orgs/:orgId/alerts/:id
alertsRouter.delete('/orgs/:orgId/alerts/:id', requireMember(), async (req: Request, res: Response) => {
  const { orgId, id } = req.params;
  try {
    const { error } = await serviceClient.from('alerts').delete().eq('id', id).eq('org_id', orgId);
    if (error) throw new Error(error.message);
    res.status(204).end();
  } catch (err) {
    console.error('DELETE alert failed', err);
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

// ---------------------------------------------------------------------------
// Check (evaluate condition with AI)
// ---------------------------------------------------------------------------

// POST /orgs/:orgId/alerts/:id/check
alertsRouter.post('/orgs/:orgId/alerts/:id/check', requireMember(), async (req: Request, res: Response) => {
  const { orgId, id } = req.params;
  try {
    const { data: alert, error: aErr } = await serviceClient
      .from('alerts').select('*').eq('id', id).eq('org_id', orgId).maybeSingle();
    if (aErr || !alert) { res.status(404).json({ error: 'Alert not found' }); return; }

    const result = await performCheck(orgId, alert as Record<string, unknown>);
    await applyCheckResult(orgId, alert as Record<string, unknown>, result);

    res.json({ fired: result.fired, summary: result.summary, checkedAt: new Date().toISOString() });
  } catch (err) {
    console.error('alert check failed', err);
    res.status(500).json({ error: 'Check failed' });
  }
});

// GET /orgs/:orgId/alerts/:id/events
alertsRouter.get('/orgs/:orgId/alerts/:id/events', requireMember(), async (req: Request, res: Response) => {
  const { orgId, id } = req.params;
  try {
    const { data, error } = await serviceClient
      .from('alert_events').select('*').eq('alert_id', id).eq('org_id', orgId)
      .order('fired_at', { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    res.json((data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id, alertId: r.alert_id, firedAt: r.fired_at, summary: r.summary,
    })));
  } catch (err) {
    console.error('GET alert events failed', err);
    res.status(500).json({ error: 'Failed to load events' });
  }
});

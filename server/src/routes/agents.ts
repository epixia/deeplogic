// Agents — CRUD for org-scoped AI agents with optional cron schedule.
// All routes under /api/orgs/:orgId/agents, protected by requireMember().

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireMember } from '../auth.js';
import { serviceClient } from '../supabase.js';
import { loadAiConfig, executeInternalAgentRun } from './studio.js';
import { appendEvent, finishRun, ensureExternalRun } from '../agents/runLog.js';
import { fetchSiteText, normalizeUrl, suggestTeam, type ProposedAgent } from '../studio/aiTeam.js';
import { provisionExternalAgent } from '../agents/provision.js';
import { loadOrgoCreds } from './integrations.js';
import { orgoStop, orgoDestroy } from '../integrations/orgo.js';

export const agentsRouter = Router();

const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001', 'gpt-4o', 'gpt-4o-mini',
]);

// Cron schedules the UI offers. Anything else is coerced to null (manual).
const ALLOWED_SCHEDULES = new Set(['0 * * * *', '0 9 * * *', '0 9 * * 1', '0 9 1 * *']);

interface AgentRow {
  id: string;
  org_id: string;
  created_by: string | null;
  name: string;
  description: string;
  model: string;
  system_prompt: string;
  schedule: string | null;
  last_run_at: string | null;
  status: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
}

function mapAgent(row: AgentRow, userId: string) {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    model: row.model,
    systemPrompt: row.system_prompt,
    schedule: row.schedule ?? null,
    lastRunAt: row.last_run_at ?? null,
    status: (row.status as 'idle' | 'running') ?? 'idle',
    lastRunStatus: (row.last_run_status as 'ok' | 'error' | null) ?? null,
    isOwner: row.created_by === userId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(r: Record<string, unknown>) {
  return {
    id: r.id, orgId: r.org_id, agentId: r.agent_id ?? null, externalAgentId: r.external_agent_id ?? null,
    agentKind: r.agent_kind, agentName: r.agent_name, trigger: r.trigger, status: r.status,
    groupId: r.group_id ?? null, groupLabel: r.group_label ?? null,
    model: r.model ?? null, triggerContext: r.trigger_context ?? {}, result: r.result ?? null, error: r.error ?? null,
    tokensIn: r.tokens_in ?? null, tokensOut: r.tokens_out ?? null,
    startedAt: r.started_at, finishedAt: r.finished_at ?? null, createdAt: r.created_at,
  };
}
function mapRunEvent(e: Record<string, unknown>) {
  return { id: e.id, kind: e.kind, icon: e.icon ?? null, message: e.message, data: e.data ?? null, createdAt: e.created_at };
}

// GET /api/orgs/:orgId/agents
agentsRouter.get('/orgs/:orgId/agents', requireMember(), async (req, res) => {
  const { orgId } = req.params;
  const { data, error } = await req.db!
    .from('agents')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data as AgentRow[]).map((r) => mapAgent(r, req.user!.id)));
});

// POST /api/orgs/:orgId/agents/:id/run — run an agent on demand. Executes its
// system prompt once and returns the output; reflects status while it runs.
agentsRouter.post('/orgs/:orgId/agents/:id/run', requireMember(), async (req, res) => {
  const { orgId, id } = req.params;
  const { data: agent, error } = await req.db!
    .from('agents').select('id, name, model, system_prompt').eq('id', id).eq('org_id', orgId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const a = agent as { id: string; name: string; model: string; system_prompt: string };
  const trigger = (req.body?.trigger === 'schedule' ? 'schedule' : 'manual') as 'manual' | 'schedule';
  try {
    const { output, runId } = await executeInternalAgentRun(req, orgId, a, { trigger });
    return res.json({ ok: true, name: a.name, output: output.slice(0, 8000), ranAt: new Date().toISOString(), runId });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Agent run failed.' });
  }
});

// POST /api/orgs/:orgId/agents/:id/run/stream — run an agent and stream its
// live thoughts + tool actions (SSE), then a final result event.
agentsRouter.post('/orgs/:orgId/agents/:id/run/stream', requireMember(), async (req, res) => {
  const { orgId, id } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const { data: agent, error } = await req.db!
    .from('agents').select('id, name, model, system_prompt').eq('id', id).eq('org_id', orgId).maybeSingle();
  if (error || !agent) { send({ type: 'error', error: 'Agent not found' }); return res.end(); }
  const a = agent as { id: string; name: string; model: string; system_prompt: string };

  send({ type: 'step', icon: '▶️', text: `Starting "${a.name}"` });
  try {
    const { output, runId } = await executeInternalAgentRun(req, orgId, a, {
      trigger: 'manual',
      onStep: (s) => send({ type: 'step', icon: s.icon, text: s.text }),
    });
    send({ type: 'done', output: output.slice(0, 8000), runId });
  } catch (e) {
    send({ type: 'error', error: e instanceof Error ? e.message : 'Agent run failed.' });
  }
  return res.end();
});

// GET /api/orgs/:orgId/agent-runs — recent runs across all agents (activity log)
agentsRouter.get('/orgs/:orgId/agent-runs', requireMember(), async (req, res) => {
  const { orgId } = req.params;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const q = req.db!.from('agent_runs').select('*').eq('org_id', orgId);
  if (typeof req.query.agentId === 'string') q.eq('agent_id', req.query.agentId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  return res.json((data ?? []).map(mapRun));
});

// GET /api/orgs/:orgId/agent-runs/:runId — one run plus its full event trace
agentsRouter.get('/orgs/:orgId/agent-runs/:runId', requireMember(), async (req, res) => {
  const { orgId, runId } = req.params;
  const { data: run, error } = await req.db!
    .from('agent_runs').select('*').eq('id', runId).eq('org_id', orgId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const { data: events } = await req.db!
    .from('agent_run_events').select('*').eq('run_id', runId).eq('org_id', orgId)
    .order('created_at', { ascending: true });
  return res.json({ ...mapRun(run as Record<string, unknown>), events: (events ?? []).map(mapRunEvent) });
});

// POST /api/orgs/:orgId/agents
agentsRouter.post('/orgs/:orgId/agents', requireMember(), async (req, res) => {
  const { orgId } = req.params;
  const { name, description = '', model = 'claude-sonnet-4-6', systemPrompt = '', schedule = null } = req.body as {
    name: string;
    description?: string;
    model?: string;
    systemPrompt?: string;
    schedule?: string | null;
  };
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  const { data, error } = await req.db!
    .from('agents')
    .insert({
      org_id: orgId,
      created_by: req.user!.id,
      name: name.trim(),
      description: description.trim(),
      model,
      system_prompt: systemPrompt,
      schedule: schedule || null,
    })
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(mapAgent(data as AgentRow, req.user!.id));
});

// POST /api/orgs/:orgId/agents/suggest — extrapolate a team from a website
// Body: { url: string, notes?: string }
agentsRouter.post('/orgs/:orgId/agents/suggest', requireMember(), async (req, res) => {
  const { orgId } = req.params;
  const { url, notes = '' } = (req.body || {}) as { url?: string; notes?: string };

  const normalized = normalizeUrl(url ?? '');
  if (!normalized) {
    return res.status(400).json({ error: 'Enter a valid public website URL (e.g. https://acme.com).' });
  }

  try {
    let siteText = '';
    let siteTitle = '';
    try {
      const site = await fetchSiteText(normalized);
      siteText = site.text;
      siteTitle = site.title;
    } catch (e) {
      // If notes were supplied we can still proceed; otherwise the fetch error is fatal.
      if (!notes.trim()) {
        return res.status(422).json({
          error: e instanceof Error ? `Couldn't read that site: ${e.message}` : "Couldn't read that site.",
        });
      }
    }

    const ai = await loadAiConfig(orgId).catch(() => null);
    const suggestion = await suggestTeam({ ai, siteText, siteTitle, url: normalized, notes });
    return res.json(suggestion);
  } catch (err) {
    console.error('POST agents/suggest failed', err);
    return res.status(500).json({ error: 'Failed to generate a team.' });
  }
});

// POST /api/orgs/:orgId/agents/bulk — create several agents at once
// Body: { agents: ProposedAgent[] }
agentsRouter.post('/orgs/:orgId/agents/bulk', requireMember(), async (req, res) => {
  const { orgId } = req.params;
  const { agents } = (req.body || {}) as { agents?: ProposedAgent[] };
  if (!Array.isArray(agents) || agents.length === 0) {
    return res.status(400).json({ error: 'No agents provided.' });
  }
  if (agents.length > 12) {
    return res.status(400).json({ error: 'Too many agents in one request.' });
  }

  const rows = agents
    .filter((a) => a && typeof a.name === 'string' && a.name.trim())
    .map((a) => ({
      org_id: orgId,
      created_by: req.user!.id,
      name: a.name.trim().slice(0, 80),
      description: (a.description ?? '').trim().slice(0, 240),
      model: ALLOWED_MODELS.has(a.model) ? a.model : 'claude-sonnet-4-6',
      system_prompt: (a.systemPrompt ?? '').slice(0, 8000),
      schedule: a.schedule && ALLOWED_SCHEDULES.has(a.schedule) ? a.schedule : null,
    }));

  if (rows.length === 0) return res.status(400).json({ error: 'No valid agents to create.' });

  const { data, error } = await req.db!.from('agents').insert(rows).select('*');
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json((data as AgentRow[]).map((r) => mapAgent(r, req.user!.id)));
});

// PATCH /api/orgs/:orgId/agents/:id
agentsRouter.patch('/orgs/:orgId/agents/:id', requireMember(), async (req, res) => {
  const { orgId, id } = req.params;
  const { name, description, model, systemPrompt, schedule } = req.body as Partial<{
    name: string;
    description: string;
    model: string;
    systemPrompt: string;
    schedule: string | null;
  }>;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name.trim();
  if (description !== undefined) patch.description = description.trim();
  if (model !== undefined) patch.model = model;
  if (systemPrompt !== undefined) patch.system_prompt = systemPrompt;
  if (schedule !== undefined) patch.schedule = schedule || null;

  const { data, error } = await req.db!
    .from('agents')
    .update(patch)
    .eq('id', id)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  return res.json(mapAgent(data as AgentRow, req.user!.id));
});

// DELETE /api/orgs/:orgId/agents/:id
agentsRouter.delete('/orgs/:orgId/agents/:id', requireMember(), async (req, res) => {
  const { orgId, id } = req.params;
  const { error } = await req.db!
    .from('agents')
    .delete()
    .eq('id', id)
    .eq('org_id', orgId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// External agents — Hermes / OpenClaw runtimes deployed in their own VM, each
// dispatched on a MISSION. Lifecycle (all lazily advanced on read, no worker):
//   provisioning --(VM up)--> running + mission_started --(agent reports)--> completed
// The remote VM reports progress/results back to DeepLogic central via the
// public, token-authenticated callback webhook (agentCallbackRouter) below.
// ---------------------------------------------------------------------------

const EA_PROVIDERS = new Set(['hermes', 'openclaw']);
const EA_REGIONS = new Set(['us-east', 'us-west', 'eu-west']);
const EA_SIZES = new Set(['small', 'medium', 'large']);

interface ExternalAgentRow {
  id: string; org_id: string; created_by: string | null; provider: string;
  name: string; status: string; region: string | null; size: string | null;
  host: string | null; mission: string; reason: string; deployed_via: string;
  mission_status: string; result: unknown; mission_started_at: string | null;
  mission_completed_at: string | null; callback_token: string | null;
  config: { runtime?: string; orgo?: { computerId?: string } } | null;
  created_at: string; updated_at: string;
}
interface AgentEventRow {
  id: string; agent_id: string; kind: string; message: string; data: unknown; created_at: string;
}

function mapAgentEvent(e: AgentEventRow) {
  return { id: e.id, kind: e.kind, message: e.message, data: e.data ?? null, createdAt: e.created_at };
}

function mapExternalAgent(r: ExternalAgentRow, events: AgentEventRow[] = []) {
  return {
    id: r.id, orgId: r.org_id, provider: r.provider, name: r.name, status: r.status,
    region: r.region, size: r.size, host: r.host,
    runtime: r.config?.runtime === 'orgo' ? 'orgo' : 'simulated',
    mission: r.mission ?? '', reason: r.reason ?? '', deployedVia: r.deployed_via ?? 'ui',
    missionStatus: r.mission_status ?? 'pending', result: r.result ?? null,
    missionStartedAt: r.mission_started_at ?? null, missionCompletedAt: r.mission_completed_at ?? null,
    events: events.filter((e) => e.agent_id === r.id).map(mapAgentEvent),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// Append a back-channel event. `db` is the caller's RLS client for app-side
// events; the public callback uses the service client (see callback router).
async function logAgentEvent(
  db: SupabaseClient, orgId: string, agentId: string, kind: string, message: string, data?: unknown,
) {
  await db.from('external_agent_events').insert({ agent_id: agentId, org_id: orgId, kind, message, data: data ?? null });
}

// Provider adapter — the connection host for a provisioned runtime VM.
// STUB: deterministic host. Wire real infra here (E2B / Fly.io / cloud VM):
// launch the VM, inject CALLBACK_URL + callback_token as env, start the
// Hermes/OpenClaw runtime, and return its reachable host.
function vmHost(row: ExternalAgentRow): string {
  return `https://${row.provider}-${row.id.slice(0, 8)}.${row.region ?? 'us-east'}.vm.deeplogic.run`;
}

const PROVISION_MS = 5000;  // simulated VM provisioning time
const MISSION_MS = 12_000;  // simulated mission run time (stands in for real VM callback)

// Advance one agent's lifecycle in-place, persisting + logging any transition.
// In production these transitions are driven by the VM's real callbacks; here we
// simulate them on read so the full loop is demoable without live infrastructure.
async function advanceLifecycle(db: SupabaseClient, orgId: string, r: ExternalAgentRow): Promise<void> {
  // Orgo-backed agents are driven by their real background task — never simulate.
  if (r.config?.runtime === 'orgo') return;
  const now = Date.now();
  // 1) provisioning -> running, and kick off the mission.
  if (r.status === 'provisioning' && now - new Date(r.created_at).getTime() > PROVISION_MS) {
    r.status = 'running';
    r.host = vmHost(r);
    const startMission = !!r.mission && r.mission_status === 'pending';
    r.mission_status = startMission ? 'in_progress' : r.mission_status;
    r.mission_started_at = startMission ? new Date().toISOString() : r.mission_started_at;
    await db.from('external_agents').update({
      status: r.status, host: r.host, mission_status: r.mission_status,
      mission_started_at: r.mission_started_at, updated_at: new Date().toISOString(),
    }).eq('id', r.id).eq('org_id', orgId);
    await logAgentEvent(db, orgId, r.id, 'provisioned', `VM provisioned at ${r.host}`);
    if (startMission) {
      await logAgentEvent(db, orgId, r.id, 'mission_started', `Mission started: ${r.mission.slice(0, 160)}`);
      const runId = await ensureExternalRun(db, orgId, r.id, r.name || r.provider);
      await appendEvent(db, orgId, runId, 'step', `Mission started: ${r.mission.slice(0, 160)}`, '🚀');
    }
  }
  // 2) running + in_progress -> completed (SIMULATED callback). Real Hermes
  //    would POST to /api/agent-callback/:id; we synthesise that result here.
  if (r.status === 'running' && r.mission_status === 'in_progress' && r.mission_started_at &&
      now - new Date(r.mission_started_at).getTime() > MISSION_MS) {
    const result = {
      summary: `Mission complete (simulated). In production, ${r.provider === 'hermes' ? 'Hermes' : 'OpenClaw'} would POST its real findings to the callback webhook.`,
      mission: r.mission,
      deliverables: [
        `Worked the objective: "${r.mission.slice(0, 120)}"`,
        'Reported progress back to DeepLogic central via the callback channel.',
      ],
      finishedAt: new Date().toISOString(),
    };
    r.mission_status = 'completed';
    r.mission_completed_at = new Date().toISOString();
    r.result = result;
    await db.from('external_agents').update({
      mission_status: 'completed', result, mission_completed_at: r.mission_completed_at,
      updated_at: new Date().toISOString(),
    }).eq('id', r.id).eq('org_id', orgId);
    await logAgentEvent(db, orgId, r.id, 'completed', 'Mission fulfilled — results reported back to DeepLogic central.', result);
    const runId = await ensureExternalRun(db, orgId, r.id, r.name || r.provider);
    await appendEvent(db, orgId, runId, 'output', result.summary, '📄', result);
    await finishRun(db, runId, 'succeeded', { result: JSON.stringify(result, null, 2) });
  }
}

// GET external-agents — lazily advances each agent's lifecycle, then returns
// every instance with its mission, status and back-channel event timeline.
agentsRouter.get('/orgs/:orgId/external-agents', requireMember(), async (req, res) => {
  const { orgId } = req.params;
  const { data, error } = await req.db!
    .from('external_agents').select('*').eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const rows = data as ExternalAgentRow[];
  for (const r of rows) await advanceLifecycle(req.db!, orgId, r);

  const ids = rows.map((r) => r.id);
  let events: AgentEventRow[] = [];
  if (ids.length) {
    const { data: ev } = await req.db!
      .from('external_agent_events').select('*').in('agent_id', ids)
      .order('created_at', { ascending: true });
    events = (ev as AgentEventRow[]) ?? [];
  }
  return res.json(rows.map((r) => mapExternalAgent(r, events)));
});

// POST external-agents/deploy { provider, name, region?, size?, mission?, reason? }
agentsRouter.post('/orgs/:orgId/external-agents/deploy', requireMember(), async (req, res) => {
  const { orgId } = req.params;
  const { provider, name, region = 'us-east', size = 'small', mission = '', reason = '' } = (req.body || {}) as {
    provider?: string; name?: string; region?: string; size?: string; mission?: string; reason?: string;
  };
  if (!provider || !EA_PROVIDERS.has(provider)) return res.status(400).json({ error: 'Unknown provider' });
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const reg = EA_REGIONS.has(region) ? region : 'us-east';
  const sz = EA_SIZES.has(size) ? size : 'small';

  try {
    const { row } = await provisionExternalAgent(req.db!, {
      orgId, userId: req.user!.id, provider: provider as 'hermes' | 'openclaw',
      name, mission, reason, deployedVia: 'ui', region: reg, size: sz,
    });
    return res.status(201).json(mapExternalAgent(row as ExternalAgentRow));
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Deploy failed' });
  }
});

// POST external-agents/:id/stop
agentsRouter.post('/orgs/:orgId/external-agents/:id/stop', requireMember(), async (req, res) => {
  const { orgId, id } = req.params;
  const { data, error } = await req.db!
    .from('external_agents')
    .update({ status: 'stopped', updated_at: new Date().toISOString() })
    .eq('id', id).eq('org_id', orgId)
    .select('*').maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  const stopped = data as ExternalAgentRow;
  // Tear down the real Orgo VM if this agent is backed by one.
  const orgoId = stopped.config?.orgo?.computerId;
  if (orgoId) {
    const creds = await loadOrgoCreds(orgId);
    if (creds) await orgoStop(creds.apiKey, orgoId);
  }
  await logAgentEvent(req.db!, orgId, id, 'message', 'Agent stopped by operator.');
  return res.json(mapExternalAgent(stopped));
});

// DELETE external-agents/:id
agentsRouter.delete('/orgs/:orgId/external-agents/:id', requireMember(), async (req, res) => {
  const { orgId, id } = req.params;
  // Destroy the backing Orgo VM (if any) before deleting the record.
  const { data: existing } = await req.db!
    .from('external_agents').select('config').eq('id', id).eq('org_id', orgId).maybeSingle();
  const orgoId = (existing as { config?: { orgo?: { computerId?: string } } } | null)?.config?.orgo?.computerId;
  if (orgoId) {
    const creds = await loadOrgoCreds(orgId);
    if (creds) await orgoDestroy(creds.apiKey, orgoId);
  }
  const { error } = await req.db!.from('external_agents').delete().eq('id', id).eq('org_id', orgId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Public callback webhook — how a remote agent VM reports back to DeepLogic
// central. Machine-to-machine: authenticated by the per-agent callback_token
// (NOT a user JWT), so it's mounted on the PUBLIC router and uses the service
// client (bypasses RLS, since there is no user session on the VM side).
// ---------------------------------------------------------------------------
export const agentCallbackRouter = Router();

agentCallbackRouter.post('/agent-callback/:id', async (req, res) => {
  const { id } = req.params;
  const token = (req.headers['x-agent-token']?.toString() ?? '') ||
    (req.headers.authorization?.toString() ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing agent token' });

  const { data: agent, error } = await serviceClient
    .from('external_agents').select('id, org_id, callback_token').eq('id', id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!agent || (agent as { callback_token: string | null }).callback_token !== token) {
    return res.status(403).json({ error: 'Invalid agent token' });
  }
  const orgId = (agent as { org_id: string }).org_id;

  const body = (req.body || {}) as { status?: string; message?: string; progress?: number; result?: unknown };
  const status = ['in_progress', 'completed', 'failed'].includes(body.status ?? '') ? body.status! : null;
  const kindMap: Record<string, string> = { in_progress: 'progress', completed: 'completed', failed: 'failed' };

  if (status) {
    const patch: Record<string, unknown> = { mission_status: status, updated_at: new Date().toISOString() };
    if (status === 'completed') { patch.result = body.result ?? null; patch.mission_completed_at = new Date().toISOString(); }
    if (status === 'failed') patch.mission_completed_at = new Date().toISOString();
    await serviceClient.from('external_agents').update(patch).eq('id', id);
  }
  await serviceClient.from('external_agent_events').insert({
    agent_id: id, org_id: orgId,
    kind: status ? (kindMap[status] ?? 'message') : 'message',
    message: (body.message ?? '').toString().slice(0, 1000),
    data: body.result ? (body.result as object) : (typeof body.progress === 'number' ? { progress: body.progress } : null),
  });

  // Mirror the report into the unified AI Activity Log.
  const { data: ea } = await serviceClient.from('external_agents').select('name, provider, mission').eq('id', id).maybeSingle();
  const eaName = (ea as { name?: string; provider?: string } | null)?.name || (ea as { provider?: string } | null)?.provider || 'External agent';
  const runId = await ensureExternalRun(serviceClient, orgId, id, eaName);
  if (body.message || typeof body.progress === 'number') {
    await appendEvent(serviceClient, orgId, runId, 'step', (body.message ?? `Progress ${body.progress}%`).toString(), '🛰', typeof body.progress === 'number' ? { progress: body.progress } : undefined);
  }
  if (status === 'completed') {
    const resultText = typeof body.result === 'string' ? body.result : JSON.stringify(body.result ?? {}, null, 2);
    await appendEvent(serviceClient, orgId, runId, 'output', resultText.slice(0, 2000), '📄', body.result as object);
    await finishRun(serviceClient, runId, 'succeeded', { result: resultText });
  } else if (status === 'failed') {
    await appendEvent(serviceClient, orgId, runId, 'step', `Mission failed: ${(body.message ?? '').toString()}`, '✗');
    await finishRun(serviceClient, runId, 'failed', { error: (body.message ?? 'Mission failed').toString() });
  }
  return res.json({ ok: true });
});

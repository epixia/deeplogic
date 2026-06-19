// Goals — a business objective decomposed into an ordered plan and the agent
// team that delivers it. CRUD plus an AI "draft plan" endpoint that turns a
// goal title (e.g. "Increase sales visibility") into a plan + suggested agents.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { requireMember } from '../auth.js';
import { serviceClient } from '../supabase.js';
import { loadAiConfig, serverFallbackAi, executeInternalAgentRun } from './studio.js';
import { type AiProvider } from '../studio/generator.js';

export const goalsRouter = Router();

interface GoalAgent { name: string; role: string }

function mapGoal(row: Record<string, unknown>) {
  return {
    id: row.id,
    orgId: row.org_id,
    createdBy: row.created_by,
    title: row.title,
    plan: (row.plan ?? []) as string[],
    agents: (row.agents ?? []) as GoalAgent[],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// AI plan drafting
// ---------------------------------------------------------------------------

async function draftPlan(
  title: string,
  ai: { provider: AiProvider; apiKey: string; model?: string },
): Promise<{ plan: string[]; agents: GoalAgent[] }> {
  const system =
    'You are a planning engine for a data/BI platform. Given a business GOAL, produce a concise, ' +
    'actionable plan and the small team of automated agents that would deliver it. ' +
    'Steps must be short imperative phrases (e.g. "Identify core sales KPIs"). ' +
    'Agents must each have a short name ending in "agent" and a one-line role. ' +
    'Return 4-7 steps and 3-6 agents. Respond ONLY with valid JSON of shape: ' +
    '{ "plan": ["step", ...], "agents": [{ "name": "...", "role": "..." }, ...] }. ' +
    'No markdown, no code fences, no commentary.';
  const userMsg = `Goal: ${title}`;

  try {
    if (ai.provider === 'openai' || ai.provider === 'openrouter') {
      const baseURL = ai.provider === 'openrouter'
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      const r = await fetch(baseURL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ai.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ai.model ?? 'gpt-4o-mini',
          max_tokens: 700,
          messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
          response_format: { type: 'json_object' },
        }),
      });
      const j = await r.json() as { choices?: { message?: { content?: string } }[] };
      return normalize(JSON.parse(j.choices?.[0]?.message?.content ?? '{}'));
    }
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: ai.apiKey });
    const msg = await client.messages.create({
      model: ai.model ?? 'claude-sonnet-4-6',
      max_tokens: 700,
      system,
      messages: [{ role: 'user', content: userMsg }],
    });
    const text = msg.content.find((b) => b.type === 'text')?.text ?? '{}';
    return normalize(JSON.parse(text));
  } catch (err) {
    console.error('[goal draft] AI call failed', err);
    throw new Error('AI drafting failed.');
  }
}

// Starter goals shown when no AI provider is configured.
const STARTER_GOALS: { title: string; reason: string }[] = [
  { title: 'Increase sales visibility', reason: 'Surface core sales KPIs and trends in one place.' },
  { title: 'Map all data sources into the Data Vault', reason: 'Know every connector, table and KPI you have.' },
  { title: 'Detect stale or broken data feeds', reason: 'Catch refresh failures before they reach reports.' },
  { title: 'Benchmark against competitors', reason: 'Track competitor moves and compare key metrics.' },
  { title: 'Automate weekly executive summary', reason: 'A scheduled agent that writes the weekly recap.' },
];

async function suggestGoals(
  inventory: string,
  ai: { provider: AiProvider; apiKey: string; model?: string },
): Promise<{ title: string; reason: string }[]> {
  const system =
    'You suggest high-value business GOALS for a company using a data/BI platform. ' +
    'Each goal is a short outcome-focused title plus a one-line reason. ' +
    'Prefer goals achievable with the data the company already has. ' +
    'Return 5-6 suggestions. Respond ONLY with valid JSON: ' +
    '{ "goals": [{ "title": "...", "reason": "..." }, ...] }. No markdown, no commentary.';
  const userMsg = inventory
    ? `The company's Data Vault contains:\n${inventory}\n\nSuggest goals grounded in this.`
    : 'The Data Vault is empty. Suggest broadly useful starter goals for a data/BI workspace.';

  const parse = (txt: string) => {
    const o = (JSON.parse(txt || '{}') ?? {}) as { goals?: unknown };
    return Array.isArray(o.goals)
      ? o.goals
          .map((g) => {
            const x = (g ?? {}) as { title?: unknown; reason?: unknown };
            return { title: String(x.title ?? '').trim().slice(0, 120), reason: String(x.reason ?? '').trim().slice(0, 200) };
          })
          .filter((g) => g.title)
          .slice(0, 8)
      : [];
  };

  if (ai.provider === 'openai' || ai.provider === 'openrouter') {
    const baseURL = ai.provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
    const r = await fetch(baseURL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ai.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ai.model ?? 'gpt-4o-mini',
        max_tokens: 600,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
        response_format: { type: 'json_object' },
      }),
    });
    const j = await r.json() as { choices?: { message?: { content?: string } }[] };
    return parse(j.choices?.[0]?.message?.content ?? '{}');
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ai.apiKey });
  const msg = await client.messages.create({
    model: ai.model ?? 'claude-sonnet-4-6',
    max_tokens: 600,
    system,
    messages: [{ role: 'user', content: userMsg }],
  });
  return parse(msg.content.find((b) => b.type === 'text')?.text ?? '{}');
}

function normalize(raw: unknown): { plan: string[]; agents: GoalAgent[] } {
  const o = (raw ?? {}) as { plan?: unknown; agents?: unknown };
  const plan = Array.isArray(o.plan)
    ? o.plan.map((s) => String(s).trim()).filter(Boolean).slice(0, 10)
    : [];
  const agents = Array.isArray(o.agents)
    ? o.agents
        .map((a) => {
          const x = (a ?? {}) as { name?: unknown; role?: unknown };
          return { name: String(x.name ?? '').trim().slice(0, 80), role: String(x.role ?? '').trim().slice(0, 200) };
        })
        .filter((a) => a.name)
        .slice(0, 8)
    : [];
  return { plan, agents };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// GET /orgs/:orgId/goals
goalsRouter.get('/orgs/:orgId/goals', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  try {
    const { data, error } = await serviceClient
      .from('goals').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json((data ?? []).map((r) => mapGoal(r as Record<string, unknown>)));
  } catch (err) {
    console.error('GET goals failed', err);
    res.status(500).json({ error: 'Failed to load goals' });
  }
});

// POST /orgs/:orgId/goals/draft — AI-draft a plan + agents from a goal title
goalsRouter.post('/orgs/:orgId/goals/draft', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const title = String((req.body ?? {}).title ?? '').trim();
  if (!title) { res.status(400).json({ error: 'title is required' }); return; }
  try {
    const ai = (await loadAiConfig(orgId).catch(() => null)) ?? serverFallbackAi();
    if (!ai) { res.status(400).json({ error: 'No AI provider configured — add an API key in Settings.' }); return; }
    const draft = await draftPlan(title, ai);
    res.json(draft);
  } catch (err) {
    console.error('POST goals/draft failed', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to draft plan' });
  }
});

// POST /orgs/:orgId/goals/suggest — suggest valuable goals, grounded in the
// org's Data Vault. Falls back to starter goals if no AI provider is set.
goalsRouter.post('/orgs/:orgId/goals/suggest', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  try {
    const { data } = await serviceClient
      .from('context_items')
      .select('name, kind, category')
      .eq('org_id', orgId)
      .limit(60);
    const items = (data ?? []) as { name: string; kind: string; category: string }[];
    const inventory = items.map((it) => `- ${it.name} (${it.category || it.kind})`).join('\n');

    const ai = (await loadAiConfig(orgId).catch(() => null)) ?? serverFallbackAi();
    if (!ai) { res.json({ goals: STARTER_GOALS, usedAI: false, inventoryCount: items.length }); return; }
    try {
      const goals = await suggestGoals(inventory, ai);
      res.json({ goals: goals.length ? goals : STARTER_GOALS, usedAI: goals.length > 0, inventoryCount: items.length });
    } catch (e) {
      console.error('[goal suggest] AI failed', e);
      res.json({ goals: STARTER_GOALS, usedAI: false, inventoryCount: items.length, aiError: e instanceof Error ? e.message : 'AI error' });
    }
  } catch (err) {
    console.error('POST goals/suggest failed', err);
    res.status(500).json({ error: 'Failed to suggest goals' });
  }
});

// POST /orgs/:orgId/goals/:id/run/stream — orchestrate a goal: ensure each of
// its agents exists (create from the plan if missing), run them, and stream the
// live thoughts + results (SSE). Each run lands in the AI Activity Log.
goalsRouter.post('/orgs/:orgId/goals/:id/run/stream', requireMember(), async (req: Request, res: Response) => {
  const { orgId, id } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const { data: goal, error } = await req.db!
    .from('goals').select('id, title, plan, agents').eq('id', id).eq('org_id', orgId).maybeSingle();
  if (error || !goal) { send({ type: 'error', error: 'Goal not found' }); return res.end(); }
  const g = goal as { id: string; title: string; plan: string[]; agents: GoalAgent[] };
  const planText = (g.plan ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n');
  const wanted = (g.agents ?? []).filter((a) => a && a.name);

  send({ type: 'step', icon: '🎯', text: `Orchestrating goal: ${g.title}` });
  if (wanted.length === 0) { send({ type: 'error', error: 'This goal has no agents defined yet.' }); return res.end(); }

  // One group id ties all of this orchestration's agent runs into one card.
  const groupId = randomUUID();
  const groupLabel = `Goal: ${g.title}`;

  // Existing agents for name matching.
  const { data: existing } = await req.db!.from('agents').select('id, name, model, system_prompt').eq('org_id', orgId).limit(200);
  const list = (existing ?? []) as { id: string; name: string; model: string; system_prompt: string }[];

  const results: { agent: string; ok: boolean; output?: string; error?: string }[] = [];
  for (const ga of wanted) {
    const lc = ga.name.toLowerCase();
    let agent = list.find((a) => a.name.toLowerCase() === lc) ?? list.find((a) => a.name.toLowerCase().includes(lc) || lc.includes(a.name.toLowerCase()));
    if (!agent) {
      send({ type: 'step', icon: '🤖', text: `Creating agent "${ga.name}"` });
      const systemPrompt =
        `You are the "${ga.name}" agent working toward the goal "${g.title}".\n` +
        `Your role: ${ga.role || 'support this goal'}.\n` +
        (planText ? `The goal's plan:\n${planText}\n` : '') +
        `Use your tools (web research, reading pages, the Data Vault) to do your part of this goal now and report concrete, sourced findings.`;
      const { data: created } = await req.db!.from('agents').insert({
        org_id: orgId, created_by: req.user!.id, name: ga.name.slice(0, 80),
        description: (ga.role || '').slice(0, 240), model: 'claude-sonnet-4-6', system_prompt: systemPrompt.slice(0, 8000),
      }).select('id, name, model, system_prompt').maybeSingle();
      if (created) { agent = created as typeof list[number]; list.push(agent); }
    }
    if (!agent) { results.push({ agent: ga.name, ok: false, error: 'Could not create agent' }); continue; }
    send({ type: 'step', icon: '▶️', text: `Running "${agent.name}"` });
    try {
      const { output } = await executeInternalAgentRun(req, orgId, agent, {
        trigger: 'goal',
        triggerContext: { goalId: g.id, goalTitle: g.title },
        groupId, groupLabel,
        onStep: (s) => send({ type: 'step', icon: s.icon, text: `${agent!.name}: ${s.text}` }),
      });
      results.push({ agent: agent.name, ok: true, output: output.slice(0, 4000) });
    } catch (e) {
      results.push({ agent: agent.name, ok: false, error: e instanceof Error ? e.message : 'run failed' });
    }
  }
  send({ type: 'done', results });
  return res.end();
});

// POST /orgs/:orgId/goals
goalsRouter.post('/orgs/:orgId/goals', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const { title, plan = [], agents = [], status = 'active' } = req.body ?? {};
  if (!title?.trim()) { res.status(400).json({ error: 'title is required' }); return; }
  try {
    const { data, error } = await serviceClient
      .from('goals')
      .insert({
        org_id: orgId, created_by: req.user!.id, title: title.trim(),
        plan: Array.isArray(plan) ? plan : [],
        agents: Array.isArray(agents) ? agents : [],
        status,
      })
      .select('*').maybeSingle();
    if (error) throw new Error(error.message);
    res.status(201).json(mapGoal(data as Record<string, unknown>));
  } catch (err) {
    console.error('POST goal failed', err);
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

// PATCH /orgs/:orgId/goals/:id
goalsRouter.patch('/orgs/:orgId/goals/:id', requireMember(), async (req: Request, res: Response) => {
  const { orgId, id } = req.params;
  const body = req.body ?? {};
  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
    if (Array.isArray(body.plan)) patch.plan = body.plan;
    if (Array.isArray(body.agents)) patch.agents = body.agents;
    if (body.status === 'active' || body.status === 'done' || body.status === 'archived') patch.status = body.status;
    const { data, error } = await serviceClient
      .from('goals').update(patch).eq('id', id).eq('org_id', orgId).select('*').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) { res.status(404).json({ error: 'Goal not found' }); return; }
    res.json(mapGoal(data as Record<string, unknown>));
  } catch (err) {
    console.error('PATCH goal failed', err);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

// DELETE /orgs/:orgId/goals/:id
goalsRouter.delete('/orgs/:orgId/goals/:id', requireMember(), async (req: Request, res: Response) => {
  const { orgId, id } = req.params;
  try {
    const { error } = await serviceClient.from('goals').delete().eq('id', id).eq('org_id', orgId);
    if (error) throw new Error(error.message);
    res.status(204).end();
  } catch (err) {
    console.error('DELETE goal failed', err);
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});

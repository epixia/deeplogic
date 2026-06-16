// Agents — CRUD for org-scoped AI agents with optional cron schedule.
// All routes under /api/orgs/:orgId/agents, protected by requireMember().

import { Router } from 'express';
import { requireMember } from '../auth.js';

export const agentsRouter = Router();

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
    isOwner: row.created_by === userId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

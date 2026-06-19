// Third-party integration settings — currently Orgo.ai (virtual computers for
// autonomous agents). The API key lives server-side (org_integrations, read via
// the service role); the client only ever sees an { enabled, hasKey } view.

import { Router } from 'express';
import { requireMember } from '../auth.js';
import { serviceClient } from '../supabase.js';
import { orgoTestKey } from '../integrations/orgo.js';

export const integrationsRouter = Router();

export interface OrgoCreds { apiKey: string; workspaceId: string | null }

// Loader for the deploy flow: null unless Orgo is enabled AND a key is present.
export async function loadOrgoCreds(orgId: string): Promise<OrgoCreds | null> {
  const { data } = await serviceClient
    .from('org_integrations')
    .select('orgo_enabled, orgo_api_key, orgo_workspace_id')
    .eq('org_id', orgId)
    .maybeSingle();
  const row = data as { orgo_enabled?: boolean; orgo_api_key?: string | null; orgo_workspace_id?: string | null } | null;
  if (!row || !row.orgo_enabled || !row.orgo_api_key) return null;
  return { apiKey: row.orgo_api_key, workspaceId: row.orgo_workspace_id ?? null };
}

export async function cacheOrgoWorkspace(orgId: string, workspaceId: string): Promise<void> {
  await serviceClient
    .from('org_integrations')
    .update({ orgo_workspace_id: workspaceId, updated_at: new Date().toISOString() })
    .eq('org_id', orgId);
}

async function orgoView(orgId: string) {
  const { data } = await serviceClient
    .from('org_integrations').select('orgo_enabled, orgo_api_key').eq('org_id', orgId).maybeSingle();
  const row = data as { orgo_enabled?: boolean; orgo_api_key?: string | null } | null;
  return { enabled: !!row?.orgo_enabled, hasKey: !!row?.orgo_api_key };
}

// GET integrations — non-secret view for the Settings → Integrations tab.
integrationsRouter.get('/orgs/:orgId/integrations', requireMember(), async (req, res) => {
  res.json({ orgo: await orgoView(req.params.orgId) });
});

// PUT integrations/orgo { enabled?, apiKey? } — save toggle and/or key.
integrationsRouter.put('/orgs/:orgId/integrations/orgo', requireMember(), async (req, res) => {
  const { orgId } = req.params;
  const { enabled, apiKey } = (req.body || {}) as { enabled?: boolean; apiKey?: string };
  const patch: Record<string, unknown> = { org_id: orgId, updated_at: new Date().toISOString() };
  if (typeof enabled === 'boolean') patch.orgo_enabled = enabled;
  if (typeof apiKey === 'string') patch.orgo_api_key = apiKey.trim() || null;
  const { error } = await serviceClient.from('org_integrations').upsert(patch, { onConflict: 'org_id' });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ orgo: await orgoView(orgId) });
});

// POST integrations/orgo/test { apiKey? } — validate the provided or stored key.
integrationsRouter.post('/orgs/:orgId/integrations/orgo/test', requireMember(), async (req, res) => {
  const { orgId } = req.params;
  let apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
  if (!apiKey) {
    const { data } = await serviceClient
      .from('org_integrations').select('orgo_api_key').eq('org_id', orgId).maybeSingle();
    apiKey = (data as { orgo_api_key?: string | null } | null)?.orgo_api_key ?? '';
  }
  if (!apiKey) return res.json({ ok: false, error: 'No Orgo API key set.' });
  return res.json(await orgoTestKey(apiKey));
});

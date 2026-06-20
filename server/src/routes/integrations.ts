// Third-party integration settings — currently Orgo.ai (virtual computers for
// autonomous agents). The API key lives server-side (org_integrations, read via
// the service role); the client only ever sees an { enabled, hasKey } view.

import { Router } from 'express';
import { requireMember } from '../auth.js';
import { serviceClient } from '../supabase.js';
import { orgoTestKey } from '../integrations/orgo.js';
import { dataforseoTestKey } from '../integrations/dataforseo.js';

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

// ---------------------------------------------------------------------------
// Platform APIs — first-party data providers the platform calls server-side
// (DataForSEO, …). Credentials are stored in org_platform_apis (service-role
// only) and never returned; the client sees only { enabled, hasCreds }.
// ---------------------------------------------------------------------------

const PLATFORM_PROVIDERS = ['dataforseo'] as const;
type PlatformProvider = (typeof PLATFORM_PROVIDERS)[number];
const isProvider = (p: string): p is PlatformProvider =>
  (PLATFORM_PROVIDERS as readonly string[]).includes(p);

// Loader for platform features: null unless enabled AND credentials are present.
export async function loadPlatformApiCreds(
  orgId: string,
  provider: PlatformProvider,
): Promise<Record<string, string> | null> {
  const { data } = await serviceClient
    .from('org_platform_apis')
    .select('enabled, credentials')
    .eq('org_id', orgId).eq('provider', provider).maybeSingle();
  const row = data as { enabled?: boolean; credentials?: Record<string, string> | null } | null;
  if (!row || !row.enabled || !row.credentials || Object.keys(row.credentials).length === 0) return null;
  return row.credentials;
}

async function platformApisView(orgId: string) {
  const { data } = await serviceClient
    .from('org_platform_apis').select('provider, enabled, credentials').eq('org_id', orgId);
  const rows = (data ?? []) as { provider: string; enabled: boolean; credentials: Record<string, unknown> | null }[];
  const map: Record<string, { enabled: boolean; hasCreds: boolean }> = {};
  for (const p of PLATFORM_PROVIDERS) map[p] = { enabled: false, hasCreds: false };
  for (const r of rows) {
    if (!isProvider(r.provider)) continue;
    map[r.provider] = { enabled: !!r.enabled, hasCreds: !!r.credentials && Object.keys(r.credentials).length > 0 };
  }
  return map;
}

// GET — non-secret view for the Settings → APIs tab.
integrationsRouter.get('/orgs/:orgId/platform-apis', requireMember(), async (req, res) => {
  res.json({ providers: await platformApisView(req.params.orgId) });
});

// PUT { enabled?, credentials? } — save toggle and/or credentials. Credentials
// are only overwritten when non-empty values are supplied, so a bare toggle
// never wipes a saved key.
integrationsRouter.put('/orgs/:orgId/platform-apis/:provider', requireMember(), async (req, res) => {
  const { orgId, provider } = req.params;
  if (!isProvider(provider)) return res.status(400).json({ error: 'Unknown provider.' });
  const { enabled, credentials } = (req.body || {}) as {
    enabled?: boolean;
    credentials?: Record<string, unknown>;
  };
  const patch: Record<string, unknown> = { org_id: orgId, provider, updated_at: new Date().toISOString() };
  if (typeof enabled === 'boolean') patch.enabled = enabled;
  if (credentials && typeof credentials === 'object') {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(credentials)) {
      if (typeof v === 'string' && v.trim()) clean[k] = v.trim();
    }
    if (Object.keys(clean).length) patch.credentials = clean;
  }
  const { error } = await serviceClient
    .from('org_platform_apis').upsert(patch, { onConflict: 'org_id,provider' });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ providers: await platformApisView(orgId) });
});

// DELETE — remove a provider's credentials entirely.
integrationsRouter.delete('/orgs/:orgId/platform-apis/:provider', requireMember(), async (req, res) => {
  const { orgId, provider } = req.params;
  if (!isProvider(provider)) return res.status(400).json({ error: 'Unknown provider.' });
  const { error } = await serviceClient
    .from('org_platform_apis').delete().eq('org_id', orgId).eq('provider', provider);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ providers: await platformApisView(orgId) });
});

// POST .../test { credentials? } — validate the provided or stored credentials.
integrationsRouter.post('/orgs/:orgId/platform-apis/:provider/test', requireMember(), async (req, res) => {
  const { orgId, provider } = req.params;
  if (!isProvider(provider)) return res.status(400).json({ error: 'Unknown provider.' });
  const supplied = (req.body?.credentials || {}) as Record<string, string>;

  if (provider === 'dataforseo') {
    let login = typeof supplied.login === 'string' ? supplied.login.trim() : '';
    let password = typeof supplied.password === 'string' ? supplied.password.trim() : '';
    if (!login || !password) {
      const stored = await loadPlatformApiCreds(orgId, 'dataforseo');
      login = login || (stored?.login ?? '');
      password = password || (stored?.password ?? '');
    }
    if (!login || !password) return res.json({ ok: false, error: 'Enter your DataForSEO login and password.' });
    return res.json(await dataforseoTestKey(login, password));
  }
  return res.status(400).json({ error: 'Unknown provider.' });
});

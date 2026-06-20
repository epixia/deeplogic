// Webhook Connector — inbound ingest endpoint for external apps / Zapier / Make.
//
//   external app → POST /api/webhooks/:orgId/ingest?token=… → org_webhook_events
//                  (DataVault) → Blocks / Signals / Agents
//
// This route is PUBLIC (no user session): callers authenticate with the per-org
// webhook token. It is mounted before requireAuth in index.ts. Token issuance &
// the non-secret view live on the authed studio router (GET /orgs/:orgId/webhook).

import { Router } from 'express';
import { serviceClient } from '../supabase.js';

export const webhookIngestRouter = Router();

// POST /api/webhooks/:orgId/ingest?token=…&source=… — accept a JSON payload.
webhookIngestRouter.post('/webhooks/:orgId/ingest', async (req, res) => {
  const { orgId } = req.params;
  const token = (req.query.token ?? req.header('x-deeplogic-token') ?? '').toString().trim();
  if (!token) { res.status(401).json({ error: 'Missing webhook token.' }); return; }

  // Validate the token against the org's issued webhook token (service role).
  const { data } = await serviceClient
    .from('org_webhooks').select('token').eq('org_id', orgId).maybeSingle();
  const expected = (data as { token?: string } | null)?.token;
  if (!expected || expected !== token) { res.status(403).json({ error: 'Invalid webhook token.' }); return; }

  const payload = req.body ?? {};
  const source = typeof req.query.source === 'string' ? req.query.source.slice(0, 120) : null;
  const { error } = await serviceClient
    .from('org_webhook_events')
    .insert({ org_id: orgId, source, payload });
  if (error) { res.status(500).json({ error: error.message }); return; }

  res.json({ ok: true });
});

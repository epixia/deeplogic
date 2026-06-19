// Memory graph routes — build and query the native knowledge graph.
//   POST /memory/ingest   — ingest arbitrary text or a vault item by id
//   POST /memory/rebuild  — (re)build the graph from all enabled vault items
//   GET  /memory/graph    — entities + facts for the Memory page
//   GET  /memory/recall   — semantic recall over currently-valid facts

import { Router, type Request, type Response } from 'express';
import { requireMember } from '../auth.js';
import { loadAiConfig } from './studio.js';
import { resolveEmbeddingKey } from '../studio/embeddings.js';
import { ingestEpisode, recallMemory, getMemoryGraph } from '../memory/graph.js';

export const memoryRouter = Router();

// POST /memory/ingest { itemId? , text?, title?, sourceKind? }
memoryRouter.post('/orgs/:orgId/memory/ingest', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const body = (req.body || {}) as { itemId?: string; text?: string; title?: string; sourceKind?: string };
  try {
    let title = body.title ?? '';
    let text = body.text ?? '';
    let sourceRef: string | undefined;
    if (body.itemId) {
      const { data } = await req.db!.from('context_items')
        .select('id, name, content').eq('id', body.itemId).eq('org_id', orgId).maybeSingle();
      const item = data as { id: string; name: string; content: string | null } | null;
      if (!item) { res.status(404).json({ error: 'Vault item not found' }); return; }
      title = item.name; text = item.content ?? ''; sourceRef = item.id;
    }
    if (!text.trim()) { res.status(400).json({ error: 'Nothing to ingest' }); return; }
    const ai = await loadAiConfig(orgId).catch(() => null);
    const embedKey = resolveEmbeddingKey(ai);
    const result = await ingestEpisode(req.db!, orgId,
      { sourceKind: body.sourceKind ?? (body.itemId ? 'vault' : 'manual'), sourceRef, title, text }, ai, embedKey);
    res.json(result);
  } catch (err) {
    console.error('memory ingest failed', err);
    res.status(500).json({ error: 'Ingest failed' });
  }
});

// POST /memory/rebuild?reset=true — build from all enabled vault items.
memoryRouter.post('/orgs/:orgId/memory/rebuild', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const reset = String(req.query.reset ?? '') === 'true';
  try {
    if (reset) {
      // Order matters only loosely (FKs cascade); clear all three.
      await req.db!.from('memory_facts').delete().eq('org_id', orgId);
      await req.db!.from('memory_episodes').delete().eq('org_id', orgId);
      await req.db!.from('memory_entities').delete().eq('org_id', orgId);
    }
    const ai = await loadAiConfig(orgId).catch(() => null);
    if (!ai) { res.status(400).json({ error: 'Connect an AI provider in Settings → AI to build memory.' }); return; }
    const embedKey = resolveEmbeddingKey(ai);

    const { data } = await req.db!.from('context_items')
      .select('id, name, content').eq('org_id', orgId).eq('enabled', true);
    const items = ((data ?? []) as { id: string; name: string; content: string | null }[])
      .filter((i) => (i.content ?? '').trim().length > 40)
      .slice(0, 60); // safety cap per rebuild

    let entities = 0, facts = 0, superseded = 0, processed = 0;
    for (const it of items) {
      try {
        const r = await ingestEpisode(req.db!, orgId,
          { sourceKind: 'vault', sourceRef: it.id, title: it.name, text: it.content ?? '' }, ai, embedKey);
        entities += r.entities; facts += r.facts; superseded += r.superseded; processed++;
      } catch { /* skip a failed item */ }
    }
    res.json({ processed, totalItems: items.length, entities, facts, superseded });
  } catch (err) {
    console.error('memory rebuild failed', err);
    res.status(500).json({ error: 'Rebuild failed' });
  }
});

// GET /memory/graph?includeStale=true
memoryRouter.get('/orgs/:orgId/memory/graph', requireMember(), async (req: Request, res: Response) => {
  try {
    const includeStale = String(req.query.includeStale ?? '') === 'true';
    res.json(await getMemoryGraph(req.db!, req.params.orgId, includeStale));
  } catch (err) {
    console.error('memory graph failed', err);
    res.status(500).json({ error: 'Failed to load memory graph' });
  }
});

// GET /memory/recall?q=...&k=12
memoryRouter.get('/orgs/:orgId/memory/recall', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const q = (req.query.q ?? '').toString().trim();
  if (!q) { res.status(400).json({ error: 'q required' }); return; }
  const k = Math.min(30, Math.max(1, Number(req.query.k) || 12));
  try {
    const ai = await loadAiConfig(orgId).catch(() => null);
    const embedKey = resolveEmbeddingKey(ai);
    res.json({ facts: await recallMemory(req.db!, orgId, q, k, embedKey) });
  } catch (err) {
    console.error('memory recall failed', err);
    res.status(500).json({ error: 'Recall failed' });
  }
});

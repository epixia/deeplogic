// Public proxy for open-data APIs that lack permissive CORS, so self-contained
// Blocks (rendered in a null-origin sandboxed iframe) can read them. Currently:
// Open Government Canada's CKAN Datastore Search. No auth — it only relays public
// open data, with the upstream host hard-coded and inputs validated (no SSRF).

import { Router } from 'express';

export const openDataRouter = Router();

// GET /open-data/ckan?resource_id=<id>&q=<search>&limit=<n>
openDataRouter.get('/open-data/ckan', async (req, res) => {
  const rid = String(req.query.resource_id ?? '').trim();
  if (!/^[a-f0-9-]{8,40}$/i.test(rid)) { res.status(400).json({ error: 'Invalid resource_id.' }); return; }
  const q = String(req.query.q ?? '').trim().slice(0, 200);
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '25'), 10) || 25, 1), 100);

  const url = `https://open.canada.ca/data/en/api/3/action/datastore_search?resource_id=${encodeURIComponent(rid)}&limit=${limit}`
    + (q ? `&q=${encodeURIComponent(q)}` : '');
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) { res.status(502).json({ error: `Open Canada returned ${r.status}.` }); return; }
    const j = await r.json();
    res.json(j);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : 'Open Canada fetch failed.' });
  }
});

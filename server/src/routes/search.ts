// Web search proxy — wraps Brave Search API so the client never exposes the key.
// Requires BRAVE_SEARCH_API_KEY in .env (free tier: 2000 queries/month).
// GET /api/orgs/:orgId/search?q=<query>[&count=5]

import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireMember } from '../auth.js';

export const searchRouter = Router();

interface BraveResult {
  title: string;
  url: string;
  description?: string;
  extra_snippets?: string[];
}

interface BraveResponse {
  web?: { results?: BraveResult[] };
}

searchRouter.get(
  '/orgs/:orgId/search',
  requireMember(),
  async (req: Request, res: Response) => {
    const q = (req.query.q as string | undefined)?.trim();
    if (!q) { res.status(400).json({ error: 'q is required' }); return; }

    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'Web search not configured — add BRAVE_SEARCH_API_KEY to server/.env' });
      return;
    }

    const count = Math.min(Number(req.query.count) || 5, 10);

    try {
      const url =
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${count}&search_lang=en&text_decorations=false`;
      const r = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        throw new Error(`Brave Search ${r.status}: ${body.slice(0, 200)}`);
      }
      const data = (await r.json()) as BraveResponse;
      const results = (data.web?.results ?? []).slice(0, count).map((item) => ({
        title: item.title,
        url: item.url,
        snippet: item.description ?? item.extra_snippets?.[0] ?? '',
      }));
      res.json({ results });
    } catch (err) {
      console.error('web search failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Search failed' });
    }
  }
);

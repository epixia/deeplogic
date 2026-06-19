// Web search proxy — keyless by default (DuckDuckGo), Brave when
// BRAVE_SEARCH_API_KEY is set. Used by the Studio/Widget "web research" toggle.
// GET /api/orgs/:orgId/search?q=<query>[&count=5]

import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireMember } from '../auth.js';
import { webSearch } from '../webSearch.js';

export const searchRouter = Router();

searchRouter.get(
  '/orgs/:orgId/search',
  requireMember(),
  async (req: Request, res: Response) => {
    const q = (req.query.q as string | undefined)?.trim();
    if (!q) { res.status(400).json({ error: 'q is required' }); return; }
    const count = Math.min(Number(req.query.count) || 5, 10);
    try {
      const results = await webSearch(q, count);
      res.json({ results });
    } catch (err) {
      console.error('web search failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Search failed' });
    }
  }
);

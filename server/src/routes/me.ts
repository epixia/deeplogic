// GET /api/me -> { user, orgs }
// Requires a valid Bearer JWT (mounted behind requireAuth).

import { Router } from 'express';
import type { Request, Response } from 'express';
import { serviceClient } from '../supabase.js';
import { listOrgsForUser } from '../repo.js';

export const meRouter = Router();

meRouter.get('/me', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const orgs = await listOrgsForUser(serviceClient, req.user.id);
    res.json({ user: req.user, orgs });
  } catch (err) {
    console.error('GET /me failed', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

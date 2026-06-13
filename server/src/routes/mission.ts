// Org-scoped Mission Control live feed (PRD v2).
//   GET /api/orgs/:orgId/models/:id/mission/stream (SSE)
//       -> looping live AgentEvent feed for the org's stored model.

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { SemanticModel } from '../types.js';
import { requireMember } from '../auth.js';
import { getModel } from '../repo.js';
import { missionEvents } from '../engine/index.js';
import { sseInit, sseSend } from '../sse.js';

export const missionRouter = Router();

missionRouter.get(
  '/orgs/:orgId/models/:id/mission/stream',
  requireMember(),
  async (req: Request, res: Response) => {
    let model: SemanticModel | null;
    try {
      model = await getModel(req.db!, req.params.orgId, req.params.id);
    } catch (err) {
      console.error('mission stream load failed', err);
      res.status(500).json({ error: 'Failed to load model' });
      return;
    }
    if (!model) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    sseInit(req, res);
    const base = missionEvents(model);

    let i = 0;
    const emit = () => {
      if (base.length === 0) return;
      const src = base[i % base.length];
      const live = { ...src, id: `${src.id}-${i}`, ts: new Date().toISOString() };
      sseSend(res, live, 'event');
      i += 1;
    };

    emit(); // paint immediately
    const timer = setInterval(emit, 3500);

    req.on('close', () => clearInterval(timer));
  }
);

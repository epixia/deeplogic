// Org-scoped model operations (PRD v2).
//   GET  /api/orgs/:orgId/models                              -> ModelListItem[]
//   GET  /api/orgs/:orgId/models/:id                          -> SemanticModel
//   GET  /api/orgs/:orgId/models/:id/anomalies                -> Anomaly[]
//   POST /api/orgs/:orgId/models/:id/actions/:anomalyId/approve -> AuditEntry
//   GET  /api/orgs/:orgId/models/:id/audit                    -> AuditEntry[]
//   POST /api/orgs/:orgId/models/:id/ask  { question }        -> AskAnswer
//
// All reads/writes run under the caller's RLS client (req.db); membership is
// verified by requireMember() (defense in depth).

import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireMember } from '../auth.js';
import { getModel, listModels, listAudit, insertAudit } from '../repo.js';
import { detectAnomalies, answerQuestion } from '../engine/index.js';

export const modelsRouter = Router();

// GET /api/orgs/:orgId/models
modelsRouter.get(
  '/orgs/:orgId/models',
  requireMember(),
  async (req: Request, res: Response) => {
    try {
      const items = await listModels(req.db!, req.params.orgId);
      res.json(items);
    } catch (err) {
      console.error('GET models failed', err);
      res.status(500).json({ error: 'Failed to list models' });
    }
  }
);

// GET /api/orgs/:orgId/models/:id
modelsRouter.get(
  '/orgs/:orgId/models/:id',
  requireMember(),
  async (req: Request, res: Response) => {
    try {
      const model = await getModel(req.db!, req.params.orgId, req.params.id);
      if (!model) {
        res.status(404).json({ error: 'Model not found' });
        return;
      }
      res.json(model);
    } catch (err) {
      console.error('GET model failed', err);
      res.status(500).json({ error: 'Failed to load model' });
    }
  }
);

// GET /api/orgs/:orgId/models/:id/anomalies
modelsRouter.get(
  '/orgs/:orgId/models/:id/anomalies',
  requireMember(),
  async (req: Request, res: Response) => {
    try {
      const model = await getModel(req.db!, req.params.orgId, req.params.id);
      if (!model) {
        res.status(404).json({ error: 'Model not found' });
        return;
      }
      const anomalies = await detectAnomalies(model);
      res.json(anomalies);
    } catch (err) {
      console.error('detectAnomalies failed', err);
      res.json([]);
    }
  }
);

// POST /api/orgs/:orgId/models/:id/actions/:anomalyId/approve -> AuditEntry
modelsRouter.post(
  '/orgs/:orgId/models/:id/actions/:anomalyId/approve',
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId, id, anomalyId } = req.params;
    try {
      const model = await getModel(req.db!, orgId, id);
      if (!model) {
        res.status(404).json({ error: 'Model not found' });
        return;
      }
      let summary = `Approved recommended action for anomaly ${anomalyId}`;
      try {
        const anomalies = await detectAnomalies(model);
        const a = anomalies.find((x) => x.id === anomalyId);
        if (a) {
          summary =
            `Executed "${a.recommendation.title}" for ${a.kpiName} ` +
            `(${a.rootCause.dimensionName}: ${a.rootCause.label}) on ${a.date}.`;
        }
      } catch {
        // keep generic summary
      }
      const entry = await insertAudit(req.db!, orgId, id, { actor: 'user', summary });
      res.json(entry);
    } catch (err) {
      console.error('approve failed', err);
      res.status(500).json({ error: 'Failed to record action' });
    }
  }
);

// GET /api/orgs/:orgId/models/:id/audit -> AuditEntry[]
modelsRouter.get(
  '/orgs/:orgId/models/:id/audit',
  requireMember(),
  async (req: Request, res: Response) => {
    try {
      const entries = await listAudit(req.db!, req.params.orgId, req.params.id);
      res.json(entries);
    } catch (err) {
      console.error('GET audit failed', err);
      res.status(500).json({ error: 'Failed to load audit log' });
    }
  }
);

// POST /api/orgs/:orgId/models/:id/ask { question } -> AskAnswer
modelsRouter.post(
  '/orgs/:orgId/models/:id/ask',
  requireMember(),
  async (req: Request, res: Response) => {
    try {
      const model = await getModel(req.db!, req.params.orgId, req.params.id);
      if (!model) {
        res.status(404).json({ error: 'Model not found' });
        return;
      }
      const question = (req.body && (req.body.question as string)) || '';
      const answer = answerQuestion(model, question);
      res.json(answer);
    } catch (err) {
      console.error('ask failed', err);
      res.status(500).json({ error: 'Failed to answer question' });
    }
  }
);

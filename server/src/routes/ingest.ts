// Org-scoped ingestion (PRD v2).
//   POST /api/orgs/:orgId/ingest                    -> { modelId }
//        accepts multipart 'file' (.pbix/.pbit) OR JSON { sampleId }
//   GET  /api/orgs/:orgId/ingest/:modelId/stream    (SSE) -> AgentEvent pipeline
//
// Ingestion persists a fresh model row in the org (RLS-scoped via req.db):
//  - { sampleId }: clone the matching bundled sample as a new org model row.
//  - upload: open the archive, try to read a model name, else synthesize from
//    the filename by cloning a sample's shape. We NEVER error the upload.

import { Router, raw } from 'express';
import type { Request, Response } from 'express';
import type { SemanticModel } from '../types.js';
import { requireMember } from '../auth.js';
import { createModelRow, getModel } from '../repo.js';
import { ingestEvents } from '../engine/index.js';
import { sseInit, sseSend, sseDone } from '../sse.js';
import { buildModelFromUpload, resolveSample } from '../ingestParse.js';

export const ingestRouter = Router();

// POST /api/orgs/:orgId/ingest
ingestRouter.post(
  '/orgs/:orgId/ingest',
  requireMember(),
  raw({ type: 'multipart/form-data', limit: '60mb' }),
  async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const contentType = req.headers['content-type'] || '';

    try {
      // --- JSON path: { sampleId } -------------------------------------
      if (contentType.includes('application/json')) {
        const sampleId = (req.body && (req.body.sampleId as string)) || '';
        const data: SemanticModel = resolveSample(sampleId);
        // Idempotent: reuse an existing same-named sample model in this org
        // instead of piling up duplicates on repeated ingests.
        const { data: existing } = await req
          .db!.from('models')
          .select('id')
          .eq('org_id', orgId)
          .eq('source', 'sample')
          .eq('name', data.name)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (existing && (existing as { id?: string }).id) {
          res.json({ modelId: (existing as { id: string }).id });
          return;
        }
        const modelId = await createModelRow(req.db!, orgId, {
          name: data.name,
          source: 'sample',
          data,
        });
        res.json({ modelId });
        return;
      }

      // --- Multipart path: file upload (graceful synthetic fallback) ----
      const bodyBuf = Buffer.isBuffer(req.body) ? (req.body as Buffer) : null;
      const data = buildModelFromUpload(bodyBuf, contentType);
      const modelId = await createModelRow(req.db!, orgId, {
        name: data.name,
        source: 'upload',
        data,
      });
      res.json({ modelId });
    } catch (err) {
      console.error('ingest failed', err);
      res.status(500).json({ error: 'Failed to ingest model' });
    }
  }
);

// GET /api/orgs/:orgId/ingest/:modelId/stream — staged pipeline over ~6-10s.
ingestRouter.get(
  '/orgs/:orgId/ingest/:modelId/stream',
  requireMember(),
  async (req: Request, res: Response) => {
    let model: SemanticModel | null;
    try {
      model = await getModel(req.db!, req.params.orgId, req.params.modelId);
    } catch (err) {
      console.error('ingest stream load failed', err);
      res.status(500).json({ error: 'Failed to load model' });
      return;
    }
    if (!model) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    sseInit(req, res);
    const events = ingestEvents(model);
    let i = 0;
    const stepMs =
      events.length > 0
        ? Math.min(1200, Math.max(700, Math.floor(8000 / events.length)))
        : 800;

    const timer = setInterval(() => {
      if (i >= events.length) {
        clearInterval(timer);
        sseDone(res, { done: true, modelId: model!.id });
        return;
      }
      sseSend(res, events[i], 'event');
      i += 1;
    }, stepMs);

    req.on('close', () => clearInterval(timer));
  }
);

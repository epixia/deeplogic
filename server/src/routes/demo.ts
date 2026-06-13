// PUBLIC demo routes (no auth). Lets the marketing homepage upload a Power BI
// document (or pick a sample) and explore a full, ephemeral demo — dashboard +
// Mission Control + Ask — without signing up. Demo models live in memory only,
// keyed by a random demoId, with a TTL. Nothing is persisted to a tenant.
//
// IMPORTANT: this router is mounted BEFORE the requireAuth middleware in
// index.ts, so every route here is reachable unauthenticated.

import { Router, raw } from 'express';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Anomaly, AuditEntry, SemanticModel } from '../types.js';
import { SAMPLES } from '../data/index.js';
import { resolveSample, buildModelFromUpload } from '../ingestParse.js';
import {
  ingestEvents,
  missionEvents,
  detectAnomalies,
  answerQuestion,
} from '../engine/index.js';
import { sseInit, sseSend, sseDone } from '../sse.js';

export const demoRouter = Router();

/* ---------------- ephemeral demo store ---------------- */

interface DemoSession {
  model: SemanticModel;
  audit: AuditEntry[];
  created: number;
}

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 200;
const store = new Map<string, DemoSession>();

function evictStale(): void {
  const now = Date.now();
  for (const [id, s] of store) {
    if (now - s.created > TTL_MS) store.delete(id);
  }
  // Hard cap: drop oldest if we're over the limit.
  while (store.size > MAX_SESSIONS) {
    const oldest = store.keys().next().value as string | undefined;
    if (!oldest) break;
    store.delete(oldest);
  }
}

function put(model: SemanticModel): string {
  evictStale();
  const demoId = randomUUID();
  store.set(demoId, { model, audit: [], created: Date.now() });
  return demoId;
}

function get(req: Request, res: Response): DemoSession | null {
  const s = store.get(req.params.demoId);
  if (!s) {
    res.status(404).json({ error: 'Demo session not found or expired. Start a new demo.' });
    return null;
  }
  return s;
}

/* ---------------- routes ---------------- */

// GET /api/demo/samples — list the bundled samples for the homepage chooser.
demoRouter.get('/demo/samples', (_req: Request, res: Response) => {
  res.json(SAMPLES.map((s) => ({ id: s.id, name: s.name })));
});

// POST /api/demo/ingest — multipart 'file' OR JSON { sampleId } -> { demoId }.
// Never errors the upload: unparseable files fall back to a synthetic model.
demoRouter.post(
  '/demo/ingest',
  raw({ type: 'multipart/form-data', limit: '60mb' }),
  (req: Request, res: Response) => {
    try {
      const contentType = req.headers['content-type'] || '';
      let model: SemanticModel;
      if (contentType.includes('application/json')) {
        const sampleId = (req.body && (req.body.sampleId as string)) || '';
        model = resolveSample(sampleId);
      } else {
        const bodyBuf = Buffer.isBuffer(req.body) ? (req.body as Buffer) : null;
        model = buildModelFromUpload(bodyBuf, contentType);
      }
      const demoId = put(model);
      // Reflect the demoId as the model id so the client routes are consistent.
      model.id = demoId;
      res.json({ demoId });
    } catch (err) {
      console.error('demo ingest failed', err);
      res.status(500).json({ error: 'Failed to start demo' });
    }
  }
);

// GET /api/demo/:demoId -> SemanticModel
demoRouter.get('/demo/:demoId', (req: Request, res: Response) => {
  const s = get(req, res);
  if (s) res.json(s.model);
});

// GET /api/demo/:demoId/ingest/stream (SSE) — staged ingest pipeline.
demoRouter.get('/demo/:demoId/ingest/stream', (req: Request, res: Response) => {
  const s = get(req, res);
  if (!s) return;
  sseInit(req, res);
  const events = ingestEvents(s.model);
  let i = 0;
  const stepMs =
    events.length > 0
      ? Math.min(1200, Math.max(700, Math.floor(8000 / events.length)))
      : 800;
  const timer = setInterval(() => {
    if (i >= events.length) {
      clearInterval(timer);
      sseDone(res, { done: true, modelId: s.model.id });
      return;
    }
    sseSend(res, events[i], 'event');
    i += 1;
  }, stepMs);
  req.on('close', () => clearInterval(timer));
});

// GET /api/demo/:demoId/anomalies -> Anomaly[]
demoRouter.get('/demo/:demoId/anomalies', async (req: Request, res: Response) => {
  const s = get(req, res);
  if (!s) return;
  try {
    const anomalies = await detectAnomalies(s.model);
    res.json(anomalies);
  } catch (err) {
    console.error('demo anomalies failed', err);
    res.status(500).json({ error: 'Failed to compute anomalies' });
  }
});

// GET /api/demo/:demoId/mission/stream (SSE) — looping live feed.
demoRouter.get('/demo/:demoId/mission/stream', (req: Request, res: Response) => {
  const s = get(req, res);
  if (!s) return;
  sseInit(req, res);
  const base = missionEvents(s.model);
  let i = 0;
  const emit = () => {
    if (base.length === 0) return;
    const src = base[i % base.length];
    const live = { ...src, id: `${src.id}-${i}`, ts: new Date().toISOString() };
    sseSend(res, live, 'event');
    i += 1;
  };
  emit();
  const timer = setInterval(emit, 3500);
  req.on('close', () => clearInterval(timer));
});

// POST /api/demo/:demoId/actions/:anomalyId/approve -> AuditEntry (ephemeral)
demoRouter.post(
  '/demo/:demoId/actions/:anomalyId/approve',
  async (req: Request, res: Response) => {
    const s = get(req, res);
    if (!s) return;
    let anomaly: Anomaly | undefined;
    try {
      const anomalies = await detectAnomalies(s.model);
      anomaly = anomalies.find((a) => a.id === req.params.anomalyId);
    } catch {
      /* ignore — summary falls back below */
    }
    const summary = anomaly
      ? `Approved: ${anomaly.recommendation.title} — ${anomaly.kpiName} (${anomaly.id})`
      : `Approved action ${req.params.anomalyId}`;
    const entry: AuditEntry = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      actor: 'user',
      summary,
    };
    s.audit.unshift(entry);
    res.json(entry);
  }
);

// GET /api/demo/:demoId/audit -> AuditEntry[]
demoRouter.get('/demo/:demoId/audit', (req: Request, res: Response) => {
  const s = get(req, res);
  if (s) res.json(s.audit);
});

// POST /api/demo/:demoId/ask { question } -> AskAnswer
demoRouter.post('/demo/:demoId/ask', (req: Request, res: Response) => {
  const s = get(req, res);
  if (!s) return;
  const question = (req.body && (req.body.question as string)) || '';
  res.json(answerQuestion(s.model, question));
});

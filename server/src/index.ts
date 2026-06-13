// DeepLogic API server — Express + TypeScript (ESM), multi-tenant (PRD v2).
// All routes live under /api and require a valid Bearer JWT except /api/health.
// SSE endpoints additionally accept the JWT via ?token=.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { requireAuth } from './auth.js';
import { demoRouter } from './routes/demo.js';
import { meRouter } from './routes/me.js';
import { orgsRouter } from './routes/orgs.js';
import { modelsRouter } from './routes/models.js';
import { ingestRouter } from './routes/ingest.js';
import { missionRouter } from './routes/mission.js';
import { studioRouter } from './routes/studio.js';

const PORT = Number(process.env.PORT) || 8787;

const app = express();
app.use(cors());

// JSON body parsing for non-multipart requests. The ingest upload route uses
// its own raw() parser scoped to multipart/form-data, so JSON here is safe.
// Limit is generous to allow base64 image/PDF prompt attachments in Studio.
app.use(express.json({ limit: '30mb' }));

// Lightweight request log.
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// Health check — public (no auth).
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'deeplogic-server', time: new Date().toISOString() });
});

// Public, unauthenticated homepage demo (ephemeral, no tenant). Mounted BEFORE
// requireAuth so it is reachable without signing in.
app.use('/api', demoRouter);

// Everything else under /api requires authentication.
app.use('/api', requireAuth);

// Feature routers (all paths declared with the /api prefix here).
app.use('/api', meRouter);
app.use('/api', orgsRouter);
app.use('/api', modelsRouter);
app.use('/api', ingestRouter);
app.use('/api', missionRouter);
app.use('/api', studioRouter);

app.listen(PORT, () => {
  console.log(`DeepLogic API listening on http://localhost:${PORT}`);
});

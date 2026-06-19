// DeepLogic API server — Express + TypeScript (ESM), multi-tenant (PRD v2).
// All routes live under /api and require a valid Bearer JWT except /api/health.
// SSE endpoints additionally accept the JWT via ?token=.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { requireAuth } from './auth.js';
import { demoRouter } from './routes/demo.js';
import { inviteRouter } from './routes/invite.js';
import { meRouter } from './routes/me.js';
import { orgsRouter } from './routes/orgs.js';
import { modelsRouter } from './routes/models.js';
import { ingestRouter } from './routes/ingest.js';
import { missionRouter } from './routes/mission.js';
import { studioRouter, onboardingPublicRouter } from './routes/studio.js';
import { billingRouter, stripeWebhookHandler } from './routes/billing.js';
import { adminRouter } from './routes/admin.js';
import { sandboxRouter } from './routes/sandbox.js';
import { dashboardsRouter } from './routes/dashboards.js';
import { agentsRouter, agentCallbackRouter } from './routes/agents.js';
import { integrationsRouter } from './routes/integrations.js';
import { memoryRouter } from './routes/memory.js';
import { alertsRouter } from './routes/alerts.js';
import { goalsRouter } from './routes/goals.js';
import { searchRouter } from './routes/search.js';

// Platform AI (onboarding/anonymous) uses a server env key, kept separate from
// per-client workspace keys (org_ai_settings) — see serverFallbackAi().
const PORT = Number(process.env.PORT) || 8787;

const app = express();
app.use(cors());

// Stripe webhook needs the raw body for signature verification.
// Register before express.json() so the buffer is unmodified.
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);

// JSON body parsing for all other routes.
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

// Public routes — no auth required.
app.use('/api', demoRouter);
app.use('/api', inviteRouter);   // GET /invite/:token + POST /invite/:token/accept
app.use('/api', agentCallbackRouter);  // POST /agent-callback/:id — VM→central, token-authed
app.use('/api', onboardingPublicRouter);  // POST /onboarding/analyze — anonymous, pre-account

// Everything else under /api requires authentication.
app.use('/api', requireAuth);

// Feature routers (all paths declared with the /api prefix here).
app.use('/api', meRouter);
app.use('/api', orgsRouter);
app.use('/api', modelsRouter);
app.use('/api', ingestRouter);
app.use('/api', missionRouter);
app.use('/api', studioRouter);
app.use('/api', billingRouter);
app.use('/api', adminRouter);
app.use('/api', sandboxRouter);
app.use('/api', dashboardsRouter);
app.use('/api', agentsRouter);
app.use('/api', integrationsRouter);
app.use('/api', memoryRouter);
app.use('/api', alertsRouter);
app.use('/api', goalsRouter);
app.use('/api', searchRouter);

app.listen(PORT, () => {
  console.log(`DeepLogic API listening on http://localhost:${PORT}`);
});

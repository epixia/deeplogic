// Sandbox routes — E2B-powered isolated HTML preview environments.
//   POST   /api/orgs/:orgId/studio/sandbox         { html } -> { sandboxId, previewUrl }
//   PATCH  /api/orgs/:orgId/studio/sandbox/:id     { html } -> { ok }
//   DELETE /api/orgs/:orgId/studio/sandbox/:id     -> 204

import { Router } from 'express';
import type { Request, Response } from 'express';
import { Sandbox } from 'e2b';
import { requireMember } from '../auth.js';

export const sandboxRouter = Router();

const API_KEY = process.env.E2B_API_KEY ?? '';
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes idle

function sbxOpts() {
  return { apiKey: API_KEY, timeoutMs: SANDBOX_TIMEOUT_MS };
}

// POST /api/orgs/:orgId/studio/sandbox — spin up a fresh sandbox, serve HTML.
sandboxRouter.post(
  '/orgs/:orgId/studio/sandbox',
  requireMember(),
  async (req: Request, res: Response) => {
    const html: string = req.body?.html ?? '';
    if (!html) {
      res.status(400).json({ error: 'html is required' });
      return;
    }
    if (!API_KEY) {
      res.status(503).json({ error: 'E2B not configured (missing E2B_API_KEY)' });
      return;
    }
    try {
      const sbx = await Sandbox.create(sbxOpts());
      await sbx.files.write('/home/user/index.html', html);
      // Start a simple HTTP server in the background.
      await sbx.commands.run(
        'cd /home/user && python3 -m http.server 3000 > /dev/null 2>&1 &',
        { background: true }
      );
      // Give the server ~400ms to bind before returning the URL.
      await new Promise((r) => setTimeout(r, 400));
      const previewUrl = `https://${sbx.getHost(3000)}`;
      res.json({ sandboxId: sbx.sandboxId, previewUrl });
    } catch (err) {
      console.error('E2B create failed', err);
      res.status(500).json({ error: 'Failed to create sandbox' });
    }
  }
);

// PATCH /api/orgs/:orgId/studio/sandbox/:sandboxId — update HTML in place.
sandboxRouter.patch(
  '/orgs/:orgId/studio/sandbox/:sandboxId',
  requireMember(),
  async (req: Request, res: Response) => {
    const html: string = req.body?.html ?? '';
    const { sandboxId } = req.params;
    if (!html) {
      res.status(400).json({ error: 'html is required' });
      return;
    }
    try {
      const sbx = await Sandbox.connect(sandboxId, sbxOpts());
      await sbx.files.write('/home/user/index.html', html);
      res.json({ ok: true });
    } catch (err) {
      // Sandbox may have expired — caller should create a new one.
      console.warn('E2B update failed (may have expired)', err);
      res.status(410).json({ error: 'Sandbox expired', expired: true });
    }
  }
);

// DELETE /api/orgs/:orgId/studio/sandbox/:sandboxId — kill sandbox on unmount.
sandboxRouter.delete(
  '/orgs/:orgId/studio/sandbox/:sandboxId',
  requireMember(),
  async (req: Request, res: Response) => {
    const { sandboxId } = req.params;
    try {
      const sbx = await Sandbox.connect(sandboxId, sbxOpts());
      await sbx.kill();
    } catch {
      // Best-effort — sandbox may already be dead.
    }
    res.status(204).end();
  }
);

// Public + semi-public invite routes.
//   GET  /api/invite/:token          (public)  — verify token, return org info
//   POST /api/invite/:token/accept   (auth)    — accept + join org

import { Router } from 'express';
import type { Request, Response } from 'express';
import { serviceClient } from '../supabase.js';
import { requireAuth } from '../auth.js';
import { getOrgLimits } from '../billing.js';
import { getInvitationByToken, acceptInvitation } from '../repo.js';

export const inviteRouter = Router();

// GET /api/invite/:token
inviteRouter.get('/invite/:token', async (req: Request, res: Response) => {
  try {
    const inv = await getInvitationByToken(serviceClient, req.params.token);
    if (!inv) {
      res.status(404).json({ error: 'Invitation not found or expired' });
      return;
    }
    const { data: org } = await serviceClient
      .from('organizations')
      .select('name')
      .eq('id', inv.orgId)
      .maybeSingle();
    res.json({
      orgId:     inv.orgId,
      orgName:   (org as { name: string } | null)?.name ?? '',
      email:     inv.email,
      role:      inv.role,
      expiresAt: inv.expiresAt,
    });
  } catch (err) {
    console.error('GET invite token failed', err);
    res.status(500).json({ error: 'Failed to look up invitation' });
  }
});

// POST /api/invite/:token/accept  (requireAuth runs inline)
inviteRouter.post(
  '/invite/:token/accept',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      // Resolve the invitation first so we can check the org's member limit.
      const inv = await getInvitationByToken(serviceClient, req.params.token);
      if (!inv) {
        res.status(404).json({ error: 'Invitation not found or expired' });
        return;
      }

      // Enforce the org's plan member cap before adding the new member.
      const limits = await getOrgLimits(serviceClient, inv.orgId);
      if (limits.members !== Infinity) {
        const { count } = await serviceClient
          .from('org_members')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', inv.orgId);
        if ((count ?? 0) >= limits.members) {
          res.status(402).json({
            error: `This organization has reached its ${limits.members}-member limit. The owner must upgrade to add more members.`,
            upgrade: true,
          });
          return;
        }
      }

      const result = await acceptInvitation(serviceClient, req.params.token, req.user!.id);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to accept invitation';
      res.status(400).json({ error: msg });
    }
  }
);

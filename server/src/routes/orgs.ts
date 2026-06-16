// Org + member management (PRD v2 + billing).
//   POST   /api/orgs                               { name }
//   GET    /api/orgs/:orgId/members                -> Member[]
//   POST   /api/orgs/:orgId/members                { email, role } (admin+)
//   PATCH  /api/orgs/:orgId/members/:userId        { role } (admin+)
//   DELETE /api/orgs/:orgId/members/:userId        (admin+)
//   GET    /api/orgs/:orgId/invitations            -> Invitation[] (admin+)
//   DELETE /api/orgs/:orgId/invitations/:id        (admin+)
//   GET    /api/invite/:token                      (public) -> invitation info
//   POST   /api/invite/:token/accept               (auth)   -> accept + join org

import { Router } from 'express';
import type { Request, Response } from 'express';
import { serviceClient } from '../supabase.js';
import { requireMember, requireRole, callerRole, checkMemberLimit } from '../auth.js';
import {
  createOrgWithSeed,
  listMembers,
  updateMemberRole,
  removeMember,
  addMemberByEmail,
  getMemberRole,
  createInvitation,
  listInvitations,
  deleteInvitation,
} from '../repo.js';
import { sendEmail, inviteEmailHtml } from '../email.js';

export const orgsRouter = Router();

type Role = 'owner' | 'admin' | 'member';
const ROLES: Role[] = ['owner', 'admin', 'member'];

// POST /api/orgs — create org, seed samples, caller becomes owner.
orgsRouter.post('/orgs', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const name = ((req.body && req.body.name) || '').toString().trim();
  if (!name) {
    res.status(400).json({ error: 'Organization name is required' });
    return;
  }
  try {
    const membership = await createOrgWithSeed(serviceClient, req.user.id, name);
    res.status(201).json(membership);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('POST /orgs failed:', detail, err);
    // TEMP: surface the real cause to the client while debugging.
    res.status(500).json({ error: 'Failed to create organization', detail });
  }
});

// GET /api/orgs/:orgId/members — any member can read the roster.
orgsRouter.get(
  '/orgs/:orgId/members',
  requireMember(),
  async (req: Request, res: Response) => {
    try {
      const members = await listMembers(serviceClient, req.params.orgId);
      res.json(members);
    } catch (err) {
      console.error('GET members failed', err);
      res.status(500).json({ error: 'Failed to list members' });
    }
  }
);

// POST /api/orgs/:orgId/members — add member or send invitation if not yet registered (admin+).
orgsRouter.post(
  '/orgs/:orgId/members',
  requireRole(['owner', 'admin']),
  checkMemberLimit(),
  async (req: Request, res: Response) => {
    const email = ((req.body && req.body.email) || '').toString().trim();
    const role = ((req.body && req.body.role) || 'member').toString() as Role;
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }
    if (!ROLES.includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }
    if (role === 'owner' && callerRole(req) !== 'owner') {
      res.status(403).json({ error: 'Only an owner can grant the owner role' });
      return;
    }
    try {
      const member = await addMemberByEmail(serviceClient, req.params.orgId, email, role);
      res.status(201).json({ type: 'member', ...member });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add member';
      if (msg !== 'user must sign up first') {
        console.error('POST member failed', err);
        res.status(500).json({ error: msg });
        return;
      }
      // User doesn't have an account yet — send an invitation email instead.
      try {
        const org = req.org!;
        const inv = await createInvitation(
          serviceClient,
          req.params.orgId,
          email,
          role,
          req.user!.id
        );
        const baseUrl = process.env.APP_URL ?? 'http://localhost:5173';
        const acceptUrl = `${baseUrl}/invite/${inv.token}`;
        await sendEmail({
          to: email,
          subject: `You're invited to join ${org.name} on DeepLogic`,
          html: inviteEmailHtml({
            orgName: org.name,
            inviterEmail: req.user!.email,
            role,
            acceptUrl,
            expiresAt: inv.expiresAt,
          }),
        });
        res.status(202).json({ type: 'invitation', email, role, expiresAt: inv.expiresAt });
      } catch (invErr) {
        console.error('Invitation failed', invErr);
        res.status(500).json({ error: 'Failed to send invitation' });
      }
    }
  }
);

// GET /api/orgs/:orgId/invitations — list pending invitations (admin+).
orgsRouter.get(
  '/orgs/:orgId/invitations',
  requireRole(['owner', 'admin']),
  async (req: Request, res: Response) => {
    try {
      const invitations = await listInvitations(serviceClient, req.params.orgId);
      res.json(invitations);
    } catch (err) {
      console.error('GET invitations failed', err);
      res.status(500).json({ error: 'Failed to list invitations' });
    }
  }
);

// DELETE /api/orgs/:orgId/invitations/:invId — cancel a pending invitation (admin+).
orgsRouter.delete(
  '/orgs/:orgId/invitations/:invId',
  requireRole(['owner', 'admin']),
  async (req: Request, res: Response) => {
    try {
      await deleteInvitation(serviceClient, req.params.orgId, req.params.invId);
      res.status(204).end();
    } catch (err) {
      console.error('DELETE invitation failed', err);
      res.status(500).json({ error: 'Failed to cancel invitation' });
    }
  }
);


// PATCH /api/orgs/:orgId — rename workspace (admin+).
orgsRouter.patch(
  '/orgs/:orgId',
  requireRole(['owner', 'admin']),
  async (req: Request, res: Response) => {
    const name = ((req.body && req.body.name) || '').toString().trim();
    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    try {
      const { data, error } = await serviceClient
        .from('organizations')
        .update({ name })
        .eq('id', req.params.orgId)
        .select('id, name, slug')
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error('PATCH org failed', err);
      res.status(500).json({ error: 'Failed to update organization' });
    }
  }
);

// PATCH /api/orgs/:orgId/members/:userId — change a role (admin+).
orgsRouter.patch(
  '/orgs/:orgId/members/:userId',
  requireRole(['owner', 'admin']),
  async (req: Request, res: Response) => {
    const { orgId, userId } = req.params;
    const role = ((req.body && req.body.role) || '').toString() as Role;
    if (!ROLES.includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }
    const actorRole = callerRole(req);
    try {
      const targetRole = await getMemberRole(serviceClient, orgId, userId);
      if (!targetRole) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }
      // Only an owner may promote to owner or change an existing owner.
      if ((role === 'owner' || targetRole === 'owner') && actorRole !== 'owner') {
        res.status(403).json({ error: 'Only an owner can manage owners' });
        return;
      }
      const member = await updateMemberRole(serviceClient, orgId, userId, role);
      res.json(member);
    } catch (err) {
      console.error('PATCH member failed', err);
      res.status(500).json({ error: 'Failed to update member' });
    }
  }
);

// DELETE /api/orgs/:orgId/members/:userId — remove a member (admin+).
orgsRouter.delete(
  '/orgs/:orgId/members/:userId',
  requireRole(['owner', 'admin']),
  async (req: Request, res: Response) => {
    const { orgId, userId } = req.params;
    const actorRole = callerRole(req);
    try {
      const targetRole = await getMemberRole(serviceClient, orgId, userId);
      if (!targetRole) {
        res.status(204).end();
        return;
      }
      // Only an owner may remove an owner.
      if (targetRole === 'owner' && actorRole !== 'owner') {
        res.status(403).json({ error: 'Only an owner can remove an owner' });
        return;
      }
      await removeMember(serviceClient, orgId, userId);
      res.status(204).end();
    } catch (err) {
      console.error('DELETE member failed', err);
      res.status(500).json({ error: 'Failed to remove member' });
    }
  }
);

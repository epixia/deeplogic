// Org + member management (PRD v2).
//   POST   /api/orgs                          { name } -> creates org + owner + seeds samples
//   GET    /api/orgs/:orgId/members           -> Member[]
//   POST   /api/orgs/:orgId/members           { email, role } (admin+)
//   PATCH  /api/orgs/:orgId/members/:userId   { role } (admin+; only owner manages owners)
//   DELETE /api/orgs/:orgId/members/:userId   (admin+; only owner removes owners)

import { Router } from 'express';
import type { Request, Response } from 'express';
import { serviceClient } from '../supabase.js';
import { requireMember, requireRole, callerRole } from '../auth.js';
import {
  createOrgWithSeed,
  listMembers,
  updateMemberRole,
  removeMember,
  addMemberByEmail,
  getMemberRole,
} from '../repo.js';

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
    console.error('POST /orgs failed', err);
    res.status(500).json({ error: 'Failed to create organization' });
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

// POST /api/orgs/:orgId/members — add an already-registered user (admin+).
orgsRouter.post(
  '/orgs/:orgId/members',
  requireRole(['owner', 'admin']),
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
    // Only an owner may grant the owner role.
    if (role === 'owner' && callerRole(req) !== 'owner') {
      res.status(403).json({ error: 'Only an owner can grant the owner role' });
      return;
    }
    try {
      const member = await addMemberByEmail(serviceClient, req.params.orgId, email, role);
      res.status(201).json(member);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add member';
      if (msg === 'user must sign up first') {
        res.status(404).json({ error: 'user must sign up first' });
        return;
      }
      console.error('POST member failed', err);
      res.status(500).json({ error: msg });
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

// Auth + membership middleware (PRD v2).
//   requireAuth        — verifies the Bearer/?token JWT, sets req.user/token/db.
//   requireMember(org) — 403 unless the caller is a member of :orgId.
//   requireRole(org,r) — 403 unless the caller's role in :orgId is in r.
//
// req.db is a Supabase client bound to the caller's JWT, so its queries run
// under the caller's RLS context (defense in depth on top of the route checks).

import type { Request, Response, NextFunction } from 'express';
import { getUserFromToken, userClientFor, serviceClient } from './supabase.js';

/** Pull the JWT from Authorization: Bearer or the ?token query (for SSE). */
function readToken(req: Request): string {
  const header = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (m) return m[1].trim();
  const q = req.query.token;
  if (typeof q === 'string' && q) return q;
  return '';
}

/** Verify the JWT; populate req.user, req.token, req.db. 401 on failure. */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = readToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing access token' });
    return;
  }
  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired access token' });
    return;
  }
  req.user = user;
  req.token = token;
  req.db = userClientFor(token);
  next();
}

/**
 * Look up the caller's role in an org via the service client (avoids RLS
 * recursion edge cases and is authoritative). Returns null if not a member.
 */
async function lookupRole(orgId: string, userId: string): Promise<string | null> {
  const { data, error } = await serviceClient
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { role: string }).role;
}

/**
 * Middleware: require the caller to be a member of req.params.orgId.
 * Stashes the resolved role on req for downstream role checks.
 */
export function requireMember() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const orgId = req.params.orgId;
    if (!req.user || !orgId) {
      res.status(400).json({ error: 'Missing org context' });
      return;
    }
    const role = await lookupRole(orgId, req.user.id);
    if (!role) {
      res.status(403).json({ error: 'Not a member of this organization' });
      return;
    }
    (req as Request & { orgRole?: string }).orgRole = role;
    next();
  };
}

/**
 * Middleware: require the caller's role in req.params.orgId to be in `roles`.
 * Implies membership.
 */
export function requireRole(roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const orgId = req.params.orgId;
    if (!req.user || !orgId) {
      res.status(400).json({ error: 'Missing org context' });
      return;
    }
    const role = await lookupRole(orgId, req.user.id);
    if (!role) {
      res.status(403).json({ error: 'Not a member of this organization' });
      return;
    }
    if (!roles.includes(role)) {
      res.status(403).json({ error: 'Insufficient role for this action' });
      return;
    }
    (req as Request & { orgRole?: string }).orgRole = role;
    next();
  };
}

/** Read the role resolved by requireMember/requireRole (or null). */
export function callerRole(req: Request): string | null {
  return (req as Request & { orgRole?: string }).orgRole ?? null;
}

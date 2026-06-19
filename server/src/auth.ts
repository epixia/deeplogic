// Auth + membership middleware (PRD v2).
//   requireAuth        — verifies the Bearer/?token JWT, sets req.user/token/db.
//   requireMember(org) — 403 unless the caller is a member of :orgId.
//   requireRole(org,r) — 403 unless the caller's role in :orgId is in r.
//
// req.db is a Supabase client bound to the caller's JWT, so its queries run
// under the caller's RLS context (defense in depth on top of the route checks).

import type { Request, Response, NextFunction } from 'express';
import { getUserFromToken, userClientFor, mintPgToken, serviceClient } from './supabase.js';
import { getOrgLimits, getMonthlyTokens, type PlanLimits } from './billing.js';

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
  // Use a server-minted HS256 token PostgREST trusts (the incoming token may be
  // ES256, which the local data layer can't validate). RLS still scopes to this user.
  req.db = userClientFor(mintPgToken(user.id, user.email));
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

/** Fetch the org row and stash it on req.org. */
async function loadOrg(orgId: string, req: Request): Promise<void> {
  const { data } = await serviceClient
    .from('organizations')
    .select('id, name, slug')
    .eq('id', orgId)
    .maybeSingle();
  if (data) req.org = data as { id: string; name: string; slug: string };
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
    req.orgRole = role;
    await loadOrg(orgId, req);
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
    req.orgRole = role;
    await loadOrg(orgId, req);
    next();
  };
}

/** Read the role resolved by requireMember/requireRole (or null). */
export function callerRole(req: Request): string | null {
  return req.orgRole ?? null;
}

// ---------------------------------------------------------------------------
// Plan enforcement middleware
// ---------------------------------------------------------------------------

/**
 * requireFeature('byok') — 402 if the org's effective plan doesn't include
 * the feature. Must run after requireMember/requireRole.
 */
export function requireFeature(feature: keyof PlanLimits) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limits = await getOrgLimits(serviceClient, req.params.orgId);
      if (!limits[feature]) {
        res.status(402).json({
          error: `This feature requires a higher plan`,
          feature,
          upgrade: true,
        });
        return;
      }
      next();
    } catch (err) {
      console.error('requireFeature failed', err);
      res.status(500).json({ error: 'Failed to check plan limits' });
    }
  };
}

/**
 * checkMemberLimit — 402 if the org is at its member cap.
 * Must run after requireRole.
 */
export function checkMemberLimit() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = req.params.orgId;
      const limits = await getOrgLimits(serviceClient, orgId);
      if (limits.members === Infinity) { next(); return; }
      const { count } = await serviceClient
        .from('org_members')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId);
      if ((count ?? 0) >= limits.members) {
        res.status(402).json({
          error: `Your plan allows a maximum of ${limits.members} members`,
          upgrade: true,
        });
        return;
      }
      next();
    } catch (err) {
      console.error('checkMemberLimit failed', err);
      res.status(500).json({ error: 'Failed to check member limit' });
    }
  };
}

/**
 * checkReportLimit — 402 if the org is at its studio project cap.
 * Must run after requireMember.
 */
export function checkReportLimit() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = req.params.orgId;
      const limits = await getOrgLimits(serviceClient, orgId);
      if (limits.reports === Infinity) { next(); return; }
      const { count } = await serviceClient
        .from('studio_projects')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId);
      if ((count ?? 0) >= limits.reports) {
        res.status(402).json({
          error: `Your plan allows a maximum of ${limits.reports} reports`,
          upgrade: true,
        });
        return;
      }
      next();
    } catch (err) {
      console.error('checkReportLimit failed', err);
      res.status(500).json({ error: 'Failed to check report limit' });
    }
  };
}

/**
 * checkTokenBudget — 402 if the org has exhausted its monthly token allowance.
 * Must run after requireMember.
 */
export function checkTokenBudget() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = req.params.orgId;
      const limits = await getOrgLimits(serviceClient, orgId);
      if (limits.tokensPerMonth === Infinity) { next(); return; }
      const used = await getMonthlyTokens(serviceClient, orgId);
      if (used >= limits.tokensPerMonth) {
        res.status(402).json({
          error: `You've used all ${limits.tokensPerMonth.toLocaleString()} AI tokens for this month`,
          upgrade: true,
        });
        return;
      }
      next();
    } catch (err) {
      console.error('checkTokenBudget failed', err);
      res.status(500).json({ error: 'Failed to check token budget' });
    }
  };
}

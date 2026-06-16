// Super-admin routes — all paths under /api/admin/*.
// Access is restricted to emails listed in the ADMIN_EMAILS env var (comma-sep).
// All queries use the service client (bypasses RLS) so admins see everything.
//
//   GET  /api/admin/me                           — { isAdmin, email }
//   GET  /api/admin/stats                        — platform-wide KPIs
//   GET  /api/admin/orgs?page&limit&search&plan&status
//   GET  /api/admin/orgs/:orgId                  — org detail with members + usage
//   PATCH /api/admin/orgs/:orgId/subscription    — override plan/status/trial
//   DELETE /api/admin/orgs/:orgId/members/:userId — remove a member (admin action)
//   GET  /api/admin/users?page&limit&search       — paginated user list

import { utimesSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { serviceClient } from '../supabase.js';
import { PLAN_LIMITS, getMonthlyTokens } from '../billing.js';

export const adminRouter = Router();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/** Resolve the comma-separated ADMIN_EMAILS env var once per process. */
function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!adminEmails().includes(req.user.email.toLowerCase())) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// All admin routes require auth (set upstream in index.ts) + admin role.
adminRouter.use(requireAdmin);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function logAdminAction(
  adminEmail: string,
  action: string,
  targetType: 'org' | 'user' | 'subscription',
  targetId: string,
  payload?: Record<string, unknown>
): Promise<void> {
  await serviceClient.from('admin_log').insert({
    admin_email: adminEmail,
    action,
    target_type: targetType,
    target_id: targetId,
    payload: payload ?? null,
  });
}

const PLAN_PRICE: Record<string, number> = {
  free: 0,
  team: 39,
  business: 79,
  enterprise: 0,
};

// ---------------------------------------------------------------------------
// GET /api/admin/me
// ---------------------------------------------------------------------------
adminRouter.get('/admin/me', (req: Request, res: Response) => {
  res.json({ isAdmin: true, email: req.user!.email });
});

// ---------------------------------------------------------------------------
// GET /api/admin/stats
// ---------------------------------------------------------------------------
adminRouter.get('/admin/stats', async (_req: Request, res: Response) => {
  try {
    const [orgsRes, subsRes, membersRes, usageRes] = await Promise.all([
      serviceClient.from('organizations').select('id, created_at', { count: 'exact' }),
      serviceClient.from('subscriptions').select('plan, status, seat_count, trial_ends_at'),
      serviceClient.from('org_members').select('user_id'),
      serviceClient
        .from('usage_events')
        .select('tokens')
        .gte('created_at', (() => {
          const d = new Date();
          d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
          return d.toISOString();
        })()),
    ]);

    const subs = (subsRes.data ?? []) as {
      plan: string; status: string; seat_count: number; trial_ends_at: string | null;
    }[];

    // Plan breakdown
    const planBreakdown: Record<string, number> = { free: 0, team: 0, business: 0, enterprise: 0 };
    let trialOrgs = 0;
    let pastDueOrgs = 0;
    let estimatedMrr = 0;

    for (const s of subs) {
      planBreakdown[s.plan] = (planBreakdown[s.plan] ?? 0) + 1;
      if (s.status === 'trialing' && s.trial_ends_at && new Date(s.trial_ends_at) > new Date()) trialOrgs++;
      if (s.status === 'past_due') pastDueOrgs++;
      if (s.status === 'active') {
        estimatedMrr += (PLAN_PRICE[s.plan] ?? 0) * (s.seat_count || 1);
      }
    }

    // Distinct user count from org_members
    const allUserIds = new Set(
      ((membersRes.data ?? []) as { user_id: string }[]).map((r) => r.user_id)
    );

    // New orgs this calendar month
    const monthStart = new Date();
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const newOrgsThisMonth = ((orgsRes.data ?? []) as { created_at: string }[])
      .filter((o) => new Date(o.created_at) >= monthStart).length;

    const tokensBilled = ((usageRes.data ?? []) as { tokens: number }[])
      .reduce((s, r) => s + r.tokens, 0);

    res.json({
      totalOrgs:         orgsRes.count ?? 0,
      totalUsers:        allUserIds.size,
      planBreakdown,
      trialOrgs,
      pastDueOrgs,
      estimatedMrr,
      newOrgsThisMonth,
      tokensBilledThisMonth: tokensBilled,
    });
  } catch (err) {
    console.error('GET admin/stats failed', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/orgs
// ---------------------------------------------------------------------------
adminRouter.get('/admin/orgs', async (req: Request, res: Response) => {
  const page  = Math.max(1, Number(req.query.page)  || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const search = ((req.query.search as string) || '').trim();
  const planFilter   = (req.query.plan   as string) || '';
  const statusFilter = (req.query.status as string) || '';

  const from = (page - 1) * limit;
  const to   = from + limit - 1;

  try {
    // 1. Orgs (paginated + optional search)
    let orgQuery = serviceClient
      .from('organizations')
      .select('id, name, slug, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (search) orgQuery = orgQuery.ilike('name', `%${search}%`);

    const { data: orgs, count, error: orgErr } = await orgQuery;
    if (orgErr) throw new Error(orgErr.message);
    const orgIds = (orgs ?? []).map((o: { id: string }) => o.id);

    if (orgIds.length === 0) {
      res.json({ orgs: [], total: 0 });
      return;
    }

    // 2. Subscriptions for this page's orgs
    const { data: subs } = await serviceClient
      .from('subscriptions')
      .select('org_id, plan, status, seat_count, trial_ends_at, current_period_end, stripe_customer_id')
      .in('org_id', orgIds);

    // 3. Member counts for this page's orgs
    const { data: memberRows } = await serviceClient
      .from('org_members')
      .select('org_id')
      .in('org_id', orgIds);

    const subMap = new Map(
      ((subs ?? []) as { org_id: string; plan: string; status: string; seat_count: number; trial_ends_at: string | null; current_period_end: string | null; stripe_customer_id: string | null }[])
        .map((s) => [s.org_id, s])
    );
    const memberCount = new Map<string, number>();
    for (const m of (memberRows ?? []) as { org_id: string }[]) {
      memberCount.set(m.org_id, (memberCount.get(m.org_id) ?? 0) + 1);
    }

    let result = ((orgs ?? []) as { id: string; name: string; slug: string; created_at: string }[])
      .map((org) => {
        const sub = subMap.get(org.id);
        const plan   = sub?.plan   ?? 'free';
        const status = sub?.status ?? 'active';
        const trialEndsAt = sub?.trial_ends_at ?? null;
        const inTrial = status === 'trialing' && !!trialEndsAt && new Date(trialEndsAt) > new Date();
        return {
          id:               org.id,
          name:             org.name,
          slug:             org.slug,
          plan,
          status,
          inTrial,
          memberCount:      memberCount.get(org.id) ?? 0,
          seatCount:        sub?.seat_count ?? 1,
          createdAt:        org.created_at,
          trialEndsAt,
          currentPeriodEnd: sub?.current_period_end ?? null,
          stripeCustomerId: sub?.stripe_customer_id ?? null,
        };
      });

    // Client-side plan/status filter (applied after join; for small result sets this is fine)
    if (planFilter)   result = result.filter((o) => o.plan   === planFilter);
    if (statusFilter) result = result.filter((o) => o.status === statusFilter);

    res.json({ orgs: result, total: count ?? 0 });
  } catch (err) {
    console.error('GET admin/orgs failed', err);
    res.status(500).json({ error: 'Failed to list organizations' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/orgs/:orgId
// ---------------------------------------------------------------------------
adminRouter.get('/admin/orgs/:orgId', async (req: Request, res: Response) => {
  const { orgId } = req.params;
  try {
    const [orgRes, subRes, memberRes, invRes] = await Promise.all([
      serviceClient.from('organizations').select('*').eq('id', orgId).maybeSingle(),
      serviceClient.from('subscriptions').select('*').eq('org_id', orgId).maybeSingle(),
      serviceClient.from('org_members').select('user_id, role, created_at').eq('org_id', orgId).order('created_at'),
      serviceClient.from('org_invitations').select('*').eq('org_id', orgId).is('accepted_at', null).gt('expires_at', new Date().toISOString()),
    ]);

    if (!orgRes.data) { res.status(404).json({ error: 'Organization not found' }); return; }

    // Resolve member emails via auth.admin API
    const memberRows = (memberRes.data ?? []) as { user_id: string; role: string; created_at: string }[];
    const members = await Promise.all(
      memberRows.map(async (m) => {
        const { data } = await serviceClient.auth.admin.getUserById(m.user_id);
        return { userId: m.user_id, email: data?.user?.email ?? '', role: m.role, joinedAt: m.created_at };
      })
    );

    const tokensThisMonth = await getMonthlyTokens(serviceClient, orgId);

    res.json({
      org:          orgRes.data,
      subscription: subRes.data ?? null,
      members,
      tokensThisMonth,
      invitations:  invRes.data ?? [],
    });
  } catch (err) {
    console.error('GET admin/orgs/:orgId failed', err);
    res.status(500).json({ error: 'Failed to load organization' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orgs/:orgId/subscription
// Body: { plan?, status?, trialEndsAt? }
// ---------------------------------------------------------------------------
adminRouter.patch('/admin/orgs/:orgId/subscription', async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const body = req.body || {};
  const validPlans   = ['free', 'team', 'business', 'enterprise'];
  const validStatuses = ['trialing', 'active', 'past_due', 'canceled'];

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.plan   && validPlans.includes(body.plan))     patch.plan   = body.plan;
  if (body.status && validStatuses.includes(body.status)) patch.status = body.status;
  if ('trialEndsAt' in body) {
    patch.trial_ends_at = body.trialEndsAt ? new Date(body.trialEndsAt).toISOString() : null;
  }

  if (Object.keys(patch).length === 1) {
    res.status(400).json({ error: 'Nothing to update' });
    return;
  }

  try {
    const { data, error } = await serviceClient
      .from('subscriptions')
      .upsert({ org_id: orgId, ...patch }, { onConflict: 'org_id' })
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    await logAdminAction(req.user!.email, 'override_subscription', 'subscription', orgId, patch as Record<string, unknown>);
    res.json(data);
  } catch (err) {
    console.error('PATCH admin subscription failed', err);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/orgs/:orgId/members/:userId
// ---------------------------------------------------------------------------
adminRouter.delete('/admin/orgs/:orgId/members/:userId', async (req: Request, res: Response) => {
  const { orgId, userId } = req.params;
  try {
    const { error } = await serviceClient
      .from('org_members')
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    await logAdminAction(req.user!.email, 'remove_member', 'org', orgId, { userId });
    res.status(204).end();
  } catch (err) {
    console.error('DELETE admin member failed', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/restart
// In dev (tsx watch): touches src/index.ts so tsx watch detects the change,
// kills the current child, and immediately starts a fresh one — no port
// conflict, no duplicate watchers.
// In production (compiled JS): exits so PM2 / Docker restarts the process.
// ---------------------------------------------------------------------------
adminRouter.post('/admin/restart', (_req: Request, res: Response) => {
  res.json({ ok: true, message: 'Restarting...' });
  res.on('finish', () => {
    // Detect dev vs prod by checking whether this file was loaded as .ts source.
    const thisFile = fileURLToPath(import.meta.url);
    if (thisFile.endsWith('.ts')) {
      // Dev: touch the entry point so tsx watch restarts the child process.
      const entryPath = resolve(dirname(thisFile), '..', 'index.ts');
      const now = new Date();
      try { utimesSync(entryPath, now, now); } catch { /* ignore */ }
    } else {
      // Production: exit and let the process manager (PM2, Docker) restart.
      setTimeout(() => process.exit(0), 100);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------
adminRouter.get('/admin/users', async (req: Request, res: Response) => {
  const page   = Math.max(1, Number(req.query.page)  || 1);
  const limit  = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const search = ((req.query.search as string) || '').trim();

  try {
    // Supabase admin API supports pagination but not email search natively —
    // we fetch the page and filter, or use a broader fetch + filter for search.
    const { data: { users }, error } = await serviceClient.auth.admin.listUsers({
      page,
      perPage: limit,
    });
    if (error) throw new Error(error.message);

    const filtered = search
      ? users.filter((u) => u.email?.toLowerCase().includes(search.toLowerCase()))
      : users;

    const userIds = filtered.map((u) => u.id);

    // Get all memberships for these users
    const { data: memberRows } = userIds.length
      ? await serviceClient
          .from('org_members')
          .select('user_id, org_id, role')
          .in('user_id', userIds)
      : { data: [] };

    const orgIds = [...new Set(((memberRows ?? []) as { org_id: string }[]).map((m) => m.org_id))];

    const { data: orgRows } = orgIds.length
      ? await serviceClient.from('organizations').select('id, name, slug').in('id', orgIds)
      : { data: [] };

    const orgMap = new Map(
      ((orgRows ?? []) as { id: string; name: string; slug: string }[]).map((o) => [o.id, o])
    );

    const membersByUser = new Map<string, { orgId: string; orgName: string; orgSlug: string; role: string }[]>();
    for (const m of (memberRows ?? []) as { user_id: string; org_id: string; role: string }[]) {
      const org = orgMap.get(m.org_id);
      if (!org) continue;
      const list = membersByUser.get(m.user_id) ?? [];
      list.push({ orgId: m.org_id, orgName: org.name, orgSlug: org.slug, role: m.role });
      membersByUser.set(m.user_id, list);
    }

    res.json({
      users: filtered.map((u) => ({
        id:        u.id,
        email:     u.email ?? '',
        createdAt: u.created_at,
        orgs:      membersByUser.get(u.id) ?? [],
      })),
      total: filtered.length,
    });
  } catch (err) {
    console.error('GET admin/users failed', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

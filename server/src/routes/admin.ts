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
//   GET  /api/admin/users/:userId                 — user detail + memberships
//   PATCH /api/admin/users/:userId                — suspend/unsuspend/set_password/set_email/confirm_email
//   POST /api/admin/users/:userId/reset-email     — send password-reset email
//   DELETE /api/admin/users/:userId               — permanently delete user

import { utimesSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { serviceClient } from '../supabase.js';
import { PLAN_LIMITS, getMonthlyTokens } from '../billing.js';
import { loadAiConfig, serverFallbackAi } from './studio.js';
import { fetchSiteText } from '../studio/aiTeam.js';
import { generateGalleryBlock } from '../studio/generateGalleryBlock.js';
import { loadMailSettings, saveMailSettings, sendTestMail, type MailSettings } from '../integrations/mail.js';
import { loadAppearance, saveAppearance, BG_KINDS, type AppearanceSettings } from './platform.js';
import { getIntegrationsView, savePlatformIntegrations, INTEGRATION_FIELDS } from '../platformConfig.js';

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
// Scope the guard to /admin/* only: this router is mounted at '/api', so an
// unscoped guard would 403 every other /api request that falls through to here
// (agents, alerts, dashboards, …) before it reaches its own router.
adminRouter.use('/admin', requireAdmin);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function logAdminAction(
  adminEmail: string,
  action: string,
  targetType: 'org' | 'user' | 'subscription' | 'block' | 'settings',
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

/** A GoTrue user is suspended when banned_until is set and still in the future. */
function isSuspended(user: { banned_until?: string | null }): boolean {
  const until = user.banned_until;
  return !!until && new Date(until) > new Date();
}

// ---------------------------------------------------------------------------
// GET /api/admin/me
// ---------------------------------------------------------------------------
adminRouter.get('/admin/me', (req: Request, res: Response) => {
  res.json({ isAdmin: true, email: req.user!.email });
});

// ---------------------------------------------------------------------------
// Block Gallery management — admin builds/curates platform-wide Blocks.
// ---------------------------------------------------------------------------

adminRouter.get('/admin/gallery-blocks', async (_req: Request, res: Response) => {
  const { data, error } = await serviceClient.from('gallery_blocks').select('*').order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ blocks: data ?? [] });
});

// Generate a Block draft from a documentation URL using AI (admin reviews, then saves).
adminRouter.post('/admin/gallery-blocks/generate', async (req: Request, res: Response) => {
  const docsUrl = String(req.body?.docsUrl ?? '').trim();
  const hint = String(req.body?.hint ?? '').trim();
  if (!/^https?:\/\//i.test(docsUrl)) { res.status(400).json({ error: 'Provide a documentation URL (https://…).' }); return; }
  let ai = (await loadAiConfig(String(req.body?.orgId ?? '')).catch(() => null)) ?? serverFallbackAi();
  // No org passed / no server key: use an org the admin belongs to that has AI set up.
  if (!ai) {
    const { data: mems } = await serviceClient.from('org_members').select('org_id').eq('user_id', req.user!.id);
    for (const m of (mems ?? []) as { org_id: string }[]) {
      ai = await loadAiConfig(m.org_id).catch(() => null);
      if (ai) break;
    }
  }
  if (!ai) { res.status(400).json({ error: 'No AI provider configured. Add an AI key in any of your orgs (Settings → AI) or set a server key.' }); return; }
  try {
    const site = await fetchSiteText(docsUrl);
    if (!site.text.trim()) { res.status(502).json({ error: 'Could not read that documentation page.' }); return; }
    const draft = await generateGalleryBlock(ai, { url: docsUrl, docsText: site.text, hint });
    res.json({ draft });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : 'Generation failed.' });
  }
});

// Create or update (by slug) a gallery Block.
adminRouter.post('/admin/gallery-blocks', async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (!b.name) { res.status(400).json({ error: 'name is required.' }); return; }
  const slug = String(b.slug || b.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'block';
  const row = {
    slug,
    name: String(b.name).slice(0, 80),
    icon: String(b.icon || '📦').slice(0, 8),
    category: ['markets', 'data', 'web', 'utility'].includes(String(b.category)) ? String(b.category) : 'data',
    tagline: String(b.tagline || '').slice(0, 80),
    description: String(b.description || '').slice(0, 600),
    size_w: Math.min(Math.max(Number(b.sizeW) || 3, 1), 6),
    size_h: Math.min(Math.max(Number(b.sizeH) || 3, 1), 6),
    fields: Array.isArray(b.fields) ? (b.fields as unknown[]).slice(0, 12) : [],
    html_template: String(b.htmlTemplate).slice(0, 20000),
    docs_url: b.docsUrl ? String(b.docsUrl).slice(0, 500) : null,
    enabled: b.enabled !== false,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await serviceClient.from('gallery_blocks').upsert(row, { onConflict: 'slug' }).select('*').single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAdminAction(req.user!.email, 'gallery_block_save', 'block', (data as { id: string }).id, { slug });
  res.json({ block: data });
});

adminRouter.patch('/admin/gallery-blocks/:id', async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof b.name === 'string') patch.name = b.name.slice(0, 80);
  if (typeof b.icon === 'string') patch.icon = b.icon.slice(0, 8);
  if (typeof b.category === 'string' && ['markets', 'data', 'web', 'utility'].includes(b.category)) patch.category = b.category;
  if (typeof b.tagline === 'string') patch.tagline = b.tagline.slice(0, 80);
  if (typeof b.description === 'string') patch.description = b.description.slice(0, 600);
  if (b.sizeW != null) patch.size_w = Math.min(Math.max(Number(b.sizeW) || 3, 1), 6);
  if (b.sizeH != null) patch.size_h = Math.min(Math.max(Number(b.sizeH) || 3, 1), 6);
  if (Array.isArray(b.fields)) patch.fields = (b.fields as unknown[]).slice(0, 12);
  if (typeof b.htmlTemplate === 'string') patch.html_template = b.htmlTemplate.slice(0, 20000);
  if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;
  const { data, error } = await serviceClient.from('gallery_blocks').update(patch).eq('id', req.params.id).select('*').single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAdminAction(req.user!.email, 'gallery_block_update', 'block', req.params.id);
  res.json({ block: data });
});

adminRouter.delete('/admin/gallery-blocks/:id', async (req: Request, res: Response) => {
  const { error } = await serviceClient.from('gallery_blocks').delete().eq('id', req.params.id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAdminAction(req.user!.email, 'gallery_block_delete', 'block', req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Mail server (SMTP) settings — the password is never returned to the client.
// ---------------------------------------------------------------------------

function maskMail(m: MailSettings) {
  return { ...m, password: '', hasPassword: !!m.password };
}

adminRouter.get('/admin/mail-settings', async (_req: Request, res: Response) => {
  res.json({ settings: maskMail(await loadMailSettings()) });
});

adminRouter.put('/admin/mail-settings', async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const cur = await loadMailSettings();
  const next: MailSettings = {
    host: String(b.host ?? '').trim(),
    port: Math.min(Math.max(parseInt(String(b.port ?? '587'), 10) || 587, 1), 65535),
    secure: !!b.secure,
    username: String(b.username ?? '').trim(),
    password: b.password ? String(b.password) : cur.password, // blank = keep existing
    fromName: String(b.fromName ?? '').trim(),
    fromEmail: String(b.fromEmail ?? '').trim(),
  };
  await saveMailSettings(next);
  await logAdminAction(req.user!.email, 'mail_settings_save', 'settings', 'mail');
  res.json({ settings: maskMail(next) });
});

// Global appearance (brand accent + animated background) — applies to the public
// homepage and as the platform-wide default.
adminRouter.get('/admin/appearance', async (_req: Request, res: Response) => {
  res.json(await loadAppearance());
});
adminRouter.put('/admin/appearance', async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as { brand?: string; bg?: string; skin?: string };
  const next: AppearanceSettings = {
    brand: (['blue', 'green', 'grey'] as const).includes(b.brand as 'blue') ? (b.brand as AppearanceSettings['brand']) : 'blue',
    bg: BG_KINDS.includes(b.bg as typeof BG_KINDS[number]) ? (b.bg as AppearanceSettings['bg']) : 'none',
    skin: typeof b.skin === 'string' && b.skin ? b.skin.slice(0, 40) : 'aurora',
  };
  await saveAppearance(next);
  await logAdminAction(req.user!.email, 'appearance_save', 'settings', 'appearance', { brand: next.brand, bg: next.bg, skin: next.skin });
  res.json(next);
});

// Global service integrations (HeyGen / Vapi) — platform-wide, shared by all orgs.
adminRouter.get('/admin/integrations', async (_req: Request, res: Response) => {
  res.json(await getIntegrationsView());
});
adminRouter.put('/admin/integrations', async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, string>;
  const patch: Record<string, string> = {};
  for (const k of INTEGRATION_FIELDS) if (k in b) patch[k] = String(b[k] ?? '');
  await savePlatformIntegrations(patch);
  await logAdminAction(req.user!.email, 'integrations_save', 'settings', 'integrations',
    { fields: Object.keys(patch) });
  res.json(await getIntegrationsView());
});

adminRouter.post('/admin/mail-settings/test', async (req: Request, res: Response) => {
  const to = String(req.body?.to ?? '').trim();
  if (!/.+@.+\..+/.test(to)) { res.status(400).json({ error: 'Enter a valid recipient address.' }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const cur = await loadMailSettings();
  const cfg: MailSettings = {
    host: String(b.host ?? cur.host).trim(),
    port: parseInt(String(b.port ?? cur.port), 10) || cur.port,
    secure: b.secure != null ? !!b.secure : cur.secure,
    username: String(b.username ?? cur.username).trim(),
    password: b.password ? String(b.password) : cur.password,
    fromName: String(b.fromName ?? cur.fromName).trim(),
    fromEmail: String(b.fromEmail ?? cur.fromEmail).trim(),
  };
  try {
    await sendTestMail(cfg, to);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : 'Test send failed.' });
  }
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
        id:           u.id,
        email:        u.email ?? '',
        createdAt:    u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        suspended:    isSuspended(u),
        orgs:         membersByUser.get(u.id) ?? [],
      })),
      total: filtered.length,
    });
  } catch (err) {
    console.error('GET admin/users failed', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/users/:userId — full user detail + org memberships
// ---------------------------------------------------------------------------
adminRouter.get('/admin/users/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  try {
    const { data, error } = await serviceClient.auth.admin.getUserById(userId);
    if (error || !data?.user) { res.status(404).json({ error: 'User not found' }); return; }
    const u = data.user;

    // Org memberships (with org names + roles)
    const { data: memberRows } = await serviceClient
      .from('org_members')
      .select('org_id, role, created_at')
      .eq('user_id', userId);

    const orgIds = [...new Set(((memberRows ?? []) as { org_id: string }[]).map((m) => m.org_id))];
    const { data: orgRows } = orgIds.length
      ? await serviceClient.from('organizations').select('id, name, slug').in('id', orgIds)
      : { data: [] };
    const orgMap = new Map(
      ((orgRows ?? []) as { id: string; name: string; slug: string }[]).map((o) => [o.id, o])
    );
    const orgs = ((memberRows ?? []) as { org_id: string; role: string; created_at: string }[])
      .map((m) => {
        const org = orgMap.get(m.org_id);
        return org
          ? { orgId: m.org_id, orgName: org.name, orgSlug: org.slug, role: m.role, joinedAt: m.created_at }
          : null;
      })
      .filter(Boolean);

    res.json({
      id:              u.id,
      email:           u.email ?? '',
      phone:           u.phone ?? null,
      createdAt:       u.created_at,
      lastSignInAt:    u.last_sign_in_at ?? null,
      emailConfirmed:  !!u.email_confirmed_at,
      suspended:       isSuspended(u),
      bannedUntil:     (u as { banned_until?: string | null }).banned_until ?? null,
      provider:        (u.app_metadata?.provider as string) ?? 'email',
      providers:       (u.app_metadata?.providers as string[]) ?? [],
      orgs,
    });
  } catch (err) {
    console.error('GET admin/users/:userId failed', err);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/:userId
// Body: { action: 'suspend'|'unsuspend'|'set_password'|'set_email'|'confirm_email', password?, email? }
// ---------------------------------------------------------------------------
adminRouter.patch('/admin/users/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { action, password, email } = (req.body || {}) as {
    action?: string; password?: string; email?: string;
  };

  // Guard: admins cannot suspend or lock themselves out of their own account.
  if (userId === req.user!.id && (action === 'suspend')) {
    res.status(400).json({ error: 'You cannot suspend your own account.' });
    return;
  }

  let attrs: Record<string, unknown>;
  switch (action) {
    case 'suspend':
      // ~100 years — effectively indefinite until an admin unsuspends.
      attrs = { ban_duration: '876000h' };
      break;
    case 'unsuspend':
      attrs = { ban_duration: 'none' };
      break;
    case 'set_password':
      if (!password || String(password).length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters.' });
        return;
      }
      attrs = { password: String(password) };
      break;
    case 'set_email':
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) {
        res.status(400).json({ error: 'A valid email is required.' });
        return;
      }
      attrs = { email: String(email), email_confirm: true };
      break;
    case 'confirm_email':
      attrs = { email_confirm: true };
      break;
    default:
      res.status(400).json({ error: 'Unknown or missing action.' });
      return;
  }

  try {
    const { data, error } = await serviceClient.auth.admin.updateUserById(userId, attrs);
    if (error) throw new Error(error.message);

    // Never log raw passwords — record only that a change occurred.
    const logPayload = action === 'set_password' ? { action } : { action, ...attrs };
    await logAdminAction(req.user!.email, action!, 'user', userId, logPayload);

    const u = data.user;
    res.json({
      id:             u.id,
      email:          u.email ?? '',
      suspended:      isSuspended(u),
      bannedUntil:    (u as { banned_until?: string | null }).banned_until ?? null,
      emailConfirmed: !!u.email_confirmed_at,
    });
  } catch (err) {
    console.error('PATCH admin/users/:userId failed', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:userId/reset-email — send a password-reset email
// Triggers the standard recovery flow (lands in Inbucket locally / real SMTP
// in prod). Uses the public recover endpoint with the anon key.
// ---------------------------------------------------------------------------
adminRouter.post('/admin/users/:userId/reset-email', async (req: Request, res: Response) => {
  const { userId } = req.params;
  try {
    const { data, error } = await serviceClient.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) { res.status(404).json({ error: 'User not found' }); return; }
    const email = data.user.email;

    const recoverRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });
    if (!recoverRes.ok) {
      const body = await recoverRes.text().catch(() => '');
      throw new Error(`recover ${recoverRes.status}: ${body}`);
    }

    await logAdminAction(req.user!.email, 'send_reset_email', 'user', userId, { email });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST admin reset-email failed', err);
    res.status(500).json({ error: 'Failed to send reset email' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/users/:userId — permanently delete an auth user
// ---------------------------------------------------------------------------
adminRouter.delete('/admin/users/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  if (userId === req.user!.id) {
    res.status(400).json({ error: 'You cannot delete your own account.' });
    return;
  }
  try {
    const { error } = await serviceClient.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    await logAdminAction(req.user!.email, 'delete_user', 'user', userId);
    res.status(204).end();
  } catch (err) {
    console.error('DELETE admin/users/:userId failed', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

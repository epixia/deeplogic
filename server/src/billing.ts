// Billing utilities: plan definitions, limit checks, subscription queries.

import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Plan definitions
// ---------------------------------------------------------------------------

export type Plan = 'free' | 'team' | 'business' | 'enterprise';
export type SubStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export interface PlanLimits {
  members: number;          // max org members (Infinity = unlimited)
  reports: number;          // max studio projects (Infinity = unlimited)
  tokensPerMonth: number;   // AI tokens per billing period (Infinity = unlimited)
  byok: boolean;            // Bring Your Own Key
  mcp: boolean;             // MCP connector context items
  auditLog: boolean;        // audit log access
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    members:        2,
    reports:        3,
    tokensPerMonth: 100_000,
    byok:           false,
    mcp:            false,
    auditLog:       false,
  },
  team: {
    members:        Infinity,
    reports:        Infinity,
    tokensPerMonth: 2_000_000,
    byok:           false,
    mcp:            false,
    auditLog:       false,
  },
  business: {
    members:        Infinity,
    reports:        Infinity,
    tokensPerMonth: 10_000_000,
    byok:           true,
    mcp:            true,
    auditLog:       true,
  },
  enterprise: {
    members:        Infinity,
    reports:        Infinity,
    tokensPerMonth: Infinity,
    byok:           true,
    mcp:            true,
    auditLog:       true,
  },
};

// ---------------------------------------------------------------------------
// Subscription shape (mirrors the DB row)
// ---------------------------------------------------------------------------

export interface OrgSubscription {
  orgId: string;
  plan: Plan;
  status: SubStatus;
  seatCount: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** Effective plan after accounting for trial expiry. */
  effectivePlan: Plan;
  /** True if the trial is still active. */
  inTrial: boolean;
}

// ---------------------------------------------------------------------------
// Queries (service client — bypasses RLS)
// ---------------------------------------------------------------------------

/** Fetch an org's subscription row. Returns a free default if missing. */
export async function getOrgSubscription(
  service: SupabaseClient,
  orgId: string
): Promise<OrgSubscription> {
  const { data, error } = await service
    .from('subscriptions')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const row = data as {
    org_id: string;
    plan: Plan;
    status: SubStatus;
    seat_count: number;
    trial_ends_at: string | null;
    current_period_end: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
  } | null;

  const plan: Plan = row?.plan ?? 'free';
  const status: SubStatus = row?.status ?? 'active';
  const trialEndsAt = row?.trial_ends_at ?? null;

  const inTrial =
    status === 'trialing' &&
    trialEndsAt != null &&
    new Date(trialEndsAt) > new Date();

  // If trial expired and they haven't subscribed, fall back to free.
  const effectivePlan: Plan =
    status === 'canceled' || (status === 'trialing' && !inTrial)
      ? 'free'
      : plan;

  return {
    orgId,
    plan,
    status,
    seatCount: row?.seat_count ?? 1,
    trialEndsAt,
    currentPeriodEnd: row?.current_period_end ?? null,
    stripeCustomerId: row?.stripe_customer_id ?? null,
    stripeSubscriptionId: row?.stripe_subscription_id ?? null,
    effectivePlan,
    inTrial,
  };
}

/** Effective limits for an org (resolves trial + effective plan). */
export async function getOrgLimits(
  service: SupabaseClient,
  orgId: string
): Promise<PlanLimits> {
  const sub = await getOrgSubscription(service, orgId);
  return PLAN_LIMITS[sub.effectivePlan];
}

// ---------------------------------------------------------------------------
// Usage queries
// ---------------------------------------------------------------------------

/** Sum tokens used in the current calendar month for an org. */
export async function getMonthlyTokens(
  service: SupabaseClient,
  orgId: string
): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const { data, error } = await service
    .from('usage_events')
    .select('tokens')
    .eq('org_id', orgId)
    .gte('created_at', start.toISOString());

  if (error) throw new Error(error.message);
  return ((data ?? []) as { tokens: number }[]).reduce((s, r) => s + r.tokens, 0);
}

/** Log a usage event after generation. Fire-and-forget safe (catches errors). */
export async function logUsageEvent(
  service: SupabaseClient,
  orgId: string,
  userId: string | undefined,
  eventType: 'ai_generation' | 'template_generation',
  tokens: number,
  model?: string,
  projectId?: string
): Promise<void> {
  await service.from('usage_events').insert({
    org_id: orgId,
    user_id: userId ?? null,
    event_type: eventType,
    tokens,
    model: model ?? null,
    project_id: projectId ?? null,
  });
}

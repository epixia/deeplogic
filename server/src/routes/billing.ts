// Stripe billing routes.
//   GET  /api/orgs/:orgId/billing/subscription  — current plan + usage summary
//   POST /api/orgs/:orgId/billing/checkout       — create Stripe Checkout session
//   POST /api/orgs/:orgId/billing/portal         — create Stripe Customer Portal session
//   POST /api/webhooks/stripe                    — Stripe webhook (public, signature verified)

import { Router } from 'express';
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { requireMember, requireRole } from '../auth.js';
import { serviceClient } from '../supabase.js';
import { getOrgSubscription, getMonthlyTokens, PLAN_LIMITS } from '../billing.js';

export const billingRouter = Router();

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' });
}

// ---------------------------------------------------------------------------
// GET /api/orgs/:orgId/billing/subscription
// ---------------------------------------------------------------------------
billingRouter.get(
  '/orgs/:orgId/billing/subscription',
  requireMember(),
  async (req: Request, res: Response) => {
    try {
      const sub = await getOrgSubscription(serviceClient, req.params.orgId);
      const tokensUsed = await getMonthlyTokens(serviceClient, req.params.orgId);
      const limits = PLAN_LIMITS[sub.effectivePlan];

      // Count active members.
      const { count } = await serviceClient
        .from('org_members')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', req.params.orgId);

      res.json({
        plan:            sub.effectivePlan,
        status:          sub.status,
        inTrial:         sub.inTrial,
        trialEndsAt:     sub.trialEndsAt,
        currentPeriodEnd: sub.currentPeriodEnd,
        seatCount:       count ?? 0,
        tokensUsed,
        limits: {
          members:        limits.members === Infinity ? null : limits.members,
          reports:        limits.reports === Infinity ? null : limits.reports,
          tokensPerMonth: limits.tokensPerMonth === Infinity ? null : limits.tokensPerMonth,
          byok:           limits.byok,
          mcp:            limits.mcp,
          auditLog:       limits.auditLog,
        },
        hasStripe: !!sub.stripeSubscriptionId,
      });
    } catch (err) {
      console.error('GET billing/subscription failed', err);
      res.status(500).json({ error: 'Failed to load subscription' });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/orgs/:orgId/billing/checkout
// Body: { plan: 'team' | 'business', seats?: number }
// ---------------------------------------------------------------------------
billingRouter.post(
  '/orgs/:orgId/billing/checkout',
  requireRole(['owner']),
  async (req: Request, res: Response) => {
    const { plan, seats = 1 } = req.body as { plan: string; seats?: number };
    const priceId = plan === 'business'
      ? process.env.STRIPE_PRICE_BUSINESS
      : process.env.STRIPE_PRICE_TEAM;
    if (!priceId) {
      res.status(400).json({ error: `No Stripe price configured for plan: ${plan}` });
      return;
    }
    try {
      const s = stripe();
      const sub = await getOrgSubscription(serviceClient, req.params.orgId);
      const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

      // Reuse existing Stripe customer if we have one.
      let customerId = sub.stripeCustomerId ?? undefined;
      if (!customerId) {
        const customer = await s.customers.create({
          email: req.user!.email,
          metadata: { org_id: req.params.orgId },
        });
        customerId = customer.id;
        await serviceClient
          .from('subscriptions')
          .update({ stripe_customer_id: customerId })
          .eq('org_id', req.params.orgId);
      }

      const session = await s.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: seats }],
        allow_promotion_codes: true,
        success_url: `${appUrl}/app/${req.params.orgId}/settings?tab=billing&checkout=success`,
        cancel_url:  `${appUrl}/app/${req.params.orgId}/settings?tab=billing`,
        metadata: { org_id: req.params.orgId },
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error('POST billing/checkout failed', err);
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/orgs/:orgId/billing/portal
// ---------------------------------------------------------------------------
billingRouter.post(
  '/orgs/:orgId/billing/portal',
  requireRole(['owner']),
  async (req: Request, res: Response) => {
    try {
      const sub = await getOrgSubscription(serviceClient, req.params.orgId);
      if (!sub.stripeCustomerId) {
        res.status(400).json({ error: 'No Stripe customer found — subscribe first' });
        return;
      }
      const s = stripe();
      const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
      const session = await s.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: `${appUrl}/app/${req.params.orgId}/settings?tab=billing`,
      });
      res.json({ url: session.url });
    } catch (err) {
      console.error('POST billing/portal failed', err);
      res.status(500).json({ error: 'Failed to create portal session' });
    }
  }
);

// POST /api/webhooks/stripe is registered in index.ts (needs raw body parser).
// Export the handler here so index.ts can wire it up.
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    res.status(500).json({ error: 'Webhook secret not configured' });
    return;
  }
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: `Webhook signature verification failed: ${msg}` });
    return;
  }
  try {
    await handleStripeEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handler failed', event.type, err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}

// ---------------------------------------------------------------------------
// Stripe event handlers
// ---------------------------------------------------------------------------

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.org_id;
      if (!orgId || !session.subscription) break;
      await syncSubscription(orgId, session.subscription as string);
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const stripeSub = event.data.object as Stripe.Subscription;
      const orgId = stripeSub.metadata?.org_id
        ?? await orgIdForCustomer(stripeSub.customer as string);
      if (!orgId) break;
      await syncSubscriptionObject(orgId, stripeSub);
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const orgId = await orgIdForCustomer(invoice.customer as string);
      if (!orgId) break;
      await serviceClient
        .from('subscriptions')
        .update({ status: 'past_due', updated_at: new Date().toISOString() })
        .eq('org_id', orgId);
      break;
    }
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      const orgId = await orgIdForCustomer(invoice.customer as string);
      if (!orgId) break;
      await serviceClient
        .from('subscriptions')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('org_id', orgId);
      break;
    }
  }
}

async function orgIdForCustomer(customerId: string): Promise<string | null> {
  const { data } = await serviceClient
    .from('subscriptions')
    .select('org_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return (data as { org_id: string } | null)?.org_id ?? null;
}

async function syncSubscription(orgId: string, subscriptionId: string): Promise<void> {
  const stripeSub = await stripe().subscriptions.retrieve(subscriptionId);
  await syncSubscriptionObject(orgId, stripeSub);
}

async function syncSubscriptionObject(orgId: string, stripeSub: Stripe.Subscription): Promise<void> {
  // Cast to any for cross-version field access (Stripe renames fields across API versions).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sub = stripeSub as any;
  const priceId = sub.items?.data[0]?.price?.id ?? '';
  const plan = priceToplan(priceId);
  const status = stripeStatusToLocal(sub.status);
  const periodEnd: number | undefined = sub.current_period_end;
  const currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
  const seatCount = sub.items?.data[0]?.quantity ?? 1;
  const trialEnd: number | null = sub.trial_end ?? null;

  await serviceClient
    .from('subscriptions')
    .upsert({
      org_id:                  orgId,
      plan,
      status,
      seat_count:              seatCount,
      current_period_end:      currentPeriodEnd,
      trial_ends_at:           trialEnd ? new Date(trialEnd * 1000).toISOString() : null,
      stripe_subscription_id:  sub.id,
      stripe_customer_id:      sub.customer as string,
      updated_at:              new Date().toISOString(),
    }, { onConflict: 'org_id' });
}

function priceToplan(priceId: string): string {
  if (priceId === process.env.STRIPE_PRICE_BUSINESS) return 'business';
  if (priceId === process.env.STRIPE_PRICE_TEAM) return 'team';
  return 'free';
}

function stripeStatusToLocal(status: Stripe.Subscription.Status): string {
  if (status === 'trialing') return 'trialing';
  if (status === 'active')   return 'active';
  if (status === 'past_due') return 'past_due';
  return 'canceled';
}

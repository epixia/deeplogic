-- Billing layer: subscriptions, token metering, member invitations.

-- ---------------------------------------------------------------------------
-- subscriptions
-- One row per org. Auto-created (trialing Team for 14 days) by trigger on
-- org insert. Stripe is the source of truth; this table is a synced cache.
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  org_id                 uuid primary key references public.organizations (id) on delete cascade,
  plan                   text not null default 'free'
                           check (plan in ('free', 'team', 'business', 'enterprise')),
  status                 text not null default 'trialing'
                           check (status in ('trialing', 'active', 'past_due', 'canceled')),
  seat_count             int  not null default 1,
  trial_ends_at          timestamptz,
  current_period_end     timestamptz,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Automatically seed a 14-day Team trial whenever an org is created.
create or replace function public.seed_org_subscription()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.subscriptions (org_id, plan, status, trial_ends_at)
  values (new.id, 'team', 'trialing', now() + interval '14 days');
  return new;
end;
$$;

drop trigger if exists trg_seed_subscription on public.organizations;
create trigger trg_seed_subscription
  after insert on public.organizations
  for each row execute function public.seed_org_subscription();

-- ---------------------------------------------------------------------------
-- usage_events
-- One row per AI generation call. Used to enforce monthly token budgets.
-- ---------------------------------------------------------------------------
create table if not exists public.usage_events (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete set null,
  event_type text not null check (event_type in ('ai_generation', 'template_generation')),
  tokens     int  not null default 0,
  model      text,
  project_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists usage_events_org_period_idx on public.usage_events (org_id, created_at);

-- ---------------------------------------------------------------------------
-- org_invitations
-- Pending email invitations. Accepted once the invitee signs up + clicks link.
-- ---------------------------------------------------------------------------
create table if not exists public.org_invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  email       text not null,
  role        text not null default 'member'
                check (role in ('owner', 'admin', 'member')),
  invited_by  uuid references auth.users (id) on delete set null,
  token       text unique not null default encode(gen_random_bytes(32), 'hex'),
  accepted_at timestamptz,
  expires_at  timestamptz not null default now() + interval '7 days',
  created_at  timestamptz not null default now(),
  unique (org_id, email)
);
create index if not exists invitations_token_idx on public.org_invitations (token);
create index if not exists invitations_org_idx   on public.org_invitations (org_id);

-- ---------------------------------------------------------------------------
-- RLS
-- subscriptions: members can read their org's subscription; server (service
--   role) manages writes via the webhook.
-- usage_events: service role only (no client reads needed; summary served
--   by billing route).
-- org_invitations: owner/admin can read/manage; public token lookup via
--   service role in the invite routes.
-- ---------------------------------------------------------------------------
alter table public.subscriptions  enable row level security;
alter table public.usage_events   enable row level security;
alter table public.org_invitations enable row level security;

create policy sub_select on public.subscriptions
  for select using (public.is_org_member(org_id));

create policy inv_select on public.org_invitations
  for select using (public.has_org_role(org_id, array['owner', 'admin']));
create policy inv_insert on public.org_invitations
  for insert with check (public.has_org_role(org_id, array['owner', 'admin']));
create policy inv_delete on public.org_invitations
  for delete using (public.has_org_role(org_id, array['owner', 'admin']));

-- Webhook Connector: let external apps / Zapier / Make push data into DeepLogic.
-- Flow: external app → POST /api/webhooks/:orgId/ingest?token=… → org_webhook_events
--       (DataVault) → Blocks / Signals / Agents.
--
-- A per-org token authorizes inbound writes (the caller has no user session).

create table if not exists public.org_webhooks (
  org_id     uuid primary key references public.organizations (id) on delete cascade,
  token      uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.org_webhooks enable row level security;
create policy "org_webhooks_member" on public.org_webhooks for all
  using (is_org_member(org_id));

-- Raw inbound webhook payloads, landed in the DataVault for downstream use.
create table if not exists public.org_webhook_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  source      text,                              -- optional sender label (?source=)
  payload     jsonb not null,
  received_at timestamptz not null default now()
);
create index if not exists org_webhook_events_org_idx on public.org_webhook_events (org_id, received_at desc);

alter table public.org_webhook_events enable row level security;
create policy "org_webhook_events_member" on public.org_webhook_events for select
  using (is_org_member(org_id));

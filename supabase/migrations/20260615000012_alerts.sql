-- Alerts: condition-based triggers evaluated by AI against data sources.

create table public.alerts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  created_by   uuid references auth.users(id),
  name         text not null,
  condition    text not null,
  sources      jsonb not null default '[]'::jsonb,
  notify_email text,
  status       text not null default 'active' check (status in ('active', 'paused')),
  last_checked timestamptz,
  last_fired   timestamptz,
  fire_count   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.alert_events (
  id       uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts(id) on delete cascade,
  org_id   uuid not null,
  fired_at timestamptz not null default now(),
  summary  text
);

alter table public.alerts enable row level security;
alter table public.alert_events enable row level security;

create policy "alerts_member" on public.alerts for all
  using (is_org_member(org_id));

create policy "alert_events_member" on public.alert_events for all
  using (is_org_member(org_id));

create index alerts_org_id_idx on public.alerts(org_id);
create index alert_events_alert_id_idx on public.alert_events(alert_id);

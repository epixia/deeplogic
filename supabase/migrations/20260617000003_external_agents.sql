-- External agents: autonomous agent runtimes (Hermes, OpenClaw) deployed in a VM.
create table if not exists public.external_agents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  created_by  uuid references auth.users (id) on delete set null,
  provider    text not null check (provider in ('hermes', 'openclaw')),
  name        text not null,
  status      text not null default 'provisioning'
              check (status in ('provisioning', 'running', 'stopped', 'failed')),
  region      text,
  size        text,
  host        text,
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists external_agents_org_idx on public.external_agents (org_id);

alter table public.external_agents enable row level security;
create policy "external_agents_member" on public.external_agents for all
  using (is_org_member(org_id));

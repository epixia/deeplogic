-- AI Activity Log: a unified record of every agent run — internal (one-shot /
-- chat-triggered) and external (deployed VM missions). Each run carries a
-- streamable trace (agent_run_events) and a durable result.

create table public.agent_runs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  agent_id          uuid references public.agents(id) on delete set null,
  external_agent_id uuid references public.external_agents(id) on delete set null,
  agent_kind        text not null default 'internal' check (agent_kind in ('internal', 'external')),
  agent_name        text not null default '',
  trigger           text not null default 'manual' check (trigger in ('manual', 'schedule', 'chat', 'goal', 'orchestrator', 'deploy')),
  status            text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  model             text,
  trigger_context   jsonb not null default '{}'::jsonb,
  result            text,
  error             text,
  tokens_in         integer,
  tokens_out        integer,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  created_at        timestamptz not null default now()
);

create table public.agent_run_events (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references public.agent_runs(id) on delete cascade,
  org_id     uuid not null,
  kind       text not null default 'step',   -- step | tool_call | tool_result | reasoning | output
  icon       text,
  message    text not null default '',
  data       jsonb,
  created_at timestamptz not null default now()
);

alter table public.agent_runs enable row level security;
alter table public.agent_run_events enable row level security;

create policy "agent_runs_member" on public.agent_runs for all using (is_org_member(org_id));
create policy "agent_run_events_member" on public.agent_run_events for all using (is_org_member(org_id));

create index agent_runs_org_idx on public.agent_runs(org_id, created_at desc);
create index agent_runs_agent_idx on public.agent_runs(agent_id);
create index agent_runs_external_idx on public.agent_runs(external_agent_id);
create index agent_run_events_run_idx on public.agent_run_events(run_id, created_at);

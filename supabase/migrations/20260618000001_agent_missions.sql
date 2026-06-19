-- Missions for external agents: WHY an agent was deployed, WHAT its mission is,
-- and a back-channel for the remote VM to report progress/results to DeepLogic
-- central (authenticated by a per-agent callback_token, not a user session).
alter table public.external_agents
  add column if not exists mission              text not null default '',
  add column if not exists reason               text not null default '',
  add column if not exists deployed_via         text not null default 'ui'
       check (deployed_via in ('ui', 'chat')),
  add column if not exists mission_status       text not null default 'pending'
       check (mission_status in ('pending', 'in_progress', 'completed', 'failed')),
  add column if not exists result               jsonb,
  add column if not exists mission_started_at   timestamptz,
  add column if not exists mission_completed_at timestamptz,
  add column if not exists callback_token       text;

-- Timeline of everything an agent reports back — the VM -> central back-channel.
create table if not exists public.external_agent_events (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.external_agents (id) on delete cascade,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  kind        text not null default 'message'
              check (kind in ('deployed', 'provisioned', 'mission_started', 'progress', 'completed', 'failed', 'message')),
  message     text not null default '',
  data        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists external_agent_events_agent_idx on public.external_agent_events (agent_id, created_at);

alter table public.external_agent_events enable row level security;
create policy "external_agent_events_member" on public.external_agent_events for all
  using (is_org_member(org_id));

-- Agent run state: surface which agents are currently running. `last_run_at`
-- already exists; add a live status and the outcome of the last run.

alter table public.agents
  add column status text not null default 'idle' check (status in ('idle', 'running')),
  add column last_run_status text;

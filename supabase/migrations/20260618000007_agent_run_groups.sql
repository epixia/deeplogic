-- Group related agent runs (e.g. all the agents a single goal-orchestration
-- spun up) under one group so the Activity log can show them as one card.

alter table public.agent_runs
  add column group_id    uuid,
  add column group_label text;

create index agent_runs_group_idx on public.agent_runs(group_id);

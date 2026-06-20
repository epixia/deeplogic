-- Per-agent tool selection. `tools` is an array of tool names (e.g.
-- ["web_research","add_to_vault"]) an agent is allowed to call during a run.
-- NULL means "use the default safe set" — so existing agents keep their current
-- behavior with no migration of data.
alter table public.agents add column if not exists tools jsonb;

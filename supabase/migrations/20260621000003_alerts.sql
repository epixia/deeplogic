-- Extend the existing alerts system with structured trigger kinds (in addition
-- to the AI natural-language condition):
--   kind   'ai' | 'keyword' | 'uptime' | 'threshold'
--   config kind-specific JSON
--     keyword   { url, keywords: string[] }
--     uptime    { url }
--     threshold { url, path, op: 'gt'|'lt'|'eq', value }
--   state  evaluator bookkeeping for state-change detection
drop table if exists public.alert_rules;

alter table public.alerts add column if not exists kind   text  not null default 'ai';
alter table public.alerts add column if not exists config jsonb not null default '{}'::jsonb;
alter table public.alerts add column if not exists state  jsonb not null default '{}'::jsonb;
alter table public.alerts add column if not exists widget_id uuid;

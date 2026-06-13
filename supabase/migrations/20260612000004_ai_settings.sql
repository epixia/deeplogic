-- Per-workspace AI provider settings (BYOK) for DeepLogic Studio (PRD v3.2).
-- Stores the chosen provider (Claude / OpenAI / OpenRouter), model, and API key.
-- RLS is enabled with NO policies: the table is reachable ONLY via the service
-- role (server-side), so the API key is never exposed to client RLS queries.
-- The server gates reads/writes by org role in code and never returns the raw key.

create table if not exists public.org_ai_settings (
  org_id     uuid primary key references public.organizations (id) on delete cascade,
  provider   text not null check (provider in ('anthropic', 'openai', 'openrouter')) default 'anthropic',
  model      text not null default '',
  api_key    text not null default '',
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.org_ai_settings enable row level security;
-- Intentionally no policies: only the service-role client (server) can touch it.

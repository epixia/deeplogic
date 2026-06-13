-- Multi-provider BYOK keys (PRD v3.3): store a key+model for EACH provider, plus
-- which one is active. `provider` = active provider; `providers` = per-provider
-- secrets { anthropic:{apiKey,model}, openai:{...}, openrouter:{...} }. Service-role
-- only (RLS has no policies), so keys never reach the client.

alter table public.org_ai_settings
  add column if not exists providers jsonb not null default '{}'::jsonb;

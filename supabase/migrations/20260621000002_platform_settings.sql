-- Platform-wide settings managed by admins (e.g. the outbound mail/SMTP server).
-- Stored as key -> jsonb. RLS is enabled with NO policies, so ONLY the service
-- role (admin endpoints) can read or write — secrets never reach members.
create table if not exists public.platform_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;

-- Platform API providers per org — first-party data APIs the platform itself
-- calls server-side (e.g. DataForSEO for SERP / keyword / competitor data).
-- Unlike the Integrations catalog (which registers Data Vault connectors that
-- ground reports & agents), these power platform features directly. Credentials
-- live server-side via the service role and are never returned to the client
-- (only an { enabled, hasCreds } view is).
create table if not exists public.org_platform_apis (
  org_id      uuid not null references public.organizations (id) on delete cascade,
  provider    text not null,                         -- e.g. 'dataforseo'
  enabled     boolean not null default true,
  credentials jsonb not null default '{}'::jsonb,    -- provider-specific secret fields
  updated_at  timestamptz not null default now(),
  primary key (org_id, provider)
);

alter table public.org_platform_apis enable row level security;
create policy "org_platform_apis_member" on public.org_platform_apis for all
  using (is_org_member(org_id));

-- Cached DataForSEO "online intel" per org + domain. The Site Insights page
-- reads this cache (no external call) and only re-fetches from DataForSEO when
-- the user explicitly asks, so revisiting a competitor is instant and free.
create table if not exists public.org_domain_intel (
  org_id     uuid not null references public.organizations (id) on delete cascade,
  domain     text not null,                       -- bare registrable domain (no www / path)
  intel      jsonb not null,                      -- DomainIntel bundle (overview, keywords, competitors)
  fetched_at timestamptz not null default now(),
  primary key (org_id, domain)
);

alter table public.org_domain_intel enable row level security;
create policy "org_domain_intel_member" on public.org_domain_intel for all
  using (is_org_member(org_id));

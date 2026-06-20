-- Cached Site Insights per org + domain. Gathering insights runs an AI analysis
-- + web search, which is slow and costs tokens — so we cache the result and
-- serve it on every revisit. A fresh gather only runs on a cache miss or when
-- the user explicitly hits Refresh (?refresh=1).
create table if not exists public.org_site_insights (
  org_id     uuid not null references public.organizations (id) on delete cascade,
  domain     text not null,                       -- bare registrable domain (no www / path)
  data       jsonb not null,                      -- full SiteInsightData payload
  fetched_at timestamptz not null default now(),
  primary key (org_id, domain)
);

alter table public.org_site_insights enable row level security;
create policy "org_site_insights_member" on public.org_site_insights for all
  using (is_org_member(org_id));

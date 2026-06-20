-- Cached products scraped from a domain (used on the competitor detail page to
-- show the products a competitor sells, the same way we discover our own).
-- Cached per org + domain so revisiting is instant; re-fetch only on demand.
create table if not exists public.org_domain_products (
  org_id     uuid not null references public.organizations (id) on delete cascade,
  domain     text not null,
  products   jsonb not null,            -- ProductSuggestion[] (name, category, price, imageUrl, url, …)
  fetched_at timestamptz not null default now(),
  primary key (org_id, domain)
);

alter table public.org_domain_products enable row level security;
create policy "org_domain_products_member" on public.org_domain_products for all
  using (is_org_member(org_id));

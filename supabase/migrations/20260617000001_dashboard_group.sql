-- Group dashboards (e.g. "Company", "Competitors") for organized navigation.
alter table public.dashboards add column if not exists group_name text;
create index if not exists dashboards_org_group_idx on public.dashboards (org_id, group_name);

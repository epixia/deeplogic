-- Isolate reports by dashboard: optionally file a Studio report under a dashboard.
alter table public.studio_projects
  add column if not exists dashboard_id uuid references public.dashboards (id) on delete set null;
create index if not exists studio_projects_dashboard_idx on public.studio_projects (dashboard_id);

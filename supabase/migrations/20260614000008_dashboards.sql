-- Signal Dashboards: widget-based command centres fed by connectors, library, and reports.

-- ---------------------------------------------------------------------------
-- dashboards
-- ---------------------------------------------------------------------------
create table if not exists public.dashboards (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  slug        text not null,
  visibility  text not null check (visibility in ('private', 'org', 'published')) default 'private',
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists dashboards_org_idx on public.dashboards (org_id);
create unique index if not exists dashboards_org_slug_uidx on public.dashboards (org_id, slug);

alter table public.dashboards enable row level security;
create policy "dashboards_member" on public.dashboards for all
  using (is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- widgets — individual vibe-coded cells inside a dashboard
-- ---------------------------------------------------------------------------
create table if not exists public.widgets (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  dashboard_id   uuid not null references public.dashboards (id) on delete cascade,
  owner_id       uuid not null references auth.users (id) on delete cascade,
  name           text not null,
  -- type: kpi | chart | table | insight | alert | embed
  type           text not null default 'insight',
  -- AI-generated widget HTML (self-contained <div>)
  html           text,
  -- the vibe prompt used to generate it
  prompt         text,
  -- grid position (4-column grid, 1-2 row heights)
  grid_x         integer not null default 0,
  grid_y         integer not null default 0,
  grid_w         integer not null default 1 check (grid_w between 1 and 4),
  grid_h         integer not null default 1 check (grid_h between 1 and 2),
  -- data sources: [{type:'library'|'model', ref:string, name:string}]
  sources        jsonb not null default '[]'::jsonb,
  -- optional alert rule: {metric, operator, threshold, channel}
  alert_rule     jsonb,
  -- 'ok' | 'fired' | null
  alert_status   text,
  last_refreshed timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists widgets_dashboard_idx on public.widgets (dashboard_id);
create index if not exists widgets_org_idx on public.widgets (org_id);

alter table public.widgets enable row level security;
create policy "widgets_member" on public.widgets for all
  using (is_org_member(org_id));

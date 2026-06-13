-- DeepLogic multi-tenant schema (PRD v2).
-- Org -> members RBAC, RLS-isolated by org_id. Helpers are SECURITY DEFINER so
-- RLS policies on org_members don't recurse.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists org_members_user_idx on public.org_members (user_id);

create table if not exists public.models (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  name       text not null,
  source     text not null check (source in ('sample', 'upload')),
  data       jsonb not null,   -- full SemanticModel (connectors, dimensions, measures, kpis, dateRange)
  created_at timestamptz not null default now()
);
create index if not exists models_org_idx on public.models (org_id);

create table if not exists public.audit_entries (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  model_id   uuid not null references public.models (id) on delete cascade,
  ts         timestamptz not null default now(),
  actor      text not null check (actor in ('agent', 'user')),
  summary    text not null
);
create index if not exists audit_org_model_idx on public.audit_entries (org_id, model_id);

-- ---------------------------------------------------------------------------
-- RBAC helpers (SECURITY DEFINER -> bypass RLS, avoid policy recursion)
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = org and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(org uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = org and m.user_id = auth.uid() and m.role = any (roles)
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.org_members   enable row level security;
alter table public.models         enable row level security;
alter table public.audit_entries  enable row level security;

-- organizations: members can read; admins/owners can mutate.
-- (Initial create + owner membership is performed by the service role, which
--  bypasses RLS, so there is no bootstrap policy needed for INSERT.)
create policy org_select on public.organizations
  for select using (public.is_org_member(id));
create policy org_update on public.organizations
  for update using (public.has_org_role(id, array['owner', 'admin']));
create policy org_delete on public.organizations
  for delete using (public.has_org_role(id, array['owner']));

-- org_members: members can read the roster; admins/owners manage it.
create policy members_select on public.org_members
  for select using (public.is_org_member(org_id));
create policy members_insert on public.org_members
  for insert with check (public.has_org_role(org_id, array['owner', 'admin']));
create policy members_update on public.org_members
  for update using (public.has_org_role(org_id, array['owner', 'admin']));
create policy members_delete on public.org_members
  for delete using (public.has_org_role(org_id, array['owner', 'admin']));

-- models: any member can read/write models in their org.
create policy models_select on public.models
  for select using (public.is_org_member(org_id));
create policy models_insert on public.models
  for insert with check (public.is_org_member(org_id));
create policy models_update on public.models
  for update using (public.is_org_member(org_id));
create policy models_delete on public.models
  for delete using (public.is_org_member(org_id));

-- audit_entries: members read; members (or the agent, via API) insert.
create policy audit_select on public.audit_entries
  for select using (public.is_org_member(org_id));
create policy audit_insert on public.audit_entries
  for insert with check (public.is_org_member(org_id));

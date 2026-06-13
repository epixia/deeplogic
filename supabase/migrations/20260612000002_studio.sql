-- DeepLogic Studio (PRD v3): AI "vibecoding" report builder.
-- Per-user silos (studio_projects) + a shared Context Library (context_items),
-- org-isolated via RLS, reusing is_org_member / has_org_role.

-- ---------------------------------------------------------------------------
-- studio_projects — one report project (silo by default; shareable/publishable)
-- ---------------------------------------------------------------------------
create table if not exists public.studio_projects (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  slug       text not null,
  visibility text not null check (visibility in ('private', 'org', 'published')) default 'private',
  html       text not null default '',
  model_id   uuid references public.models (id) on delete set null,
  messages   jsonb not null default '[]'::jsonb,  -- [{role,content,ts}]
  versions   jsonb not null default '[]'::jsonb,  -- [{html,prompt,ts}] (cap 10)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists studio_projects_org_idx on public.studio_projects (org_id);
create index if not exists studio_projects_owner_idx on public.studio_projects (owner_id);
create unique index if not exists studio_projects_org_slug_uidx on public.studio_projects (org_id, slug);

-- ---------------------------------------------------------------------------
-- context_items — the Context Library (docs / html / mcp descriptors / notes)
-- ---------------------------------------------------------------------------
create table if not exists public.context_items (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  scope      text not null check (scope in ('user', 'org')) default 'user',
  kind       text not null check (kind in ('doc', 'html', 'mcp', 'note')),
  name       text not null,
  content    text not null default '',
  meta       jsonb not null default '{}'::jsonb,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists context_items_org_idx on public.context_items (org_id);
create index if not exists context_items_owner_idx on public.context_items (owner_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.studio_projects enable row level security;
alter table public.context_items   enable row level security;

-- studio_projects: owner sees their own; members see org/published; only the
-- owner edits; owner or org admin can delete.
create policy studio_select on public.studio_projects
  for select using (
    public.is_org_member(org_id)
    and (owner_id = auth.uid() or visibility in ('org', 'published'))
  );
create policy studio_insert on public.studio_projects
  for insert with check (public.is_org_member(org_id) and owner_id = auth.uid());
create policy studio_update on public.studio_projects
  for update using (owner_id = auth.uid());
create policy studio_delete on public.studio_projects
  for delete using (
    owner_id = auth.uid() or public.has_org_role(org_id, array['owner', 'admin'])
  );

-- context_items: members see org-scoped items + their own user-scoped items;
-- only the owner (or an org admin) edits/deletes.
create policy context_select on public.context_items
  for select using (
    public.is_org_member(org_id) and (scope = 'org' or owner_id = auth.uid())
  );
create policy context_insert on public.context_items
  for insert with check (public.is_org_member(org_id) and owner_id = auth.uid());
create policy context_update on public.context_items
  for update using (
    owner_id = auth.uid() or public.has_org_role(org_id, array['owner', 'admin'])
  );
create policy context_delete on public.context_items
  for delete using (
    owner_id = auth.uid() or public.has_org_role(org_id, array['owner', 'admin'])
  );

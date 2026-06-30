-- Innovation Garden — staff vibecode internal tools in isolated e2b sandboxes
-- (Build/Lab) and publish them to an org-only wall (Garden). The project's FILES
-- are the source of truth; the sandbox is rehydratable compute. Org-isolated via
-- RLS, reusing is_org_member / has_org_role.

create table if not exists public.innovation_projects (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  brief       text not null default '',
  engine      text not null default 'claude',          -- claude | gemini | codex
  files       jsonb not null default '{}'::jsonb,       -- { "path": "content" }
  entry_cmd   text not null default '',                 -- dev-server start command
  port        int  not null default 3000,
  sandbox_id  text,                                     -- last e2b sandbox (may be expired)
  preview_url text,
  status      text not null default 'draft'
              check (status in ('draft','building','running','hibernated','error')),
  messages    jsonb not null default '[]'::jsonb,       -- [{role,content,ts}]
  -- garden / publish
  published   boolean not null default false,
  featured    boolean not null default false,
  tagline     text not null default '',
  tags        text[] not null default '{}',
  stars       int  not null default 0,
  fork_of     uuid references public.innovation_projects (id) on delete set null,
  data_access text[] not null default '{}',             -- declared connectors / scopes
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists innovation_projects_org_idx       on public.innovation_projects (org_id);
create index if not exists innovation_projects_owner_idx     on public.innovation_projects (owner_id);
create index if not exists innovation_projects_published_idx on public.innovation_projects (org_id, published);

alter table public.innovation_projects enable row level security;

-- Owner sees their own builds; any member sees PUBLISHED garden tools.
create policy innovation_select on public.innovation_projects
  for select using (
    public.is_org_member(org_id) and (owner_id = auth.uid() or published)
  );
create policy innovation_insert on public.innovation_projects
  for insert with check (public.is_org_member(org_id) and owner_id = auth.uid());
-- Owner edits their project; org admins can moderate/feature.
create policy innovation_update on public.innovation_projects
  for update using (
    owner_id = auth.uid() or public.has_org_role(org_id, array['owner','admin'])
  );
create policy innovation_delete on public.innovation_projects
  for delete using (
    owner_id = auth.uid() or public.has_org_role(org_id, array['owner','admin'])
  );

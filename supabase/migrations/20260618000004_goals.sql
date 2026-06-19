-- Goals: a business objective decomposed into a plan (ordered steps) and the
-- agent team that delivers it. The plan/agents can be AI-drafted from the title.

create table public.goals (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id),
  title      text not null,
  plan       jsonb not null default '[]'::jsonb,  -- array of step strings
  agents     jsonb not null default '[]'::jsonb,  -- array of { name, role }
  status     text not null default 'active' check (status in ('active', 'done', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.goals enable row level security;

create policy "goals_member" on public.goals for all
  using (is_org_member(org_id));

create index goals_org_id_idx on public.goals(org_id);

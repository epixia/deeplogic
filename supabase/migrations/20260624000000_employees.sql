-- Employees roster — the company's people, imported from CSV / enrichment /
-- manual, and used to dispatch mass AI "mind dump" interviews. Org-isolated.

create table if not exists public.employees (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  name          text not null,
  email         text,
  phone         text,
  title         text,
  department    text,
  linkedin      text,
  source        text not null default 'manual',   -- manual | csv | linkedin | clay | lusha | hris
  notes         text,
  status        text not null default 'pending'
                check (status in ('pending','dispatched','interviewed')),
  last_interview_id   uuid,                        -- context_items.id of the captured note
  last_interviewed_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists employees_org_idx on public.employees (org_id);

alter table public.employees enable row level security;
create policy employees_member on public.employees
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

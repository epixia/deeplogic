-- Third-party integrations per org. First integration: Orgo.ai (virtual
-- computers / agent runtime). The API key is read server-side via the service
-- role and never returned to the client (only an enabled/hasKey view is).
create table if not exists public.org_integrations (
  org_id            uuid primary key references public.organizations (id) on delete cascade,
  orgo_enabled      boolean not null default false,
  orgo_api_key      text,
  orgo_workspace_id text,        -- cached Orgo workspace id reused for this org
  updated_at        timestamptz not null default now()
);

alter table public.org_integrations enable row level security;
create policy "org_integrations_member" on public.org_integrations for all
  using (is_org_member(org_id));

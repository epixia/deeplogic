-- Super-admin audit log: one row per admin action (plan overrides, member
-- removals, etc.). Written by the service role only; no RLS policies means
-- regular users (even via service role leaks) cannot read or write it without
-- an explicit GRANT, which we never issue.

create table if not exists public.admin_log (
  id          uuid        primary key default gen_random_uuid(),
  admin_email text        not null,
  action      text        not null,
  target_type text        not null check (target_type in ('org', 'user', 'subscription')),
  target_id   text        not null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists admin_log_created_idx on public.admin_log (created_at desc);
create index if not exists admin_log_target_idx  on public.admin_log (target_type, target_id);

alter table public.admin_log enable row level security;
-- No policies → only service role (bypasses RLS) can read/write.

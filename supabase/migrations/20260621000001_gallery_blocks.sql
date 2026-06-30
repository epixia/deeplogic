-- Admin-managed Block Gallery entries. These are platform-wide predefined Blocks
-- (like the hardcoded ones) that admins can generate from a docs URL and manage.
-- html_template is self-contained HTML with {{fieldKey}} placeholders substituted
-- from the block's config; fields describes the settings form.
create table if not exists public.gallery_blocks (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  icon         text not null default '📦',
  category     text not null default 'data',
  tagline      text not null default '',
  description  text not null default '',
  size_w       int  not null default 3,
  size_h       int  not null default 3,
  fields       jsonb not null default '[]'::jsonb,
  html_template text not null default '',
  docs_url     text,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Any authenticated member may read enabled blocks (they populate the gallery).
-- Writes are admin-only via the service role (which bypasses RLS).
alter table public.gallery_blocks enable row level security;

drop policy if exists gallery_blocks_read on public.gallery_blocks;
create policy gallery_blocks_read on public.gallery_blocks
  for select using (enabled = true);

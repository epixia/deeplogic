-- Unified Vault engine: turn context_items into a profile-first, embedding-
-- indexed context collection. Every item carries:
--   category  — coarse type used for filtering (mirrors / refines `kind`)
--   profile   — compact, AI-readable summary (CSV schema, site text, etc.)
--   tags      — auto-generated keyword tags for retrieval + filtering
--   embedding — vector of the profile text for similarity retrieval
--
-- Raw bytes continue to live in `content` / `meta`; the profile is what the
-- generators read and what we embed.

create extension if not exists vector;

alter table public.context_items
  add column if not exists category   text,
  add column if not exists profile    jsonb,
  add column if not exists tags       text[] not null default '{}',
  add column if not exists embedding  vector(1536);

-- Backfill category from the existing kind for pre-existing rows.
update public.context_items set category = kind where category is null;

-- Tag filtering.
create index if not exists context_items_tags_idx
  on public.context_items using gin (tags);

-- Approximate-nearest-neighbour search over profile embeddings (cosine).
-- HNSW handles nulls (unembedded rows) gracefully by skipping them.
create index if not exists context_items_embedding_idx
  on public.context_items using hnsw (embedding vector_cosine_ops);

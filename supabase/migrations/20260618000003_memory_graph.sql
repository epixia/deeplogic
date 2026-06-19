-- Native memory graph: a bi-temporal knowledge graph over the workspace.
-- Inspired by Graphiti (temporal facts with validity windows) and Cognee
-- (auto-extracted entities + relationships), implemented on our existing
-- pgvector stack — no external graph DB or Python service.
--
--   episodes  = raw ingested units (a vault note, a chat answer, a URL)
--   entities  = people / companies / products / concepts (graph nodes)
--   facts     = typed relationships between entities (graph edges), each with
--               a validity window so superseded knowledge is RETAINED, not lost.

create table if not exists public.memory_entities (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  normalized_name text not null,                 -- lowercased/trimmed, for dedupe
  type            text not null default 'concept',-- person|company|product|place|concept|event|metric
  summary         text not null default '',
  aliases         text[] not null default '{}',
  embedding       vector(1536),
  mention_count   int not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, normalized_name)
);
create index if not exists memory_entities_org_idx on public.memory_entities (org_id);

create table if not exists public.memory_episodes (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  source_kind  text not null default 'vault',    -- vault|chat|agent|url|manual
  source_ref   text,                              -- e.g. context_items.id
  content      text not null default '',
  entity_count int not null default 0,
  fact_count   int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists memory_episodes_org_idx on public.memory_episodes (org_id, created_at);

create table if not exists public.memory_facts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  subject_id  uuid not null references public.memory_entities (id) on delete cascade,
  predicate   text not null,                      -- e.g. "is CEO of", "competes with"
  object_id   uuid references public.memory_entities (id) on delete cascade,
  object_text text,                               -- literal object when not an entity
  statement   text not null,                      -- full natural-language fact
  embedding   vector(1536),
  episode_id  uuid references public.memory_episodes (id) on delete set null,
  source_kind text not null default 'vault',
  source_ref  text,
  valid_from  timestamptz not null default now(), -- when true in the world
  valid_to    timestamptz,                        -- when superseded (null = still true)
  invalid_at  timestamptz,                        -- when explicitly contradicted
  created_at  timestamptz not null default now()  -- when we learned it
);
create index if not exists memory_facts_org_idx on public.memory_facts (org_id);
create index if not exists memory_facts_subject_idx on public.memory_facts (subject_id);
create index if not exists memory_facts_sp_idx on public.memory_facts (subject_id, predicate);

alter table public.memory_entities enable row level security;
alter table public.memory_episodes enable row level security;
alter table public.memory_facts    enable row level security;
create policy "memory_entities_member" on public.memory_entities for all using (is_org_member(org_id));
create policy "memory_episodes_member" on public.memory_episodes for all using (is_org_member(org_id));
create policy "memory_facts_member"    on public.memory_facts    for all using (is_org_member(org_id));

-- Vector recall over currently-valid facts. SECURITY INVOKER so RLS applies.
create or replace function public.match_memory_facts(
  p_org_id        uuid,
  p_embedding     vector(1536),
  p_count         int default 12,
  p_include_stale boolean default false
)
returns table (
  id           uuid,
  statement    text,
  predicate    text,
  subject_id   uuid,
  object_id    uuid,
  valid_from   timestamptz,
  valid_to     timestamptz,
  invalid_at   timestamptz,
  similarity   float
)
language sql
stable
as $$
  select
    f.id, f.statement, f.predicate, f.subject_id, f.object_id,
    f.valid_from, f.valid_to, f.invalid_at,
    1 - (f.embedding <=> p_embedding) as similarity
  from public.memory_facts f
  where f.org_id = p_org_id
    and f.embedding is not null
    and (p_include_stale or (f.valid_to is null and f.invalid_at is null))
  order by f.embedding <=> p_embedding
  limit greatest(1, least(p_count, 50));
$$;

-- Vector recall over entities.
create or replace function public.match_memory_entities(
  p_org_id    uuid,
  p_embedding vector(1536),
  p_count     int default 8
)
returns table (id uuid, name text, type text, summary text, similarity float)
language sql
stable
as $$
  select e.id, e.name, e.type, e.summary, 1 - (e.embedding <=> p_embedding) as similarity
  from public.memory_entities e
  where e.org_id = p_org_id and e.embedding is not null
  order by e.embedding <=> p_embedding
  limit greatest(1, least(p_count, 50));
$$;

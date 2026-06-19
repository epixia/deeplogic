-- Vector similarity search over context_items profile embeddings.
-- SECURITY INVOKER (default) so RLS on context_items still applies: callers
-- only ever match items they're allowed to see.

create or replace function public.match_context_items(
  p_org_id   uuid,
  p_embedding vector(1536),
  p_count    int default 8
)
returns table (
  id         uuid,
  name       text,
  kind       text,
  category   text,
  content    text,
  profile    jsonb,
  tags       text[],
  similarity float
)
language sql
stable
as $$
  select
    ci.id, ci.name, ci.kind, ci.category, ci.content, ci.profile, ci.tags,
    1 - (ci.embedding <=> p_embedding) as similarity
  from public.context_items ci
  where ci.org_id = p_org_id
    and ci.enabled
    and ci.embedding is not null
  order by ci.embedding <=> p_embedding
  limit greatest(1, least(p_count, 50));
$$;

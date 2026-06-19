// Profile embeddings + similarity retrieval for the unified Vault.
//
// Embeddings use OpenAI's text-embedding-3-small (1536 dims) when an OpenAI key
// is available (workspace BYOK or OPENAI_API_KEY env). Without one, retrieval
// degrades gracefully to keyword / tag overlap — nothing breaks.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiConfig } from './generator.js';
import type { ContextItem } from '../types.js';

export const EMBED_MODEL = 'text-embedding-3-small';
export const EMBED_DIM = 1536;

/** The text we embed for an item: name + tags + profile + a content excerpt. */
export function profileText(parts: {
  name: string;
  tags?: string[];
  profile?: Record<string, unknown> | null;
  content?: string;
}): string {
  return [
    parts.name,
    (parts.tags ?? []).join(' '),
    parts.profile ? JSON.stringify(parts.profile) : '',
    (parts.content ?? '').slice(0, 2000),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 8000);
}

/** An OpenAI key for embeddings, if one is reachable. Anthropic has no embeddings API. */
export function resolveEmbeddingKey(ai: AiConfig | null): string | null {
  if (ai?.provider === 'openai' && ai.apiKey?.trim()) return ai.apiKey.trim();
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  return null;
}

/** Embed a string. Returns null on any failure (caller falls back to keywords). */
export async function embedText(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000) }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { embedding?: number[] }[] };
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

/** pgvector wants a bracketed literal, not a JSON array, on insert. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

interface MatchRow {
  id: string;
  name: string;
  kind: string;
  category: string | null;
  content: string | null;
  profile: Record<string, unknown> | null;
  tags: string[] | null;
  similarity: number;
}

function toContextItem(r: { id: string; kind: string; name: string; content: string | null }): ContextItem {
  return {
    id: r.id,
    scope: 'org',
    kind: r.kind as ContextItem['kind'],
    name: r.name,
    content: r.content ?? '',
    meta: {},
    enabled: true,
    isOwner: false,
  };
}

/**
 * Return the top-K context items most relevant to `query` for this org.
 * Vector search via the match_context_items RPC when embeddings are available,
 * else a keyword/tag overlap score over all enabled items.
 */
export async function retrieveRelevant(
  db: SupabaseClient,
  orgId: string,
  query: string,
  k: number,
  embedKey: string | null
): Promise<ContextItem[]> {
  if (embedKey) {
    const emb = await embedText(query, embedKey);
    if (emb) {
      const { data, error } = await db.rpc('match_context_items', {
        p_org_id: orgId,
        p_embedding: toVectorLiteral(emb),
        p_count: k,
      });
      if (!error && Array.isArray(data) && data.length) {
        return (data as MatchRow[]).map(toContextItem);
      }
    }
  }

  // Keyword / tag fallback.
  const { data } = await db
    .from('context_items')
    .select('id, kind, name, content, tags, profile')
    .eq('org_id', orgId)
    .eq('enabled', true);
  const rows = (data ?? []) as {
    id: string; kind: string; name: string; content: string | null; tags: string[] | null; profile: Record<string, unknown> | null;
  }[];
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  const scored = rows
    .map((r) => {
      const hay = `${r.name} ${(r.tags ?? []).join(' ')} ${JSON.stringify(r.profile ?? {})}`.toLowerCase();
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { r, score };
    })
    .sort((a, b) => b.score - a.score);
  // If nothing matched any term, keep all (don't starve the generator).
  const top = scored.some((s) => s.score > 0) ? scored.filter((s) => s.score > 0) : scored;
  return top.slice(0, k).map((s) => toContextItem(s.r));
}

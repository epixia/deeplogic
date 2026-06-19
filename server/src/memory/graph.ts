// Native memory graph engine — turns workspace text (vault notes, chat answers,
// URLs) into a bi-temporal knowledge graph using the LLM + pgvector we already
// run. No external graph DB, no Python service.
//
//   ingestEpisode  — extract entities + facts from text, resolve/dedupe entities,
//                    supersede contradicted facts (temporal), store with embeddings
//   recallMemory   — semantic recall over currently-valid facts (for the assistant)
//   getMemoryGraph — entities + valid facts for the Memory page graph

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiConfig } from '../studio/generator.js';
import { embedText, toVectorLiteral } from '../studio/embeddings.js';

const ENTITY_TYPES = ['person', 'company', 'product', 'place', 'concept', 'event', 'metric'] as const;

export function normalizeName(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 200);
}

interface ExtractedEntity { name: string; type: string; summary?: string }
interface ExtractedFact { subject: string; predicate: string; object: string; statement: string }
interface Extraction { entities: ExtractedEntity[]; facts: ExtractedFact[] }

const DEFAULT_MODEL: Record<string, string> = {
  anthropic: 'claude-opus-4-8', openai: 'gpt-4o', openrouter: 'openai/gpt-4o',
};

// One LLM call that returns strict JSON. Anthropic uses the messages API; OpenAI
// and OpenRouter use chat/completions with JSON response format.
async function callJson(ai: AiConfig, system: string, user: string): Promise<string> {
  if (ai.provider === 'anthropic') {
    const mod = await import('@anthropic-ai/sdk');
    const client = new mod.default({ apiKey: ai.apiKey });
    const res = await client.messages.create({
      model: ai.model || DEFAULT_MODEL.anthropic,
      max_tokens: 4000, system,
      messages: [{ role: 'user', content: user }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (res.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  }
  const base = ai.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({
      model: ai.model || DEFAULT_MODEL[ai.provider], max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`extract ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

function parseExtraction(raw: string): Extraction {
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const json = start >= 0 ? cleaned.slice(start, cleaned.lastIndexOf('}') + 1) : cleaned;
  try {
    const o = JSON.parse(json) as Partial<Extraction>;
    const entities = Array.isArray(o.entities) ? o.entities.filter((e) => e && e.name) : [];
    const facts = Array.isArray(o.facts) ? o.facts.filter((f) => f && f.subject && f.predicate) : [];
    return { entities, facts };
  } catch {
    return { entities: [], facts: [] };
  }
}

export async function extractKnowledge(ai: AiConfig, title: string, text: string): Promise<Extraction> {
  const system = [
    'You extract a knowledge graph from business text. Return ONLY JSON.',
    'Identify ENTITIES (real, named things) and FACTS (relationships between them).',
    `Entity types: ${ENTITY_TYPES.join(', ')}.`,
    'Schema: {"entities":[{"name","type","summary"}],"facts":[{"subject","predicate","object","statement"}]}.',
    '- "subject" and "object" must match an entity "name" where possible (object may be a literal value like a year or amount).',
    '- "predicate" is a short verb phrase (e.g. "is CEO of", "competes with", "headquartered in", "raised").',
    '- "statement" is the full fact as a sentence.',
    'Be precise; do not invent facts not supported by the text. Skip generic/common nouns.',
  ].join('\n');
  const user = `TITLE: ${title}\n\nTEXT:\n${text.slice(0, 12_000)}`;
  try {
    return parseExtraction(await callJson(ai, system, user));
  } catch {
    return { entities: [], facts: [] };
  }
}

interface EntityRow { id: string; type: string }

// Find an existing entity (by normalized name, then by embedding similarity) or
// create one. Bumps mention_count on reuse.
async function resolveEntity(
  db: SupabaseClient, orgId: string, ent: ExtractedEntity, embedKey: string | null,
): Promise<string | null> {
  const normalized = normalizeName(ent.name);
  if (!normalized) return null;
  const type = (ENTITY_TYPES as readonly string[]).includes(ent.type) ? ent.type : 'concept';

  const { data: exact } = await db.from('memory_entities')
    .select('id, type, mention_count').eq('org_id', orgId).eq('normalized_name', normalized).maybeSingle();
  if (exact) {
    const row = exact as EntityRow & { mention_count: number };
    await db.from('memory_entities')
      .update({ mention_count: (row.mention_count ?? 1) + 1, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    return row.id;
  }

  let embedding: number[] | null = null;
  if (embedKey) {
    embedding = await embedText(`${ent.name}\n${ent.summary ?? ''}`, embedKey);
    if (embedding) {
      const { data: near } = await db.rpc('match_memory_entities', {
        p_org_id: orgId, p_embedding: toVectorLiteral(embedding), p_count: 1,
      });
      const top = Array.isArray(near) ? (near[0] as { id: string; similarity: number } | undefined) : undefined;
      if (top && top.similarity > 0.9) return top.id;
    }
  }

  const { data: created, error } = await db.from('memory_entities').insert({
    org_id: orgId, name: ent.name.slice(0, 200), normalized_name: normalized, type,
    summary: (ent.summary ?? '').slice(0, 1000),
    embedding: embedding ? toVectorLiteral(embedding) : null,
  }).select('id').single();
  if (error) return null;
  return (created as { id: string }).id;
}

export interface IngestResult { episodeId: string | null; entities: number; facts: number; superseded: number }

export async function ingestEpisode(
  db: SupabaseClient, orgId: string,
  params: { sourceKind: string; sourceRef?: string; title: string; text: string },
  ai: AiConfig | null, embedKey: string | null,
): Promise<IngestResult> {
  const text = (params.text ?? '').trim();
  if (!text) return { episodeId: null, entities: 0, facts: 0, superseded: 0 };

  const { data: epi } = await db.from('memory_episodes').insert({
    org_id: orgId, source_kind: params.sourceKind, source_ref: params.sourceRef ?? null,
    content: text.slice(0, 4000),
  }).select('id').single();
  const episodeId = (epi as { id: string } | null)?.id ?? null;

  if (!ai) return { episodeId, entities: 0, facts: 0, superseded: 0 };

  const extraction = await extractKnowledge(ai, params.title, text);
  // Resolve every entity to an id (by normalized name).
  const idByNorm = new Map<string, string>();
  for (const ent of extraction.entities) {
    const id = await resolveEntity(db, orgId, ent, embedKey);
    if (id) idByNorm.set(normalizeName(ent.name), id);
  }

  let facts = 0, superseded = 0;
  const now = new Date().toISOString();
  for (const f of extraction.facts) {
    const subjId = idByNorm.get(normalizeName(f.subject))
      ?? await resolveEntity(db, orgId, { name: f.subject, type: 'concept' }, embedKey);
    if (!subjId) continue;
    const objId = idByNorm.get(normalizeName(f.object)) ?? null;
    const objText = objId ? null : (f.object ?? '').slice(0, 400) || null;
    const predicate = f.predicate.trim().slice(0, 120);

    // Temporal supersession: invalidate prior valid facts with the same
    // subject+predicate but a DIFFERENT object (knowledge changed over time).
    const { data: priors } = await db.from('memory_facts')
      .select('id, object_id, object_text')
      .eq('org_id', orgId).eq('subject_id', subjId).eq('predicate', predicate)
      .is('valid_to', null).is('invalid_at', null);
    let duplicate = false;
    for (const p of (priors ?? []) as { id: string; object_id: string | null; object_text: string | null }[]) {
      const sameObj = (objId && p.object_id === objId) || (!objId && p.object_text === objText);
      if (sameObj) { duplicate = true; continue; }
      await db.from('memory_facts').update({ valid_to: now, invalid_at: now }).eq('id', p.id);
      superseded++;
    }
    if (duplicate) continue;

    const statement = (f.statement || `${f.subject} ${predicate} ${f.object}`).slice(0, 600);
    const emb = embedKey ? await embedText(statement, embedKey) : null;
    const { error } = await db.from('memory_facts').insert({
      org_id: orgId, subject_id: subjId, predicate, object_id: objId, object_text: objText,
      statement, embedding: emb ? toVectorLiteral(emb) : null,
      episode_id: episodeId, source_kind: params.sourceKind, source_ref: params.sourceRef ?? null,
    });
    if (!error) facts++;
  }

  if (episodeId) {
    await db.from('memory_episodes').update({ entity_count: idByNorm.size, fact_count: facts }).eq('id', episodeId);
  }
  return { episodeId, entities: idByNorm.size, facts, superseded };
}

// Semantic recall over currently-valid facts — for grounding the assistant/agents.
export async function recallMemory(
  db: SupabaseClient, orgId: string, query: string, k: number, embedKey: string | null,
  opts?: { includeStale?: boolean },
): Promise<{ statement: string; predicate: string; validFrom: string; validTo: string | null }[]> {
  const includeStale = opts?.includeStale ?? false;
  // Preferred path: pgvector semantic recall (needs OpenAI embeddings).
  if (embedKey) {
    const emb = await embedText(query, embedKey);
    if (emb) {
      const { data, error } = await db.rpc('match_memory_facts', {
        p_org_id: orgId, p_embedding: toVectorLiteral(emb), p_count: k, p_include_stale: includeStale,
      });
      if (!error && Array.isArray(data) && data.length) {
        return (data as { statement: string; predicate: string; valid_from: string; valid_to: string | null }[])
          .map((r) => ({ statement: r.statement, predicate: r.predicate, validFrom: r.valid_from, validTo: r.valid_to }));
      }
    }
  }
  // Fallback: keyword overlap over currently-valid fact statements (no embeddings).
  let q = db.from('memory_facts').select('statement, predicate, valid_from, valid_to').eq('org_id', orgId);
  if (!includeStale) q = q.is('valid_to', null).is('invalid_at', null);
  const { data } = await q.limit(1000);
  const rows = (data ?? []) as { statement: string; predicate: string; valid_from: string; valid_to: string | null }[];
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  const scored = rows
    .map((r) => ({ r, score: terms.reduce((s, t) => s + (r.statement.toLowerCase().includes(t) ? 1 : 0), 0) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return scored.map((s) => ({ statement: s.r.statement, predicate: s.r.predicate, validFrom: s.r.valid_from, validTo: s.r.valid_to }));
}

export interface MemoryGraph {
  entities: { id: string; name: string; type: string; summary: string }[];
  facts: { id: string; subjectId: string; objectId: string | null; objectText: string | null; predicate: string; statement: string; validTo: string | null }[];
}

// Entities + facts for the Memory page graph. includeStale shows superseded
// (greyed) edges too, for a temporal view.
export async function getMemoryGraph(db: SupabaseClient, orgId: string, includeStale = false): Promise<MemoryGraph> {
  const { data: ents } = await db.from('memory_entities')
    .select('id, name, type, summary').eq('org_id', orgId).order('mention_count', { ascending: false }).limit(500);
  let q = db.from('memory_facts')
    .select('id, subject_id, object_id, object_text, predicate, statement, valid_to').eq('org_id', orgId);
  if (!includeStale) q = q.is('valid_to', null).is('invalid_at', null);
  const { data: fs } = await q.limit(2000);
  return {
    entities: ((ents ?? []) as { id: string; name: string; type: string; summary: string }[]),
    facts: ((fs ?? []) as { id: string; subject_id: string; object_id: string | null; object_text: string | null; predicate: string; statement: string; valid_to: string | null }[])
      .map((f) => ({ id: f.id, subjectId: f.subject_id, objectId: f.object_id, objectText: f.object_text, predicate: f.predicate, statement: f.statement, validTo: f.valid_to })),
  };
}

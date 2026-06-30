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

const uniq = (a: string[]): string[] => [...new Set(a.filter(Boolean))];

// A looser key than normalizeName: drops corporate suffixes + punctuation so
// "Acme Inc." / "Acme Corporation" / "Acme" collapse to "acme". Stored as an
// alias so name variants resolve to one entity even without embeddings.
const CORP_SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|llc|llp|lp|ltd|limited|plc|gmbh|s\.?a|ag|nv|bv|group|holdings?|technologies|technology|labs?|software|systems|solutions)\b/g;
function canonicalKey(s: string): string {
  const k = normalizeName(s).replace(/[.,'"()]/g, '').replace(CORP_SUFFIX, '').replace(/\s+/g, ' ').trim();
  return k || normalizeName(s);
}

// Canonical predicate: strip copulas/articles/aux verbs, then map common business
// synonyms to one form so "is CEO of" / "serves as CEO of" / "heads" all unify.
const PRED_SYNONYMS: Record<string, string> = {
  'ceo of': 'leads', 'cto of': 'leads', 'cfo of': 'leads', 'head of': 'leads', 'president of': 'leads',
  'leads': 'leads', 'runs': 'leads', 'heads': 'leads', 'manages': 'leads', 'director of': 'leads',
  'competes with': 'competes with', 'competitor of': 'competes with', 'rival of': 'competes with', 'rivals': 'competes with',
  'based in': 'based in', 'headquartered in': 'based in', 'located in': 'based in', 'hq in': 'based in',
  'acquired': 'acquired', 'bought': 'acquired', 'purchased': 'acquired',
  'founded': 'founded', 'established': 'founded', 'cofounded': 'founded', 'co-founded': 'founded',
  'raised': 'raised', 'secured': 'raised',
  'partners with': 'partners with', 'partnered with': 'partners with', 'partnership with': 'partners with',
  'owns': 'owns', 'owner of': 'owns', 'parent of': 'owns',
  'subsidiary of': 'subsidiary of', 'part of': 'subsidiary of', 'owned by': 'subsidiary of',
};
function canonPredicate(p: string): string {
  const s = p.toLowerCase().trim()
    .replace(/[.,;:]+$/, '')
    .replace(/\b(is|are|was|were|be|being|been|has|have|had|having|the|a|an|currently|now|serves?|served|works?|worked|as)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return PRED_SYNONYMS[s] ?? s;
}

// Predicates that hold ONE object at a time → a new object supersedes the old.
// Everything else is multi-valued (a company competes with / partners with / owns
// MANY things), so a different object is an ADDITION, never a contradiction.
const SINGLE_VALUED = new Set(['leads', 'based in', 'subsidiary of']);
const canonObject = (t: string | null): string => (t ?? '').toLowerCase().replace(/[.,'"]/g, '').trim();

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

// Bump mention_count and (optionally) fold name variants into the entity's
// aliases, so future lookups resolve the same node without re-embedding.
async function reuseEntity(db: SupabaseClient, id: string, addAliases: string[] = []): Promise<string> {
  const { data } = await db.from('memory_entities')
    .select('aliases, mention_count').eq('id', id).maybeSingle();
  const row = data as { aliases: string[] | null; mention_count: number } | null;
  // Keep all variant keys (incl. ones equal to the normalized name) — a canonical
  // key that matches the normalized name is exactly what later suffix-variants hit.
  const aliases = uniq([...(row?.aliases ?? []), ...addAliases]);
  const patch: Record<string, unknown> = {
    mention_count: (row?.mention_count ?? 1) + 1,
    updated_at: new Date().toISOString(),
  };
  if (aliases.length !== (row?.aliases ?? []).length) patch.aliases = aliases;
  await db.from('memory_entities').update(patch).eq('id', id);
  return id;
}

// Resolve an extracted entity to a graph node, fighting fragmentation in layers:
//   1) exact normalized name           2) alias / canonical-key overlap (same type)
//   3) embedding similarity (type-aware threshold; records the variant as an alias)
//   4) otherwise create — seeded with its canonical key as an alias.
async function resolveEntity(
  db: SupabaseClient, orgId: string, ent: ExtractedEntity, embedKey: string | null,
): Promise<string | null> {
  const normalized = normalizeName(ent.name);
  if (!normalized) return null;
  const canonical = canonicalKey(ent.name);
  const type = (ENTITY_TYPES as readonly string[]).includes(ent.type) ? ent.type : 'concept';

  // 1) exact normalized name (any type — an exact string match is authoritative).
  //    Seed the canonical key into aliases so suffix-variants resolve here later
  //    (self-heals entities created before alias matching existed).
  const { data: exact } = await db.from('memory_entities')
    .select('id').eq('org_id', orgId).eq('normalized_name', normalized).maybeSingle();
  if (exact) return reuseEntity(db, (exact as { id: string }).id, [canonical]);

  // 2) alias / canonical-key overlap — same type only, to avoid merging e.g.
  //    the company "Apple" with the concept "apple".
  const { data: aliasHit } = await db.from('memory_entities')
    .select('id').eq('org_id', orgId).eq('type', type)
    .overlaps('aliases', uniq([normalized, canonical])).limit(1).maybeSingle();
  if (aliasHit) return reuseEntity(db, (aliasHit as { id: string }).id, [normalized, canonical]);

  // 3) embedding similarity — accept a high match outright, or a slightly looser
  //    match when the entity types agree.
  let embedding: number[] | null = null;
  if (embedKey) {
    embedding = await embedText(`${ent.name}\n${ent.summary ?? ''}`, embedKey);
    if (embedding) {
      const { data: near } = await db.rpc('match_memory_entities', {
        p_org_id: orgId, p_embedding: toVectorLiteral(embedding), p_count: 3,
      });
      const rows = (near ?? []) as { id: string; type: string; similarity: number }[];
      const hit = rows.find((r) => r.similarity > 0.9 || (r.similarity > 0.84 && r.type === type));
      if (hit) return reuseEntity(db, hit.id, [normalized, canonical]);
    }
  }

  // 4) create — seed aliases with the canonical key so suffix variants resolve here next time.
  const { data: created, error } = await db.from('memory_entities').insert({
    org_id: orgId, name: ent.name.slice(0, 200), normalized_name: normalized, type,
    summary: (ent.summary ?? '').slice(0, 1000),
    aliases: uniq([canonical]),
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
    const canonPred = canonPredicate(predicate);

    // Temporal supersession, predicate-aware: compare against ALL of the subject's
    // valid facts by CANONICAL predicate (so "is CEO of" == "serves as CEO of").
    //  - same object  → duplicate, skip.
    //  - different object on a SINGLE-VALUED predicate (role, location, parent)
    //    → the world changed: supersede the old fact.
    //  - different object on a multi-valued predicate (competes with, owns, …)
    //    → an addition; keep both.
    const { data: priors } = await db.from('memory_facts')
      .select('id, predicate, object_id, object_text')
      .eq('org_id', orgId).eq('subject_id', subjId)
      .is('valid_to', null).is('invalid_at', null);
    let duplicate = false;
    for (const p of (priors ?? []) as { id: string; predicate: string; object_id: string | null; object_text: string | null }[]) {
      if (canonPredicate(p.predicate) !== canonPred) continue;
      const sameObj = (objId && p.object_id === objId) || (!objId && canonObject(p.object_text) === canonObject(objText));
      if (sameObj) { duplicate = true; continue; }
      if (!SINGLE_VALUED.has(canonPred)) continue; // multi-valued: coexist
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

interface FactRow {
  id: string; statement: string; predicate: string;
  subject_id: string | null; object_id: string | null;
  valid_from: string; valid_to: string | null;
}
const FACT_COLS = 'id, statement, predicate, subject_id, object_id, valid_from, valid_to';

// Graph-aware recall (GraphRAG): instead of returning a flat list of facts that
// each look like the query, we (1) SEED with the most relevant facts AND entities,
// then (2) EXPAND one hop along the graph to pull in the connected neighborhood,
// then (3) assemble a subgraph that leads with relevance. The assistant gets
// facts that hang together (an entity + what it's connected to), not isolated hits.
export async function recallMemory(
  db: SupabaseClient, orgId: string, query: string, k: number, embedKey: string | null,
  opts?: { includeStale?: boolean },
): Promise<{ statement: string; predicate: string; validFrom: string; validTo: string | null }[]> {
  const includeStale = opts?.includeStale ?? false;

  // ---- 1) Seed: semantically relevant facts + entities -------------------
  let seedFacts: FactRow[] = [];
  const seedEntityIds = new Set<string>();

  if (embedKey) {
    const emb = await embedText(query, embedKey);
    if (emb) {
      const vec = toVectorLiteral(emb);
      const { data: fData } = await db.rpc('match_memory_facts', {
        p_org_id: orgId, p_embedding: vec, p_count: Math.max(k, 8), p_include_stale: includeStale,
      });
      seedFacts = ((fData ?? []) as FactRow[]).map((r) => ({
        id: r.id, statement: r.statement, predicate: r.predicate,
        subject_id: r.subject_id, object_id: r.object_id, valid_from: r.valid_from, valid_to: r.valid_to,
      }));
      // Entity seeds catch "tell me about <entity>" where no single fact text matches.
      const { data: eData } = await db.rpc('match_memory_entities', {
        p_org_id: orgId, p_embedding: vec, p_count: 5,
      });
      for (const e of (eData ?? []) as { id: string; similarity: number }[]) {
        if (e.similarity > 0.35) seedEntityIds.add(e.id);
      }
    }
  }

  // Keyword fallback (no embeddings, or the vector seed came back empty).
  if (seedFacts.length === 0) {
    let fq = db.from('memory_facts').select(FACT_COLS).eq('org_id', orgId);
    if (!includeStale) fq = fq.is('valid_to', null).is('invalid_at', null);
    const { data } = await fq.limit(1000);
    const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
    seedFacts = ((data ?? []) as FactRow[])
      .map((r) => ({ r, score: terms.reduce((s, t) => s + (r.statement.toLowerCase().includes(t) ? 1 : 0), 0) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(k, 8))
      .map((s) => s.r);
  }

  // Top seed facts contribute their endpoints as expansion roots.
  for (const f of seedFacts.slice(0, 6)) {
    if (f.subject_id) seedEntityIds.add(f.subject_id);
    if (f.object_id) seedEntityIds.add(f.object_id);
  }

  // ---- 2) Expand one hop: facts touching any seed entity -----------------
  const seedFactIds = new Set(seedFacts.map((f) => f.id));
  let neighborhood: FactRow[] = [];
  const ids = [...seedEntityIds].slice(0, 12);
  if (ids.length) {
    const list = ids.join(',');
    let nq = db.from('memory_facts').select(FACT_COLS).eq('org_id', orgId)
      .or(`subject_id.in.(${list}),object_id.in.(${list})`);
    if (!includeStale) nq = nq.is('valid_to', null).is('invalid_at', null);
    const { data } = await nq.limit(80);
    const inSeed = (id: string | null) => !!id && seedEntityIds.has(id);
    neighborhood = ((data ?? []) as FactRow[])
      .filter((f) => !seedFactIds.has(f.id))
      .sort((a, b) => {
        // Bridges between two seed entities first; then most recent.
        const sb = (inSeed(b.subject_id) ? 1 : 0) + (inSeed(b.object_id) ? 1 : 0);
        const sa = (inSeed(a.subject_id) ? 1 : 0) + (inSeed(a.object_id) ? 1 : 0);
        return sb !== sa ? sb - sa : (b.valid_from ?? '').localeCompare(a.valid_from ?? '');
      });
  }

  // ---- 3) Assemble a connected subgraph, leading with relevance ----------
  const lead = Math.min(seedFacts.length, Math.max(2, Math.ceil(k * 0.6)));
  const chosen: FactRow[] = [];
  const seen = new Set<string>();
  const push = (f: FactRow) => { if (!seen.has(f.id)) { seen.add(f.id); chosen.push(f); } };
  seedFacts.slice(0, lead).forEach(push);
  for (const f of neighborhood) { if (chosen.length >= k) break; push(f); }
  for (const f of seedFacts) { if (chosen.length >= k) break; push(f); } // fill any leftover slots
  return chosen.slice(0, k).map((f) => ({
    statement: f.statement, predicate: f.predicate, validFrom: f.valid_from, validTo: f.valid_to,
  }));
}

export interface MemoryGraph {
  entities: { id: string; name: string; type: string; summary: string; mentionCount: number }[];
  facts: { id: string; subjectId: string; objectId: string | null; objectText: string | null; predicate: string; statement: string; validTo: string | null }[];
}

// Entities + facts for the Memory page graph. includeStale shows superseded
// (greyed) edges too, for a temporal view.
export async function getMemoryGraph(db: SupabaseClient, orgId: string, includeStale = false): Promise<MemoryGraph> {
  const { data: ents } = await db.from('memory_entities')
    .select('id, name, type, summary, mention_count').eq('org_id', orgId).order('mention_count', { ascending: false }).limit(500);
  let q = db.from('memory_facts')
    .select('id, subject_id, object_id, object_text, predicate, statement, valid_to').eq('org_id', orgId);
  if (!includeStale) q = q.is('valid_to', null).is('invalid_at', null);
  const { data: fs } = await q.limit(2000);
  return {
    entities: ((ents ?? []) as { id: string; name: string; type: string; summary: string; mention_count: number }[])
      .map((e) => ({ id: e.id, name: e.name, type: e.type, summary: e.summary, mentionCount: e.mention_count ?? 1 })),
    facts: ((fs ?? []) as { id: string; subject_id: string; object_id: string | null; object_text: string | null; predicate: string; statement: string; valid_to: string | null }[])
      .map((f) => ({ id: f.id, subjectId: f.subject_id, objectId: f.object_id, objectText: f.object_text, predicate: f.predicate, statement: f.statement, validTo: f.valid_to })),
  };
}

// ---------------------------------------------------------------------------
// Curation — manual fixes for the Memory page: merge duplicate entities, rename,
// delete bad extractions. Everything is RLS-scoped to the caller's org.
// ---------------------------------------------------------------------------

export async function deleteFact(db: SupabaseClient, orgId: string, id: string): Promise<void> {
  await db.from('memory_facts').delete().eq('org_id', orgId).eq('id', id);
}

// Entity FKs cascade (subject_id / object_id ON DELETE CASCADE), so its facts go too.
export async function deleteEntity(db: SupabaseClient, orgId: string, id: string): Promise<void> {
  await db.from('memory_entities').delete().eq('org_id', orgId).eq('id', id);
}

export async function updateEntity(
  db: SupabaseClient, orgId: string, id: string,
  patch: { name?: string; type?: string; summary?: string },
): Promise<{ ok: boolean; error?: string }> {
  const { data: cur } = await db.from('memory_entities')
    .select('name, normalized_name, aliases').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (!cur) return { ok: false, error: 'Entity not found.' };
  const c = cur as { name: string; normalized_name: string; aliases: string[] | null };
  const set: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof patch.name === 'string' && patch.name.trim() && normalizeName(patch.name) !== c.normalized_name) {
    const nn = normalizeName(patch.name);
    const { data: clash } = await db.from('memory_entities')
      .select('id').eq('org_id', orgId).eq('normalized_name', nn).neq('id', id).maybeSingle();
    if (clash) return { ok: false, error: 'Another entity already has that name — use Merge instead.' };
    set.name = patch.name.trim().slice(0, 200);
    set.normalized_name = nn;
    // keep the old name resolvable
    set.aliases = uniq([...(c.aliases ?? []), c.normalized_name, canonicalKey(c.name)]);
  }
  if (typeof patch.type === 'string' && (ENTITY_TYPES as readonly string[]).includes(patch.type)) set.type = patch.type;
  if (typeof patch.summary === 'string') set.summary = patch.summary.slice(0, 1000);

  const { error } = await db.from('memory_entities').update(set).eq('org_id', orgId).eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Drop exact-duplicate VALID facts for a subject (same canonical predicate + object),
// keeping the earliest. Used after a merge folds two nodes together.
async function dedupeSubjectFacts(db: SupabaseClient, orgId: string, subjId: string): Promise<number> {
  const { data } = await db.from('memory_facts')
    .select('id, predicate, object_id, object_text')
    .eq('org_id', orgId).eq('subject_id', subjId).is('valid_to', null).is('invalid_at', null)
    .order('created_at', { ascending: true });
  const facts = (data ?? []) as { id: string; predicate: string; object_id: string | null; object_text: string | null }[];
  const seen = new Set<string>(); const dups: string[] = [];
  for (const f of facts) {
    const key = `${canonPredicate(f.predicate)}|${f.object_id ?? canonObject(f.object_text)}`;
    if (seen.has(key)) dups.push(f.id); else seen.add(key);
  }
  if (dups.length) await db.from('memory_facts').delete().in('id', dups);
  return dups.length;
}

// Fold `sourceId` into `targetId`: repoint every fact, merge identity (name →
// aliases, mention counts, summary), delete the source, then dedupe.
export async function mergeEntities(
  db: SupabaseClient, orgId: string, sourceId: string, targetId: string,
): Promise<{ ok: boolean; error?: string; deduped?: number }> {
  if (!sourceId || !targetId || sourceId === targetId) return { ok: false, error: 'Pick two different entities.' };
  const { data: ents } = await db.from('memory_entities')
    .select('id, name, normalized_name, aliases, mention_count, summary').eq('org_id', orgId).in('id', [sourceId, targetId]);
  const rows = (ents ?? []) as { id: string; name: string; normalized_name: string; aliases: string[] | null; mention_count: number; summary: string }[];
  const src = rows.find((r) => r.id === sourceId);
  const tgt = rows.find((r) => r.id === targetId);
  if (!src || !tgt) return { ok: false, error: 'Entity not found.' };

  // Repoint edges, then drop any self-loops the merge created.
  await db.from('memory_facts').update({ subject_id: targetId }).eq('org_id', orgId).eq('subject_id', sourceId);
  await db.from('memory_facts').update({ object_id: targetId }).eq('org_id', orgId).eq('object_id', sourceId);
  await db.from('memory_facts').delete().eq('org_id', orgId).eq('subject_id', targetId).eq('object_id', targetId);

  // Fold identity into the target.
  const aliases = uniq([...(tgt.aliases ?? []), ...(src.aliases ?? []), src.normalized_name, canonicalKey(src.name)]);
  await db.from('memory_entities').update({
    aliases,
    mention_count: (tgt.mention_count ?? 1) + (src.mention_count ?? 0),
    summary: (tgt.summary ?? '').trim() ? tgt.summary : src.summary,
    updated_at: new Date().toISOString(),
  }).eq('id', targetId);

  await db.from('memory_entities').delete().eq('org_id', orgId).eq('id', sourceId);
  const deduped = await dedupeSubjectFacts(db, orgId, targetId);
  return { ok: true, deduped };
}

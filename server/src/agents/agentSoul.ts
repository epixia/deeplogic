// Generate an autonomous agent's identity ("soul") at deploy time — a random
// name, persona, human.md operator profile, skills, and a refined goal. The
// orchestrator injects this into the Orgo mission so every Hermes/OpenClaw agent
// runs as a distinct operator rather than a faceless prompt.

import { serviceClient } from '../supabase.js';
import type { AiProvider } from '../studio/generator.js';

export interface AgentSoul {
  name: string;
  soul: string;       // 2-3 sentence persona
  humanMd: string;    // markdown operator profile (human.md)
  skills: string[];
  goal: string;       // one-sentence refined objective
}

// Warm, friendly, real human-sounding names (approachable, not robotic/sci-fi).
const FIRST = ['Maya', 'Leo', 'Ava', 'Noah', 'Sofia', 'Ethan', 'Mila', 'Theo', 'Ruby', 'Jonah', 'Hazel', 'Felix', 'Iris', 'Owen', 'Nina', 'Caleb', 'Lucy', 'Sam', 'Grace', 'Eli', 'Maya', 'Jasmine', 'Marcus', 'Chloe', 'Adam'];
const LAST = ['Bennett', 'Carter', 'Hughes', 'Bailey', 'Brooks', 'Reed', 'Parker', 'Quinn', 'Ellis', 'Foster', 'Hayes', 'Morgan', 'Reeves', 'Sloane', 'Pierce', 'Wells', 'Murphy', 'Coleman', 'Walsh', 'Donovan'];
function randomName(): string {
  return `${FIRST[Math.floor(Math.random() * FIRST.length)]} ${LAST[Math.floor(Math.random() * LAST.length)]}`;
}

const DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: 'claude-haiku-4-5-20251001', openai: 'gpt-4o-mini', openrouter: 'openai/gpt-4o-mini',
};

async function loadAi(orgId: string): Promise<{ provider: AiProvider; apiKey: string; model?: string } | null> {
  const { data } = await serviceClient.from('org_ai_settings').select('provider, providers').eq('org_id', orgId).maybeSingle();
  if (!data) return null;
  const active = ((data as any).provider as AiProvider) || 'anthropic';
  const entry = (((data as any).providers ?? {}) as Record<string, { apiKey?: string; model?: string }>)[active];
  if (!entry?.apiKey) return null;
  return { provider: active, apiKey: entry.apiKey, model: entry.model || undefined };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function callAI(ai: { provider: AiProvider; apiKey: string; model?: string }, system: string, user: string): Promise<string> {
  const model = ai.model || DEFAULT_MODEL[ai.provider];
  if (ai.provider === 'anthropic') {
    const mod = await import('@anthropic-ai/sdk');
    const client = new mod.default({ apiKey: ai.apiKey });
    const res = await client.messages.create({ model, max_tokens: 1400, system, messages: [{ role: 'user', content: user }] });
    return (res.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  }
  const baseUrl = ai.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1';
  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({ model, max_tokens: 1400, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error(`AI ${r.status}`);
  const j = await r.json() as any;
  return j.choices?.[0]?.message?.content ?? '';
}
function extractJson(s: string): string {
  const f = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const b = f ? f[1] : s;
  const a = b.indexOf('{'); const z = b.lastIndexOf('}');
  return a >= 0 && z > a ? b.slice(a, z + 1) : b;
}

const SYSTEM =
  'You are an orchestrator that breathes life into an autonomous AI operator which runs on its own cloud computer (Orgo). ' +
  'Given the provider role and the mission, invent a vivid, professional identity. The NAME must be a warm, friendly, real human-sounding first + last name (approachable and natural, like a real colleague — never robotic, sci-fi, or codename-style). ' +
  'GOAL SCOPING: refine the mission into a goal that is specific AND legitimate — a concrete outcome with a clear business purpose, achieved from the company\'s OWN data and authoritative/owned sources (its Data Vault, connectors, CRM, internal directory/HR, records it has rights to) rather than scraping personal data off the open web. If the mission reads like mass-collecting named individuals\' personal contact data for unsolicited outreach, re-scope the goal to the legitimate version (owned/consented data, official channels) — do not restate the raw over-broad ask. ' +
  'The "## Boundaries" section of human.md MUST state that the operator respects privacy and data-protection law, uses only data the company is entitled to use, does not aggregate individuals\' personal data for unsolicited outreach, and keeps its own judgment about each task rather than treating an assignment as self-justifying. ' +
  'Output ONLY JSON: ' +
  '{ "name": "First Last", "soul": "2-3 sentence persona/working-style", "humanMd": "a markdown operator profile (a human.md): ## Identity, ## Operating principles, ## Voice & tone, ## Boundaries", "skills": ["..."], "goal": "one crisp sentence" }. No markdown fences, no prose outside the JSON.';

// Suggest which tools (skills) an agent needs, picked from the provided catalogue.
export async function suggestAgentTools(
  orgId: string,
  input: { name: string; description: string; systemPrompt: string; available: { name: string; label?: string; description?: string }[] },
): Promise<string[]> {
  const names = input.available.map((t) => t.name);
  const fallback = names.slice(0, Math.min(4, names.length));
  const ai = await loadAi(orgId);
  if (!ai || !names.length) return fallback;
  try {
    const sys = 'You select the tools an autonomous AI agent needs to do its job. Output ONLY JSON: {"tools":["toolName", ...]} using ONLY the provided tool names. Pick the minimal set that covers the agent\'s purpose.';
    const user = `Agent name: ${input.name}\nDescription: ${input.description}\nInstructions: ${input.systemPrompt}\n\nAvailable tools:\n${input.available.map((t) => `- ${t.name}: ${t.description ?? t.label ?? ''}`).join('\n')}`;
    const parsed = JSON.parse(extractJson(await callAI(ai, sys, user))) as { tools?: unknown };
    const picked = Array.isArray(parsed.tools) ? parsed.tools.map((x) => String(x)) : [];
    const valid = picked.filter((n) => names.includes(n));
    return valid.length ? valid : fallback;
  } catch {
    return fallback;
  }
}

export async function generateAgentSoul(
  orgId: string,
  input: { provider: 'hermes' | 'openclaw'; mission: string; companyName?: string; nameHint?: string },
): Promise<AgentSoul> {
  const pick = randomName();
  const roleSkills = input.provider === 'hermes'
    ? ['outreach', 'relationship-building', 'partnership scouting', 'persuasive messaging', 'CRM note-taking']
    : ['web research', 'data extraction', 'source verification', 'synthesis', 'structured reporting'];
  const fallback: AgentSoul = {
    name: pick,
    soul: input.provider === 'hermes'
      ? `${pick} is a tenacious, personable outreach operator for ${input.companyName || 'the company'} — warm but efficient, always advancing the relationship.`
      : `${pick} is a meticulous research operator for ${input.companyName || 'the company'} — skeptical of weak sources, fast at turning noise into signal.`,
    humanMd: `# ${pick}\n\n## Identity\nAutonomous ${input.provider} operator running on a cloud computer for ${input.companyName || 'the company'}.\n\n## Operating principles\n- Be autonomous; make reasonable decisions without asking.\n- Verify before reporting; cite where possible.\n- Report progress and results clearly.\n\n## Goal\n${input.mission}`,
    skills: roleSkills,
    goal: input.mission,
  };

  const ai = await loadAi(orgId);
  if (!ai) return fallback;
  try {
    const user = `Provider: ${input.provider} (${input.provider === 'hermes' ? 'autonomous outreach & messaging' : 'autonomous research & data extraction'}).\nCompany: ${input.companyName || '(unknown)'}.\nMission: ${input.mission}\nSuggested name (you may change it): ${pick}`;
    const parsed = JSON.parse(extractJson(await callAI(ai, SYSTEM, user))) as Partial<AgentSoul>;
    return {
      name: String(parsed.name || pick).slice(0, 60),
      soul: String(parsed.soul || fallback.soul).slice(0, 800),
      humanMd: String(parsed.humanMd || fallback.humanMd).slice(0, 4000),
      skills: Array.isArray(parsed.skills) ? parsed.skills.map((s) => String(s)).slice(0, 10) : fallback.skills,
      goal: String(parsed.goal || input.mission).slice(0, 500),
    };
  } catch {
    return fallback;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

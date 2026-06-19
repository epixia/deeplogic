// Suggest competitors — given the workspace's company profile, propose likely
// competitors (name + best-guess website + one-line reason). One AI call. The
// user reviews and one-click adds the ones they want.

import type { AiConfig, AiProvider } from './generator.js';

export interface CompetitorSuggestion {
  name: string;
  website: string;
  reason: string;
}

export interface CompetitorsResult {
  competitors: CompetitorSuggestion[];
  usedAI: boolean;
  aiError?: string;
  note?: string;
}

const DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: 'claude-opus-4-8',
  openai: 'gpt-4o',
  openrouter: 'openai/gpt-4o',
};

async function callAI(ai: AiConfig, system: string, user: string): Promise<string> {
  const model = ai.model || DEFAULT_MODEL[ai.provider];
  if (ai.provider === 'anthropic') {
    const mod = await import('@anthropic-ai/sdk');
    const client = new mod.default({ apiKey: ai.apiKey });
    const res = await client.messages.create({ model, max_tokens: 2000, system, messages: [{ role: 'user', content: user }] });
    return (res.content ?? [])
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text).join('');
  }
  const baseUrl = ai.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1';
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}`, 'X-Title': 'DeepLogic Competitors' },
    body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Provider error ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object found in response');
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

const SYSTEM = [
  'You are a competitive-intelligence analyst.',
  'Given a company profile, identify that company\'s most relevant REAL competitors.',
  'Respond with ONLY a JSON object (no markdown fences):',
  '{ "competitors": [ { "name": "Competitor name", "website": "best-guess official https URL", "reason": "one line on why they compete with this company" } ] }',
  'List 5-8 competitors, most relevant first. Use real companies and your best guess at their official domain. Do not invent fictional companies.',
].join('\n');

export async function suggestCompetitors(opts: {
  ai: AiConfig | null;
  companyProfile: string;
  existing?: string[];
}): Promise<CompetitorsResult> {
  const { ai, companyProfile, existing = [] } = opts;

  if (!companyProfile.trim()) {
    return { competitors: [], usedAI: false, note: 'Set up your company profile first (Company tab) so I can find relevant competitors.' };
  }
  if (!ai) {
    return { competitors: [], usedAI: false, note: 'AI is not configured — add a provider in Settings → AI providers to generate competitors.' };
  }

  const user = [
    '=== COMPANY PROFILE ===',
    companyProfile.slice(0, 4000),
    existing.length ? `\n=== ALREADY TRACKED (exclude these) ===\n${existing.join(', ')}` : '',
    '\nNow produce the JSON described in your instructions.',
  ].filter(Boolean).join('\n');

  try {
    const text = await callAI(ai, SYSTEM, user);
    const parsed = parseJsonObject(text);
    const arr = Array.isArray(parsed.competitors) ? parsed.competitors : [];
    const lowerExisting = new Set(existing.map((e) => e.toLowerCase()));
    const competitors = arr
      .map((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        const name = String(o.name ?? '').trim().slice(0, 100);
        if (!name || lowerExisting.has(name.toLowerCase())) return null;
        return {
          name,
          website: String(o.website ?? '').trim().slice(0, 300),
          reason: String(o.reason ?? '').trim().slice(0, 240),
        } as CompetitorSuggestion;
      })
      .filter((c): c is CompetitorSuggestion => c !== null)
      .slice(0, 8);
    if (competitors.length === 0) throw new Error('Model proposed no competitors');
    return { competitors, usedAI: true };
  } catch (err) {
    console.error('suggestCompetitors failed', err);
    return { competitors: [], usedAI: false, aiError: err instanceof Error ? err.message : 'AI request failed' };
  }
}

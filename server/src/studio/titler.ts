// generateTitle — a concise document title for a markdown note, from its
// CONTENT (not the chat prompt). One short AI call; null if no AI/failure so
// the caller can fall back to a heuristic.

import type { AiConfig, AiProvider } from './generator.js';

const DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
};

const SYSTEM =
  'You write a concise document title for the content you are given. ' +
  '3 to 7 words, Title Case, specific to the subject (name the company/topic). ' +
  'No quotes, no trailing punctuation, no "Title:" prefix. Reply with ONLY the title.';

async function callAI(ai: AiConfig, user: string): Promise<string> {
  const model = ai.model || DEFAULT_MODEL[ai.provider];
  if (ai.provider === 'anthropic') {
    const mod = await import('@anthropic-ai/sdk');
    const client = new mod.default({ apiKey: ai.apiKey });
    const res = await client.messages.create({ model, max_tokens: 30, system: SYSTEM, messages: [{ role: 'user', content: user }] });
    return (res.content ?? []).filter((b): b is { type: 'text'; text: string } => b.type === 'text').map((b) => b.text).join('');
  }
  const baseUrl = ai.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1';
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}`, 'X-Title': 'DeepLogic Titler' },
    body: JSON.stringify({ model, max_tokens: 30, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`Provider error ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

function clean(s: string): string {
  return s.split('\n')[0].replace(/^["'#\s]+/, '').replace(/["'\s.:;]+$/, '').replace(/^title:?\s*/i, '').trim().slice(0, 80);
}

export async function generateTitle(ai: AiConfig | null, content: string): Promise<string | null> {
  if (!ai || !content.trim()) return null;
  try {
    const out = clean(await callAI(ai, content.slice(0, 1500)));
    return out || null;
  } catch {
    return null;
  }
}

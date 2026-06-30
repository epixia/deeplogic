// generateGalleryBlock — given an API/widget's documentation, ask the AI to
// design a Block Gallery entry: name, icon, category, config fields and a
// self-contained HTML template (with {{fieldKey}} placeholders) that embeds /
// renders the thing. Powers the admin Block Builder. One AI call.

import type { AiConfig, AiProvider } from './generator.js';

export interface GalleryFieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  default?: string;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}
export interface GeneratedBlock {
  slug: string;
  name: string;
  icon: string;
  category: string;
  tagline: string;
  description: string;
  sizeW: number;
  sizeH: number;
  fields: GalleryFieldDef[];
  htmlTemplate: string;
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
    const res = await client.messages.create({ model, max_tokens: 3000, system, messages: [{ role: 'user', content: user }] });
    return (res.content ?? []).filter((b): b is { type: 'text'; text: string } => b.type === 'text').map((b) => b.text).join('');
  }
  const baseUrl = ai.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1';
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({ model, max_tokens: 3000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}`);
  const j = await res.json() as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? '';
}

const SYSTEM = `You design "Blocks" for a business-intelligence dashboard. A Block is a SELF-CONTAINED HTML fragment rendered in a sandboxed, transparent iframe. The iframe already defines CSS variables: --ink (text), --mut (muted text), --line (borders), --card (card bg), --bg2 (panel bg), --cyan (accent). The iframe sets data-theme="dark"|"light" on <html> — read it for theming.

Given an API or widget's documentation, output TWO parts in this exact order:

PART 1 — a JSON object (and NOTHING else on those lines). Do NOT include the HTML here:
{
  "slug": "kebab-case-id",
  "name": "Short name",
  "icon": "single emoji",
  "category": "markets" | "data" | "web" | "utility",
  "tagline": "<=6 words",
  "description": "1-2 sentences",
  "sizeW": 1-6, "sizeH": 1-6,
  "fields": [{ "key":"...", "label":"...", "type":"text|number|select", "default":"...", "placeholder":"...", "help":"...", "options":[{"value":"..","label":".."}] }]
}

PART 2 — the HTML template, on its own, wrapped EXACTLY like this:
<<<HTML
...self-contained HTML here (raw, not escaped, real newlines are fine)...
HTML>>>

RULES for the HTML:
- Reference each field with {{fieldKey}} — substituted with the user's config (HTML-escaped; use {{fieldKey|url}} when the value goes in a URL).
- Use the provided CSS variables so it matches dark/light. Make the root fill 100% height/width.
- If it embeds a third-party widget/script, include the official embed snippet from the docs and set its theme from document.documentElement.getAttribute('data-theme').
- Prefer keyless/public embeds. If an API key is required, add a field for it.
- Output ONLY the JSON object then the <<<HTML ... HTML>>> block. No markdown fences, no other prose.`;

function extractJson(s: string): string {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : s;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}
// Escape stray backslashes the model leaves in JSON strings (regex \d, \., …)
// that would otherwise make JSON.parse throw "Bad escaped character".
function sanitizeJson(s: string): string {
  return s.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
}

export async function generateGalleryBlock(
  ai: AiConfig,
  input: { url: string; docsText: string; hint?: string },
): Promise<GeneratedBlock> {
  const user = [
    `Documentation URL: ${input.url}`,
    input.hint ? `Extra instructions: ${input.hint}` : '',
    '',
    'Documentation content:',
    input.docsText.slice(0, 14000),
  ].filter(Boolean).join('\n');
  const raw = await callAI(ai, SYSTEM, user);

  // HTML arrives between markers (avoids JSON-escaping the whole template).
  const htmlMatch = raw.match(/<<<HTML\s*([\s\S]*?)\s*HTML>>>/);
  const jsonText = extractJson(raw.replace(/<<<HTML[\s\S]*?HTML>>>/, ''));
  let parsed: Partial<GeneratedBlock>;
  try {
    parsed = JSON.parse(jsonText) as Partial<GeneratedBlock>;
  } catch {
    parsed = JSON.parse(sanitizeJson(jsonText)) as Partial<GeneratedBlock>;
  }
  const htmlTemplate = (htmlMatch ? htmlMatch[1] : String(parsed.htmlTemplate ?? '')).trim();
  if (!parsed.name || !htmlTemplate) throw new Error('AI did not return a valid Block.');
  const cat = ['markets', 'data', 'web', 'utility'].includes(String(parsed.category)) ? String(parsed.category) : 'data';
  const slug = (parsed.slug || parsed.name).toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'custom-block';
  return {
    slug,
    name: String(parsed.name).slice(0, 80),
    icon: String(parsed.icon || '📦').slice(0, 8),
    category: cat,
    tagline: String(parsed.tagline || '').slice(0, 80),
    description: String(parsed.description || '').slice(0, 600),
    sizeW: Math.min(Math.max(Number(parsed.sizeW) || 3, 1), 6),
    sizeH: Math.min(Math.max(Number(parsed.sizeH) || 3, 1), 6),
    fields: Array.isArray(parsed.fields) ? parsed.fields.slice(0, 12) as GalleryFieldDef[] : [],
    htmlTemplate: htmlTemplate.slice(0, 20000),
  };
}

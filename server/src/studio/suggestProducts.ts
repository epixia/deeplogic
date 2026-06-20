// Suggest products — given the workspace's company profile, list the products /
// services the company offers (name + category + one-line description). One AI
// call. The user reviews and one-click adds the ones they want. Mirrors
// suggestCompetitors.

import type { AiConfig, AiProvider } from './generator.js';

export interface ProductSuggestion {
  name: string;
  category: string;
  description: string;
  price?: string;
  imageUrl?: string;
  url?: string;
}

export interface ProductsResult {
  products: ProductSuggestion[];
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
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}`, 'X-Title': 'DeepLogic Products' },
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

// Profile-only: produces general/category-level products (last resort).
const SYSTEM_PROFILE = [
  'You are a product analyst.',
  'Given a company profile, identify the products and services THIS company offers (its own catalogue — not competitors).',
  'Respond with ONLY a JSON object (no markdown fences):',
  '{ "products": [ { "name": "Product or service name", "category": "short category", "description": "one line on what it is and who it is for" } ] }',
  'List 5-12 products, most important first. Use the real offerings implied by the profile; do not invent unrelated products.',
].join('\n');

// Website-grounded: extracts SPECIFIC retail SKUs from the company's own pages.
const SYSTEM_SITE = [
  'You are a retail product analyst.',
  'From the company\'s OWN WEBSITE CONTENT below, extract the SPECIFIC products / SKUs this company sells at retail.',
  'Prefer concrete, named products over generic categories — include the brand, line, strain/variant, format, and size/potency when shown.',
  'Good: "Pink Kush 3.5g Dried Flower", "Sunset Gummies 10mg THC (5-pack)". Too generic: "Dried Flowers", "Gummies".',
  'Only include products clearly evidenced in the content — do NOT invent SKUs. If the content is thin, return the most specific items you can support.',
  'Respond with ONLY a JSON object (no markdown fences):',
  '{ "products": [ { "name": "Specific product / SKU name", "category": "product type, e.g. Dried Flower / Edible / Vape", "description": "one line: format, size/potency, and who it is for", "price": "price with currency if shown, else omit" } ] }',
  'Include the price ONLY if it appears in the content. List up to 20 products, the most prominent / best-selling first.',
].join('\n');

export async function suggestProducts(opts: {
  ai: AiConfig | null;
  companyProfile: string;
  /** Real text scraped from the company's own website/shop pages, if available. */
  siteText?: string;
  existing?: string[];
}): Promise<ProductsResult> {
  const { ai, companyProfile, siteText = '', existing = [] } = opts;

  if (!companyProfile.trim() && !siteText.trim()) {
    return { products: [], usedAI: false, note: 'Set up your company profile (with your website) first so I can find your products.' };
  }
  if (!ai) {
    return { products: [], usedAI: false, note: 'AI is not configured — add a provider in Settings → AI providers to generate products.' };
  }

  const hasSite = siteText.trim().length > 200;
  const system = hasSite ? SYSTEM_SITE : SYSTEM_PROFILE;
  const user = [
    hasSite ? '=== COMPANY WEBSITE CONTENT (real pages — extract specific products sold here) ===' : '',
    hasSite ? siteText.slice(0, 16000) : '',
    '=== COMPANY PROFILE ===',
    companyProfile.slice(0, 3000),
    existing.length ? `\n=== ALREADY TRACKED (exclude these) ===\n${existing.join(', ')}` : '',
    '\nNow produce the JSON described in your instructions.',
  ].filter(Boolean).join('\n');

  try {
    const text = await callAI(ai, system, user);
    const parsed = parseJsonObject(text);
    const arr = Array.isArray(parsed.products) ? parsed.products : [];
    const lowerExisting = new Set(existing.map((e) => e.toLowerCase()));
    const products = arr
      .map((p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        const name = String(o.name ?? '').trim().slice(0, 120);
        if (!name || lowerExisting.has(name.toLowerCase())) return null;
        const price = String(o.price ?? '').trim().slice(0, 40);
        return {
          name,
          category: String(o.category ?? '').trim().slice(0, 80),
          description: String(o.description ?? '').trim().slice(0, 300),
          ...(price ? { price } : {}),
        } as ProductSuggestion;
      })
      .filter((p): p is ProductSuggestion => p !== null)
      .slice(0, 20);
    if (products.length === 0) throw new Error('Model proposed no products');
    return { products, usedAI: true };
  } catch (err) {
    console.error('suggestProducts failed', err);
    return { products: [], usedAI: false, aiError: err instanceof Error ? err.message : 'AI request failed' };
  }
}

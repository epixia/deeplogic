// DeepLogic Studio (PRD v3) — report generator.
// generateReport() produces ONE complete, self-contained HTML document.
//   - When ANTHROPIC_API_KEY is set, it lazy-imports the Anthropic SDK and
//     calls Claude 'claude-opus-4-8' to vibecode the report.
//   - Otherwise (or on ANY error) it falls back to a deterministic dark-themed
//     TEMPLATE so the whole flow runs fully offline.
// It NEVER throws — it always returns { html, usedAI }.

import type { SemanticModel, StudioMessage } from '../types.js';

export type AiProvider = 'anthropic' | 'openai' | 'openrouter';

/** A bring-your-own-key AI configuration (per workspace). */
export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model?: string;
}

/** A file attached to a single prompt (transient — not persisted to the vault). */
export interface PromptAttachment {
  kind: 'image' | 'pdf' | 'text';
  name: string;
  mediaType?: string; // for image/pdf
  dataBase64?: string; // for image/pdf
  text?: string; // for text/html
}

export interface GenerateArgs {
  prompt: string;
  currentHtml?: string;
  context: string;
  modelData?: SemanticModel | null;
  history?: StudioMessage[];
  ai?: AiConfig | null;
  attachments?: PromptAttachment[];
}

export interface GenerateResult {
  html: string;
  usedAI: boolean;
  /** Set when a key WAS configured but the provider call failed (vs. plain template mode). */
  aiError?: string;
}

const DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: 'claude-opus-4-8',
  openai: 'gpt-4o',
  // A broadly-routable OpenRouter slug. Browse current slugs at openrouter.ai/models.
  openrouter: 'openai/gpt-4o',
};

const SYSTEM_PROMPT =
  "You are DeepLogic Studio, an expert at building beautiful, self-contained analytics reports. " +
  'Output ONE complete HTML document (<!doctype html> ... </html>) and NOTHING else — ' +
  'no markdown, no code fences, no commentary. Inline all CSS (and any JS). ' +
  'THEMING (important): define all colors as CSS custom properties on :root for a DARK ' +
  'default using DeepLogic tokens — background #070b12, cards #0e1726, hairline borders ' +
  'rgba(120,180,220,.14), text #eaf3fb, muted #8ea3b8, and the cyan->blue accent gradient ' +
  'linear-gradient(120deg,#6fe3f0,#49a0e6,#5560e8). ALSO include an ' +
  '`html[data-theme="light"] { ... }` block that redefines those same variables for a clean ' +
  'corporate LIGHT theme (background #faf9f8, cards #ffffff, borders #e1dfdd, text #201f1e, ' +
  'muted #605e5c, accent #0078d4). Reference the variables everywhere (no hardcoded colors) so ' +
  'the report looks right in BOTH themes — the host sets data-theme on <html>. ' +
  'Use ONLY the data/facts in the provided context; when you cite KPIs use the real numbers. ' +
  'If a current report is provided, modify it to satisfy the user\'s request rather than starting over.';

/** Light-theme overrides appended to deterministic templates so they respect the toggle. */
const LIGHT_OVERRIDES = `
html[data-theme="light"] body{background:#faf9f8;color:#201f1e}
html[data-theme="light"] .card,html[data-theme="light"] .kpi,html[data-theme="light"] .panel,html[data-theme="light"] .visual{background:#ffffff;border-color:#e1dfdd}
html[data-theme="light"] .muted,html[data-theme="light"] .kpi-name,html[data-theme="light"] .kpi-delta,html[data-theme="light"] .eyebrow,html[data-theme="light"] .note,html[data-theme="light"] .lead,html[data-theme="light"] .vf,html[data-theme="light"] .vt{color:#605e5c}
`;

/** Strip surrounding ```html / ``` fences and whitespace from a model reply. */
function stripFences(text: string): string {
  let t = text.trim();
  const fence = /^```(?:html)?\s*\n?([\s\S]*?)\n?```$/i.exec(t);
  if (fence) t = fence[1].trim();
  return t;
}

/** Does this look like a full/partial HTML document? */
function looksLikeHtml(text: string): boolean {
  return /<!doctype html|<html[\s>]|<body[\s>]|<div[\s>]|<section[\s>]/i.test(text);
}

/** Wrap arbitrary text in a minimal dark-themed HTML document. */
function wrapHtml(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 40px; background: #070b12; color: #eaf3fb;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif; }
  .card { background: #0e1726; border: 1px solid rgba(120,180,220,.14);
    border-radius: 16px; padding: 24px; max-width: 880px; margin: 0 auto; }
  h1 { background: linear-gradient(120deg,#6fe3f0,#49a0e6,#5560e8);
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .muted { color: #8ea3b8; }
  ${LIGHT_OVERRIDES}
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <div>${inner}</div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Format a KPI value for the template, honoring its declared format. */
function formatKpiValue(value: number, format: SemanticModel['kpis'][number]['format']): string {
  if (format === 'currency') {
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  if (format === 'percent') {
    return `${(value * 100).toFixed(1)}%`;
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Deterministic offline TEMPLATE: a full dark-themed HTML report. */
function templateReport(args: GenerateArgs): string {
  const title = (args.prompt || 'DeepLogic Report').trim().slice(0, 120) || 'DeepLogic Report';
  const model = args.modelData;

  let cards = '';
  if (model && model.kpis && model.kpis.length) {
    const cellsHtml = model.kpis
      .map((kpi) => {
        const current = formatKpiValue(kpi.current, kpi.format);
        const previous = formatKpiValue(kpi.previous, kpi.format);
        const delta = kpi.current - kpi.previous;
        const up = delta >= 0;
        const good = (up && kpi.goodDirection === 'up') || (!up && kpi.goodDirection === 'down');
        const arrow = up ? '▲' : '▼';
        const color = good ? '#6fe3f0' : '#e07a8a';
        return `<div class="kpi">
  <div class="kpi-name">${escapeHtml(kpi.name)}</div>
  <div class="kpi-value">${escapeHtml(current)}</div>
  <div class="kpi-delta" style="color:${color}">${arrow} vs ${escapeHtml(previous)}</div>
</div>`;
      })
      .join('\n');
    cards = `<div class="kpis">${cellsHtml}</div>`;
  } else {
    cards = '<p class="muted">No grounding model attached — add one to render real KPIs.</p>';
  }

  const modelName = model ? escapeHtml(model.name) : 'No grounding model';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px; background: #070b12; color: #eaf3fb;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif; }
  .wrap { max-width: 1000px; margin: 0 auto; }
  .eyebrow { text-transform: uppercase; letter-spacing: .12em; font-size: 12px;
    color: #8ea3b8; margin-bottom: 8px; }
  h1 { margin: 0 0 6px; font-size: 32px;
    background: linear-gradient(120deg,#6fe3f0,#49a0e6,#5560e8);
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .muted { color: #8ea3b8; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px; margin-top: 28px; }
  .kpi, .panel { background: #0e1726; border: 1px solid rgba(120,180,220,.14);
    border-radius: 16px; padding: 20px; }
  .kpi-name { font-size: 13px; color: #8ea3b8; }
  .kpi-value { font-size: 26px; font-weight: 700; margin: 8px 0 4px; }
  .kpi-delta { font-size: 13px; }
  .panel { margin-top: 28px; }
  .note { margin-top: 28px; font-size: 13px; color: #8ea3b8;
    border-top: 1px solid rgba(120,180,220,.14); padding-top: 16px; }
  ${LIGHT_OVERRIDES}
</style>
</head>
<body>
  <div class="wrap">
    <div class="eyebrow">DeepLogic Studio</div>
    <h1>${escapeHtml(title)}</h1>
    <div class="muted">Grounded in: ${modelName}</div>
    ${cards}
    <div class="panel">
      <div class="eyebrow">Request</div>
      <p>${escapeHtml(args.prompt || '')}</p>
    </div>
    <div class="note">Template mode — connect an AI provider in Settings → AI providers for full AI generation.</div>
  </div>
</body>
</html>`;
}

/** Build the user message sent to Claude. */
function buildUserMessage(args: GenerateArgs): string {
  const parts: string[] = [];
  parts.push('=== COMPILED CONTEXT (CONTEXT.md) ===');
  parts.push(args.context || '(no context provided)');
  if (args.currentHtml && args.currentHtml.trim()) {
    parts.push('=== CURRENT REPORT (HTML to modify) ===');
    parts.push(args.currentHtml);
  } else {
    parts.push('=== CURRENT REPORT ===');
    parts.push('(none — create a new report from scratch)');
  }
  const atts = args.attachments ?? [];
  if (atts.length) {
    parts.push('=== ATTACHED TO THIS PROMPT ===');
    for (const a of atts) {
      if (a.kind === 'text' && a.text) {
        parts.push(`### ${a.name}`);
        parts.push(a.text.slice(0, 60000));
      } else if (a.kind === 'image') {
        parts.push(`(An image "${a.name}" is attached below — use it as a visual reference.)`);
      } else if (a.kind === 'pdf') {
        parts.push(`(A PDF "${a.name}" is attached below — read it for content.)`);
      }
    }
  }

  parts.push('=== USER REQUEST ===');
  parts.push(args.prompt || '');
  return parts.join('\n\n');
}

/** Call Anthropic (Claude) via the official SDK. Supports image + PDF attachments. */
async function callAnthropic(args: GenerateArgs, apiKey: string, model: string): Promise<string> {
  const mod = await import('@anthropic-ai/sdk');
  const Anthropic = mod.default;
  const client = new Anthropic({ apiKey });

  // Build a multimodal content array (text + images + PDFs).
  // Typed loosely so it works across SDK versions / block types.
  const content: unknown[] = [{ type: 'text', text: buildUserMessage(args) }];
  for (const a of args.attachments ?? []) {
    if (a.kind === 'image' && a.dataBase64) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: a.mediaType || 'image/png', data: a.dataBase64 },
      });
    } else if (a.kind === 'pdf' && a.dataBase64) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: a.dataBase64 },
      });
    }
  }

  const res = await client.messages.create({
    model,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: 'user', content: content as any }],
  });
  return (res.content ?? [])
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** Call an OpenAI-compatible chat API (OpenAI or OpenRouter) via fetch. */
async function callOpenAICompatible(
  args: GenerateArgs,
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<string> {
  // Build (possibly multimodal) user content: text + any images as image_url.
  const text = buildUserMessage(args);
  const imageParts = (args.attachments ?? [])
    .filter((a) => a.kind === 'image' && a.dataBase64)
    .map((a) => ({
      type: 'image_url',
      image_url: { url: `data:${a.mediaType || 'image/png'};base64,${a.dataBase64}` },
    }));
  const userContent =
    imageParts.length > 0 ? [{ type: 'text', text }, ...imageParts] : text;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Title': 'DeepLogic Studio',
      'HTTP-Referer': 'https://deeplogic.local',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Provider error ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? '';
}

/** Resolve which AI config to use: workspace BYOK first, then ANTHROPIC_API_KEY env. */
function resolveAi(args: GenerateArgs): AiConfig | null {
  if (args.ai && args.ai.apiKey && args.ai.apiKey.trim()) {
    return {
      provider: args.ai.provider,
      apiKey: args.ai.apiKey.trim(),
      model: args.ai.model?.trim() || DEFAULT_MODEL[args.ai.provider],
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: DEFAULT_MODEL.anthropic,
    };
  }
  return null;
}

/**
 * Generate a self-contained HTML report. Uses the workspace's configured AI
 * provider/key (Claude, OpenAI, or OpenRouter) when present, else the
 * ANTHROPIC_API_KEY env, else a deterministic template. Never throws.
 */
export async function generateReport(args: GenerateArgs): Promise<GenerateResult> {
  const ai = resolveAi(args);
  if (!ai) return { html: templateReport(args), usedAI: false };

  try {
    const model = ai.model || DEFAULT_MODEL[ai.provider];
    let text: string;
    if (ai.provider === 'anthropic') {
      text = await callAnthropic(args, ai.apiKey, model);
    } else if (ai.provider === 'openai') {
      text = await callOpenAICompatible(args, 'https://api.openai.com/v1', ai.apiKey, model);
    } else {
      text = await callOpenAICompatible(args, 'https://openrouter.ai/api/v1', ai.apiKey, model);
    }

    let html = stripFences(text);
    if (!html) {
      return {
        html: templateReport(args),
        usedAI: false,
        aiError: `${ai.provider} returned an empty response`,
      };
    }
    if (!looksLikeHtml(html)) {
      const title =
        (args.prompt || 'DeepLogic Report').trim().slice(0, 120) || 'DeepLogic Report';
      html = wrapHtml(title, escapeHtml(html));
    }
    return { html, usedAI: true };
  } catch (err) {
    console.error('Studio AI generation failed; falling back to template', err);
    return {
      html: templateReport(args),
      usedAI: false,
      aiError: err instanceof Error ? err.message : 'AI request failed',
    };
  }
}

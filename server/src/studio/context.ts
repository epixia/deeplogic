// DeepLogic Studio (PRD v3) — context compiler.
// compileContext(items, model?) builds an augmented CONTEXT.md the generator
// reads: enabled context items grouped by kind, plus an optional KPI summary
// when the project is grounded in one of the org's semantic models.

import type { ContextItem, SemanticModel, VaultItem } from '../types.js';

const MAX_CHARS = 16000;
const FETCH_TIMEOUT_MS = 8000;
const FETCH_MAX_CHARS = 5000;

/**
 * Fetch a URL and return its content as a string, truncated to FETCH_MAX_CHARS.
 * Never throws — returns an error note on failure.
 */
async function fetchUrlContent(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const r = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    clearTimeout(timer);
    if (!r.ok) return `[fetch failed: ${r.status} ${r.statusText}]`;
    const raw = await r.text();
    // Pretty-print JSON so the AI can read it more easily.
    try {
      const json = JSON.parse(raw) as unknown;
      return JSON.stringify(json, null, 2).slice(0, FETCH_MAX_CHARS);
    } catch {
      return raw.slice(0, FETCH_MAX_CHARS);
    }
  } catch (e) {
    return `[fetch failed: ${e instanceof Error ? e.message : 'unknown error'}]`;
  }
}

/** Render the per-report Data Vault (files / MCP / APIs / notes) as markdown. */
async function renderVault(vault: VaultItem[]): Promise<string[]> {
  const parts: string[] = [];
  // enabled defaults to true for backwards-compat (items created before the field existed)
  const items = (vault ?? []).filter((i) => i.enabled !== false);
  if (items.length === 0) return parts;

  const files = items.filter((i) => i.kind === 'file');
  const mcps = items.filter((i) => i.kind === 'mcp');
  const apis = items.filter((i) => i.kind === 'api');
  const notes = items.filter((i) => i.kind === 'note');

  parts.push('## Report Data Vault');
  parts.push('Resources attached specifically to THIS report. Prefer these when building it.');

  if (files.length) {
    parts.push('### Attached files');
    for (const f of files) {
      parts.push(`#### ${f.name}`);
      if (f.content) parts.push('```\n' + f.content + '\n```');
    }
  }

  if (mcps.length) {
    parts.push('### MCP connectors');
    for (const m of mcps) {
      const meta = (m.meta ?? {}) as Record<string, unknown>;
      const url = typeof meta.url === 'string' ? meta.url : '';
      const desc = typeof meta.description === 'string' ? meta.description : '';
      parts.push(`#### ${m.name}${url ? ` (${url})` : ''}${desc ? ` — ${desc}` : ''}`);
      if (url) {
        const data = await fetchUrlContent(url);
        parts.push('Live data:');
        parts.push('```json\n' + data + '\n```');
      }
    }
  }

  if (apis.length) {
    parts.push('### APIs');
    for (const a of apis) {
      const meta = (a.meta ?? {}) as Record<string, unknown>;
      const url = typeof meta.url === 'string' ? meta.url : '';
      const desc = typeof meta.description === 'string' ? meta.description : '';
      const auth = typeof meta.auth === 'string' ? meta.auth : '';
      parts.push(`#### ${a.name}${url ? ` (${url})` : ''}${desc ? ` — ${desc}` : ''}`);
      if (auth) parts.push(`Auth: ${auth}`);
      if (url) {
        const data = await fetchUrlContent(url);
        parts.push('Live data:');
        parts.push('```json\n' + data + '\n```');
      }
    }
  }

  if (notes.length) {
    parts.push('### Vault notes');
    for (const n of notes) {
      parts.push(`#### ${n.name}`);
      if (n.content) parts.push(n.content);
    }
  }
  return parts;
}

/** Format a KPI value for the summary, honoring its declared format. */
function formatKpiValue(value: number, format: SemanticModel['kpis'][number]['format']): string {
  if (format === 'currency') {
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  if (format === 'percent') {
    return `${(value * 100).toFixed(1)}%`;
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Compile the enabled context items (and an optional grounding model) into a
 * single augmented markdown document. Grouped by kind with clear headers;
 * URL-based MCP/API connectors are fetched live and their data is included.
 * Capped to MAX_CHARS.
 */
export async function compileContext(
  items: ContextItem[],
  model?: SemanticModel | null,
  vault?: VaultItem[]
): Promise<string> {
  const enabled = (items ?? []).filter((i) => i.enabled);

  const docs = enabled.filter((i) => i.kind === 'doc');
  const htmls = enabled.filter((i) => i.kind === 'html');
  const mcps = enabled.filter((i) => i.kind === 'mcp');
  const notes = enabled.filter((i) => i.kind === 'note');
  const websites = enabled.filter((i) => i.kind === 'website');
  const dataFiles = enabled.filter((i) => i.kind === 'data');

  const parts: string[] = [];
  parts.push('# CONTEXT.md');
  parts.push(
    'This is the augmented context the AI reads. Use ONLY the facts/data below ' +
      'when generating the report; cite real numbers where they appear.'
  );

  // Per-report Data Vault first — it's the most specific to this report.
  parts.push(...(await renderVault(vault ?? [])));

  if (websites.length) {
    parts.push('## Websites');
    parts.push('Live website content fetched at compile time. Use it as up-to-date reference material.');
    for (const w of websites) {
      const meta = (w.meta ?? {}) as Record<string, unknown>;
      const url = typeof meta.url === 'string' ? meta.url : '';
      parts.push(`### ${w.name}${url ? ` (${url})` : ''}`);
      if (url) {
        const data = await fetchUrlContent(url);
        parts.push('```\n' + data + '\n```');
      } else if (w.content) {
        parts.push(w.content);
      }
    }
  }

  if (dataFiles.length) {
    parts.push('## Data files');
    parts.push('Uploaded tabular data (CSV / spreadsheets). Use these exact rows and numbers; do not invent values.');
    for (const d of dataFiles) {
      const meta = (d.meta ?? {}) as Record<string, unknown>;
      const fmt = typeof meta.format === 'string' ? meta.format : '';
      parts.push(`### ${d.name}${fmt ? ` (${fmt})` : ''}`);
      if (d.content) {
        parts.push('```\n' + d.content + '\n```');
      } else {
        parts.push('(Binary spreadsheet attached — export to CSV for full analysis.)');
      }
    }
  }

  if (docs.length) {
    parts.push('## Documents');
    for (const d of docs) {
      parts.push(`### ${d.name}`);
      if (d.content) parts.push(d.content);
    }
  }

  if (htmls.length) {
    parts.push('## Existing HTML reports');
    for (const h of htmls) {
      parts.push(`### ${h.name}`);
      if (h.content) parts.push(h.content);
    }
  }

  if (mcps.length) {
    parts.push('## MCP / URL connectors');
    for (const m of mcps) {
      const meta = (m.meta ?? {}) as Record<string, unknown>;
      const url = typeof meta.url === 'string' ? meta.url : '';
      const description =
        typeof meta.description === 'string' ? meta.description : (m.content ?? '');
      parts.push(`### ${m.name}${url ? ` (${url})` : ''}${description ? ` — ${description}` : ''}`);
      if (url) {
        const data = await fetchUrlContent(url);
        parts.push('Live data:');
        parts.push('```json\n' + data + '\n```');
      }
    }
  }

  if (notes.length) {
    parts.push('## Notes');
    for (const n of notes) {
      parts.push(`### ${n.name}`);
      if (n.content) parts.push(n.content);
    }
  }

  if (model) {
    parts.push(`## Live data — ${model.name}`);
    parts.push('Real KPIs from the grounding semantic model. Use these exact numbers.');
    for (const kpi of model.kpis ?? []) {
      const current = formatKpiValue(kpi.current, kpi.format);
      const previous = formatKpiValue(kpi.previous, kpi.format);
      parts.push(
        `- **${kpi.name}**: current ${current}, previous ${previous} ` +
          `(format: ${kpi.format}, good when it goes ${kpi.goodDirection})`
      );
    }
    const dims = (model.dimensions ?? []).map((d) => d.name);
    if (dims.length) {
      parts.push(`Dimensions: ${dims.join(', ')}.`);
    }
  }

  const out = parts.join('\n\n');
  return out.length > MAX_CHARS ? out.slice(0, MAX_CHARS) : out;
}

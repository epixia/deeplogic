// DeepLogic Studio (PRD v3) — context compiler.
// compileContext(items, model?) builds an augmented CONTEXT.md the generator
// reads: enabled context items grouped by kind, plus an optional KPI summary
// when the project is grounded in one of the org's semantic models.

import type { ContextItem, SemanticModel, VaultItem } from '../types.js';

const MAX_CHARS = 16000;

/** Render the per-report Data Vault (files / MCP / APIs / notes) as markdown. */
function renderVault(vault: VaultItem[]): string[] {
  const parts: string[] = [];
  // enabled defaults to true for backwards-compat (items created before the field existed)
  const items = (vault ?? []).filter((i) => i.enabled !== false);
  if (items.length === 0) return parts;

  const files = items.filter((i) => i.kind === 'file');
  const mcps = items.filter((i) => i.kind === 'mcp');
  const apis = items.filter((i) => i.kind === 'api');
  const notes = items.filter((i) => i.kind === 'note');

  parts.push('## Report Data Vault');
  parts.push(
    'Resources attached specifically to THIS report. Prefer these when building it.'
  );

  if (files.length) {
    parts.push('### Attached files');
    for (const f of files) {
      parts.push(`#### ${f.name}`);
      if (f.content) parts.push('```\n' + f.content + '\n```');
    }
  }
  if (mcps.length) {
    parts.push('### MCP servers');
    for (const m of mcps) {
      const meta = (m.meta ?? {}) as Record<string, unknown>;
      const url = typeof meta.url === 'string' ? meta.url : '';
      const desc = typeof meta.description === 'string' ? meta.description : '';
      parts.push(`- **${m.name}** ${url ? `(${url})` : ''} ${desc ? `— ${desc}` : ''}`.trim());
    }
  }
  if (apis.length) {
    parts.push('### APIs');
    for (const a of apis) {
      const meta = (a.meta ?? {}) as Record<string, unknown>;
      const url = typeof meta.url === 'string' ? meta.url : '';
      const desc = typeof meta.description === 'string' ? meta.description : '';
      const auth = typeof meta.auth === 'string' ? meta.auth : '';
      parts.push(`- **${a.name}** ${url ? `(${url})` : ''} ${desc ? `— ${desc}` : ''}`.trim());
      if (auth) parts.push(`  - auth: ${auth}`);
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
 * MCP descriptors use meta.url + meta.description. Capped to ~12000 chars.
 */
export function compileContext(
  items: ContextItem[],
  model?: SemanticModel | null,
  vault?: VaultItem[]
): string {
  const enabled = (items ?? []).filter((i) => i.enabled);

  const docs = enabled.filter((i) => i.kind === 'doc');
  const htmls = enabled.filter((i) => i.kind === 'html');
  const mcps = enabled.filter((i) => i.kind === 'mcp');
  const notes = enabled.filter((i) => i.kind === 'note');

  const parts: string[] = [];
  parts.push('# CONTEXT.md');
  parts.push(
    'This is the augmented context the AI reads. Use ONLY the facts/data below ' +
      'when generating the report; cite real numbers where they appear.'
  );

  // Per-report Data Vault first — it's the most specific to this report.
  parts.push(...renderVault(vault ?? []));

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
    parts.push('## MCP servers');
    for (const m of mcps) {
      const meta = (m.meta ?? {}) as Record<string, unknown>;
      const url = typeof meta.url === 'string' ? meta.url : '';
      const description =
        typeof meta.description === 'string' ? meta.description : m.content ?? '';
      const bits = [`- **${m.name}**`];
      if (url) bits.push(`(${url})`);
      if (description) bits.push(`— ${description}`);
      parts.push(bits.join(' '));
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

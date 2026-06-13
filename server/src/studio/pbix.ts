// Power BI (.pbix / .pbit) introspection for DeepLogic Studio.
//
// A .pbix/.pbit is a ZIP. We extract what is reliably present and version-tolerant:
//   - DataMashup        -> the Power Query (M) source functions -> CONNECTORS
//   - Report/Layout     -> report pages + visuals (chart types) + field references
//   - DataModelSchema   -> tables + measures (present in .pbit; sometimes .pbix)
// Everything is best-effort and wrapped so a weird/locked file degrades gracefully
// rather than throwing. Output feeds the Studio Data Vault + a starter scaffold.

import AdmZip from 'adm-zip';
import type { Connector } from '../types.js';

export interface PbixVisual {
  page: string;
  type: string; // e.g. columnChart, lineChart, card, table…
  fields: string[]; // referenced Table.Column / measures
}
export interface PbixTable {
  name: string;
  columns: string[];
  measures: { name: string; expression?: string }[];
}
export interface PbixSummary {
  name: string;
  pages: string[];
  sources: { name: string; kind: Connector['kind'] }[];
  tables: PbixTable[];
  visuals: PbixVisual[];
  measureCount: number;
}

/* ----------------------------- helpers ----------------------------- */

function decodeEntry(zip: AdmZip, re: RegExp): string | null {
  for (const e of zip.getEntries()) {
    if (re.test(e.entryName)) {
      try {
        const buf = e.getData();
        // Power BI JSON parts are often UTF-16LE with a BOM.
        let text = buf.toString('utf16le');
        if (!text.includes('{')) text = buf.toString('utf8');
        return text.replace(/^﻿/, '');
      } catch {
        return null;
      }
    }
  }
  return null;
}

function rawEntry(zip: AdmZip, re: RegExp): Buffer | null {
  for (const e of zip.getEntries()) {
    if (re.test(e.entryName)) {
      try {
        return e.getData();
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Map a Power Query M source function (or connection string) to a connector kind. */
function kindFromSignal(sig: string): Connector['kind'] | null {
  const s = sig.toLowerCase();
  if (/snowflake/.test(s)) return 'snowflake';
  if (/salesforce/.test(s)) return 'salesforce';
  if (/hubspot/.test(s)) return 'hubspot';
  if (/google.?sheets|gsheets/.test(s)) return 'sheets';
  if (/sap(hana|businesswarehouse)?/.test(s)) return 'sap';
  if (/excel\.workbook|excel\.currentworkbook/.test(s)) return 'excel';
  if (/csv\.document/.test(s)) return 'excel';
  if (/sql\.database|sql\.databases|odbc\.|oledb\.|database/.test(s)) return 'sqlserver';
  if (/web\.contents|json\.document|odata|rest/.test(s)) return 'rest';
  if (/analysisservices|powerbi|pbi/.test(s)) return 'powerbi';
  return null;
}

const SOURCE_FN_RE =
  /\b(Snowflake\.\w+|Salesforce\.\w+|Sql\.Databases?|Excel\.Workbook|Csv\.Document|Web\.Contents|Json\.Document|OData\.\w+|GoogleSheets\.\w+|Odbc\.\w+|OleDb\.\w+|SapHana\.\w+|SapBusinessWarehouse\.\w+|AnalysisServices\.\w+)\s*\(/g;

/** Pull the embedded Power Query (M) text out of the DataMashup part. */
function extractMashupM(zip: AdmZip): string {
  const raw = rawEntry(zip, /DataMashup$/i);
  if (!raw) return '';
  // The mashup wraps an inner ZIP (PK\x03\x04). Find it and unzip from there.
  const sig = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const at = raw.indexOf(sig);
  if (at === -1) return '';
  try {
    const inner = new AdmZip(raw.subarray(at));
    let m = '';
    for (const e of inner.getEntries()) {
      if (/\.m$/i.test(e.entryName) || /Formulas\/Section/i.test(e.entryName)) {
        try {
          m += e.getData().toString('utf8') + '\n';
        } catch {
          /* skip */
        }
      }
    }
    return m;
  } catch {
    return '';
  }
}

function dedupeSources(
  sources: { name: string; kind: Connector['kind'] }[]
): { name: string; kind: Connector['kind'] }[] {
  const seen = new Set<string>();
  const out: { name: string; kind: Connector['kind'] }[] = [];
  for (const s of sources) {
    if (seen.has(s.kind)) continue;
    seen.add(s.kind);
    out.push(s);
  }
  return out;
}

const KIND_LABEL: Record<Connector['kind'], string> = {
  powerbi: 'Power BI',
  snowflake: 'Snowflake',
  salesforce: 'Salesforce',
  hubspot: 'HubSpot',
  sqlserver: 'SQL Server',
  sheets: 'Google Sheets',
  sap: 'SAP',
  excel: 'Excel / CSV',
  rest: 'REST / Web API',
};

/* ----------------------------- parsers ----------------------------- */

function parseConnectors(zip: AdmZip): { name: string; kind: Connector['kind'] }[] {
  const found: { name: string; kind: Connector['kind'] }[] = [];

  // 1) DataMashup M source functions (most reliable for .pbix).
  const m = extractMashupM(zip);
  let match: RegExpExecArray | null;
  SOURCE_FN_RE.lastIndex = 0;
  while ((match = SOURCE_FN_RE.exec(m)) !== null) {
    const kind = kindFromSignal(match[1]);
    if (kind) found.push({ name: KIND_LABEL[kind], kind });
  }

  // 2) Connections part (older format / extra signal).
  const conn = decodeEntry(zip, /(^|\/)Connections$/i);
  if (conn) {
    const kind = kindFromSignal(conn);
    if (kind) found.push({ name: KIND_LABEL[kind], kind });
  }

  return dedupeSources(found);
}

function parseVisuals(zip: AdmZip): { pages: string[]; visuals: PbixVisual[] } {
  const text = decodeEntry(zip, /(^|\/)Report\/Layout$/i);
  const pages: string[] = [];
  const visuals: PbixVisual[] = [];
  if (!text) return { pages, visuals };

  let layout: unknown;
  try {
    layout = JSON.parse(text);
  } catch {
    return { pages, visuals };
  }

  const sections = (layout as { sections?: unknown[] })?.sections ?? [];
  for (const sec of sections as Record<string, unknown>[]) {
    const page =
      (sec.displayName as string) || (sec.name as string) || `Page ${pages.length + 1}`;
    pages.push(page);
    const containers = (sec.visualContainers as Record<string, unknown>[]) ?? [];
    for (const vc of containers) {
      try {
        const cfgRaw = vc.config;
        if (typeof cfgRaw !== 'string') continue;
        const cfg = JSON.parse(cfgRaw) as {
          singleVisual?: {
            visualType?: string;
            projections?: Record<string, { queryRef?: string }[]>;
          };
        };
        const sv = cfg.singleVisual;
        if (!sv) continue;
        const type = sv.visualType || 'visual';
        const fields = new Set<string>();
        for (const role of Object.values(sv.projections ?? {})) {
          for (const proj of role ?? []) {
            if (proj.queryRef) {
              // strip aggregation wrappers e.g. Sum(Sales.Amount) -> Sales.Amount
              const ref = proj.queryRef.replace(/^\w+\(([^)]*)\)$/, '$1');
              fields.add(ref);
            }
          }
        }
        visuals.push({ page, type, fields: [...fields].slice(0, 12) });
      } catch {
        /* skip malformed container */
      }
    }
  }
  return { pages, visuals };
}

function parseModel(zip: AdmZip, visuals: PbixVisual[]): {
  tables: PbixTable[];
  measureCount: number;
} {
  const byName = new Map<string, PbixTable>();
  const ensure = (name: string): PbixTable => {
    let t = byName.get(name);
    if (!t) {
      t = { name, columns: [], measures: [] };
      byName.set(name, t);
    }
    return t;
  };

  // 1) Authoritative model (mostly .pbit).
  const schemaText = decodeEntry(zip, /DataModelSchema$/i);
  let measureCount = 0;
  if (schemaText) {
    try {
      const schema = JSON.parse(schemaText) as {
        model?: { tables?: Record<string, unknown>[] };
      };
      for (const tbl of schema.model?.tables ?? []) {
        const tname = (tbl.name as string) || 'Table';
        if (/^(DateTableTemplate|LocalDateTable)/.test(tname)) continue;
        const t = ensure(tname);
        for (const col of (tbl.columns as Record<string, unknown>[]) ?? []) {
          const cn = col.name as string;
          if (cn && !cn.startsWith('RowNumber')) t.columns.push(cn);
        }
        for (const me of (tbl.measures as Record<string, unknown>[]) ?? []) {
          const mn = me.name as string;
          if (!mn) continue;
          const expr = Array.isArray(me.expression)
            ? (me.expression as string[]).join('\n')
            : typeof me.expression === 'string'
              ? me.expression
              : undefined;
          t.measures.push({ name: mn, expression: expr });
          measureCount += 1;
        }
      }
    } catch {
      /* ignore — fall back to layout inference */
    }
  }

  // 2) Infer tables/columns from visual field references when the model wasn't readable.
  if (byName.size === 0) {
    for (const v of visuals) {
      for (const f of v.fields) {
        const dot = f.indexOf('.');
        if (dot <= 0) continue;
        const table = f.slice(0, dot).trim();
        const field = f.slice(dot + 1).trim();
        const t = ensure(table);
        if (field && !t.columns.includes(field)) t.columns.push(field);
      }
    }
  }

  return { tables: [...byName.values()], measureCount };
}

/* ----------------------------- entry point ----------------------------- */

export function parsePbix(buf: Buffer, fallbackName: string): PbixSummary | null {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buf);
  } catch {
    return null;
  }

  try {
    const sources = parseConnectors(zip);
    const { pages, visuals } = parseVisuals(zip);
    const { tables, measureCount } = parseModel(zip, visuals);

    // If we couldn't extract anything meaningful, signal failure so the caller
    // can fall back to a synthetic model.
    if (sources.length === 0 && visuals.length === 0 && tables.length === 0) {
      return null;
    }

    return {
      name: fallbackName,
      pages,
      sources: sources.length ? sources : [{ name: 'Power BI', kind: 'powerbi' }],
      tables,
      visuals,
      measureCount,
    };
  } catch {
    return null;
  }
}

/* ----------------------------- outputs ----------------------------- */

/** Connector[] derived from the parsed data sources (for grounding/display). */
export function summaryToConnectors(s: PbixSummary): Connector[] {
  return s.sources.map((src, i) => ({
    id: `conn-${i}-${src.kind}`,
    name: src.name,
    kind: src.kind,
    tables: s.tables.map((t) => t.name).slice(0, 12),
    status: 'connected' as const,
  }));
}

/** A markdown brief for the Data Vault / AI context. */
export function summaryToMarkdown(s: PbixSummary): string {
  const lines: string[] = [];
  lines.push(`# Power BI report: ${s.name}`);
  lines.push(
    'Structure extracted from the uploaded Power BI file. Rebuild this report ' +
      'in HTML, preserving its data sources, pages, and visuals.'
  );

  if (s.sources.length) {
    lines.push('## Data connections');
    for (const src of s.sources) lines.push(`- ${src.name} (${src.kind})`);
  }
  if (s.tables.length) {
    lines.push('## Tables & measures');
    for (const t of s.tables.slice(0, 25)) {
      const cols = t.columns.slice(0, 16).join(', ');
      lines.push(`- **${t.name}** — columns: ${cols || '(unknown)'}`);
      for (const me of t.measures.slice(0, 20)) {
        lines.push(`  - measure \`${me.name}\`${me.expression ? `: ${me.expression.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`);
      }
    }
  }
  if (s.pages.length) lines.push(`## Pages\n${s.pages.map((p) => `- ${p}`).join('\n')}`);
  if (s.visuals.length) {
    lines.push('## Visuals');
    for (const v of s.visuals.slice(0, 40)) {
      lines.push(`- [${v.page}] **${v.type}** — ${v.fields.join(', ') || 'no fields'}`);
    }
  }
  const out = lines.join('\n');
  return out.length > 14000 ? out.slice(0, 14000) : out;
}

/** A deterministic, dark-themed HTML scaffold mirroring the report's structure. */
export function summaryToScaffold(s: PbixSummary): string {
  const esc = (x: string) =>
    x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sources = s.sources
    .map((src) => `<span class="src">${esc(src.name)}</span>`)
    .join('');
  const measures = s.tables.flatMap((t) => t.measures.map((m) => m.name));
  const kpiCards = measures
    .slice(0, 4)
    .map(
      (m) =>
        `<div class="card"><div class="k">${esc(m)}</div><div class="v">—</div><div class="d">awaiting data</div></div>`
    )
    .join('');
  const pageBlocks = (s.pages.length ? s.pages : ['Report']).map((page) => {
    const vis = s.visuals.filter((v) => v.page === page);
    const cards =
      (vis.length ? vis : [{ page, type: 'visual', fields: [] as string[] }])
        .map(
          (v) =>
            `<div class="visual"><div class="vt">${esc(v.type)}</div><div class="vf">${esc(
              v.fields.join(' · ') || 'fields TBD'
            )}</div><div class="vph"></div></div>`
        )
        .join('');
    return `<section class="page"><h2>${esc(page)}</h2><div class="grid">${cards}</div></section>`;
  });

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.name)}</title>
<style>
:root{--bg:#070b12;--card:#0e1726;--line:rgba(120,180,220,.14);--ink:#eaf3fb;--mut:#8ea3b8;--cyan:#6fe3f0;--grad:linear-gradient(120deg,#6fe3f0,#49a0e6,#5560e8)}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:'Segoe UI',Inter,system-ui,sans-serif;line-height:1.5;padding:32px}
.wrap{max-width:1080px;margin:0 auto}
header h1{font-size:30px;font-weight:800;letter-spacing:-.02em}
.lead{color:var(--mut);margin-top:6px}
.sources{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 26px}
.src{font-size:12px;color:var(--mut);border:1px solid var(--line);border-radius:999px;padding:5px 11px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:26px}
.card{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:14px}
.card .k{font-size:12px;color:var(--mut)}.card .v{font-size:24px;font-weight:800;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}.card .d{font-size:11px;color:var(--mut)}
.page{margin:26px 0}.page h2{font-size:18px;margin-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.visual{border:1px solid var(--line);border-radius:14px;background:var(--card);padding:16px;min-height:150px;display:flex;flex-direction:column;gap:8px}
.vt{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--cyan);font-weight:700}
.vf{font-size:12px;color:var(--mut)}
.vph{flex:1;border-radius:8px;background:linear-gradient(180deg,rgba(111,227,240,.06),transparent);border:1px dashed var(--line)}
@media(max-width:720px){.kpis,.grid{grid-template-columns:1fr}}
html[data-theme="light"]{--bg:#faf9f8;--card:#ffffff;--line:#e1dfdd;--ink:#201f1e;--mut:#605e5c}
</style></head>
<body><div class="wrap">
<header><h1>${esc(s.name)}</h1><div class="lead">Imported from Power BI · ${s.sources.length} connectors · ${s.visuals.length} visuals · ${measures.length} measures</div></header>
<div class="sources">${sources}</div>
${kpiCards ? `<div class="kpis">${kpiCards}</div>` : ''}
${pageBlocks.join('\n')}
</div></body></html>`;
}

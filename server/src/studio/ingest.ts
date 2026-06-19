// Unified Vault ingest pipeline.
//
//   classify(input) → category + confidence
//   buildProfile(category, input) → compact, AI-readable profile + content + tags
//
// One intake for files / URLs / pasted text. The caller (the /vault/ingest
// route) persists the result as a context_items row with category / profile /
// tags so the whole vault is one profile-first collection.
//
// SECURITY: fetched/extracted content is UNTRUSTED data — only ever used as
// reference material, never as instructions.

import { fetchSiteText, normalizeUrl } from './aiTeam.js';
import { inspectPowerBiBuffer, inspectionToMarkdown, type ConnectorType } from './powerbiInspect.js';

// Map the inspector's connector types to the app's connector kinds (for the
// Connectors / Databases vault aggregation).
const PBI_KIND: Record<ConnectorType, string> = {
  sql_server: 'sqlserver', fabric_warehouse: 'sqlserver', analysis_services: 'powerbi',
  powerbi_semantic_model: 'powerbi', sharepoint: 'rest', excel: 'excel', csv: 'excel',
  web_api: 'rest', odata: 'rest', odbc: 'rest', folder: 'excel', local_file: 'excel', unknown: 'rest',
};

export type VaultCategory =
  | 'data'
  | 'website'
  | 'image'
  | 'document'
  | 'powerbi'
  | 'note';

// The context_items.kind we store for each category (kept compatible with the
// existing vault aggregation + compileContext).
const CATEGORY_KIND: Record<VaultCategory, string> = {
  data: 'data',
  website: 'website',
  image: 'image',
  document: 'doc',
  powerbi: 'note',
  note: 'note',
};

export interface IngestInput {
  name?: string;
  url?: string;
  text?: string;
  dataBase64?: string; // data URI or raw base64
  mediaType?: string;
  filename?: string;
}

export interface IngestResult {
  category: VaultCategory;
  kind: string;
  name: string;
  confidence: number;
  profile: Record<string, unknown>;
  tags: string[];
  content: string;
  meta: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const EXT_CATEGORY: Record<string, VaultCategory> = {
  csv: 'data', tsv: 'data', json: 'data', xlsx: 'data', xls: 'data', parquet: 'data',
  pdf: 'document', md: 'document', markdown: 'document', txt: 'document',
  html: 'document', htm: 'document', docx: 'document', rtf: 'document',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  pbix: 'powerbi', pbit: 'powerbi',
};

function extOf(name?: string): string {
  return (name?.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
}

export function classify(input: IngestInput): { category: VaultCategory; confidence: number } {
  const ext = extOf(input.filename ?? input.name);
  if (ext && EXT_CATEGORY[ext]) return { category: EXT_CATEGORY[ext], confidence: 0.95 };

  if (input.mediaType) {
    if (input.mediaType.startsWith('image/')) return { category: 'image', confidence: 0.9 };
    if (input.mediaType === 'application/pdf') return { category: 'document', confidence: 0.9 };
    if (input.mediaType.includes('csv') || input.mediaType.includes('spreadsheet'))
      return { category: 'data', confidence: 0.85 };
  }

  if (input.url && !input.dataBase64) {
    return { category: 'website', confidence: 0.85 };
  }

  if (input.text && !input.dataBase64) {
    // CSV-ish pasted text?
    const firstLine = input.text.split('\n')[0] ?? '';
    if (firstLine.includes(',') && firstLine.split(',').length >= 3) {
      return { category: 'data', confidence: 0.55 };
    }
    return { category: 'note', confidence: 0.6 };
  }

  return { category: 'document', confidence: 0.4 };
}

// ---------------------------------------------------------------------------
// Tagging
// ---------------------------------------------------------------------------

const DOMAIN_KEYWORDS = [
  'revenue', 'sales', 'churn', 'retention', 'mrr', 'arr', 'pipeline', 'leads',
  'conversion', 'traffic', 'engagement', 'cost', 'spend', 'budget', 'profit',
  'margin', 'inventory', 'orders', 'customers', 'users', 'stripe', 'salesforce',
  'hubspot', 'weekly', 'monthly', 'daily', 'quarterly', 'forecast', 'kpi',
];
const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'are', 'was']);

function autoTags(name: string, text: string, category: VaultCategory): string[] {
  const hay = `${name}\n${text}`.toLowerCase();
  const tags = new Set<string>([category]);
  for (const kw of DOMAIN_KEYWORDS) if (hay.includes(kw)) tags.add(kw);
  // A couple of salient words from the name.
  for (const w of name.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 4 && !STOP.has(w) && tags.size < 8) tags.add(w);
  }
  return [...tags].slice(0, 10);
}

// ---------------------------------------------------------------------------
// Profilers
// ---------------------------------------------------------------------------

function rawBase64(dataBase64: string): string {
  return dataBase64.includes(',') ? dataBase64.split(',')[1] : dataBase64;
}
function decodeBase64(dataBase64: string): string {
  return Buffer.from(rawBase64(dataBase64), 'base64').toString('utf8');
}
function decodeBase64ToBuffer(dataBase64: string): Buffer {
  return Buffer.from(rawBase64(dataBase64), 'base64');
}

type ColType = 'number' | 'date' | 'boolean' | 'string';

function inferType(values: string[]): ColType {
  const sample = values.filter((v) => v !== '' && v != null).slice(0, 50);
  if (sample.length === 0) return 'string';
  const isNum = sample.every((v) => /^-?\$?[\d,]+(\.\d+)?%?$/.test(v.trim()));
  if (isNum) return 'number';
  const isBool = sample.every((v) => /^(true|false|yes|no|0|1)$/i.test(v.trim()));
  if (isBool) return 'boolean';
  const isDate = sample.every((v) => !isNaN(Date.parse(v)) && /[-/:]/.test(v));
  if (isDate) return 'date';
  return 'string';
}

function parseDelimited(text: string, delimiter: string) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length > 0);
  const rows = lines.map((l) => l.split(delimiter).map((c) => c.trim()));
  return rows;
}

/** Profile a CSV/TSV/JSON data file: columns, dtypes, row count, sample, stats. */
function profileData(text: string, ext: string): { profile: Record<string, unknown>; content: string } {
  // JSON array of objects → tabularize.
  if (ext === 'json' || text.trim().startsWith('[') || text.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const objs = arr.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
      if (objs.length) {
        const columns = [...new Set(objs.flatMap((o) => Object.keys(o)))];
        const sample = objs.slice(0, 5);
        const profile = {
          format: ext.toUpperCase() || 'JSON',
          rowCount: objs.length,
          columns: columns.map((name) => ({ name, type: inferType(objs.map((o) => String(o[name] ?? ''))) })),
          sampleRows: sample,
        };
        const content = JSON.stringify(sample, null, 2).slice(0, 8000);
        return { profile, content };
      }
    } catch {
      /* fall through to delimited */
    }
  }

  const delimiter = ext === 'tsv' || text.includes('\t') ? '\t' : ',';
  const rows = parseDelimited(text, delimiter);
  if (rows.length === 0) return { profile: { format: ext.toUpperCase(), rowCount: 0, columns: [] }, content: text.slice(0, 4000) };

  const header = rows[0];
  const body = rows.slice(1);
  const columns = header.map((name, i) => {
    const colVals = body.map((r) => r[i] ?? '');
    const type = inferType(colVals);
    const distinct = new Set(colVals.slice(0, 200)).size;
    const col: Record<string, unknown> = { name: name || `col${i + 1}`, type, cardinality: distinct };
    if (type === 'number') {
      const nums = colVals.map((v) => Number(v.replace(/[$,%]/g, ''))).filter((n) => !isNaN(n));
      if (nums.length) { col.min = Math.min(...nums); col.max = Math.max(...nums); }
    }
    return col;
  });

  const sampleRows = body.slice(0, 5).map((r) => Object.fromEntries(header.map((h, i) => [h || `col${i + 1}`, r[i] ?? ''])));
  const profile = {
    format: ext.toUpperCase() || 'CSV',
    delimiter: delimiter === '\t' ? 'tab' : 'comma',
    rowCount: body.length,
    columns,
    sampleRows,
  };
  // Store a trimmed version of the file as AI-readable content.
  const content = rows.slice(0, 200).map((r) => r.join(delimiter)).join('\n').slice(0, 12000);
  return { profile, content };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function ingest(input: IngestInput): Promise<IngestResult> {
  const { category, confidence } = classify(input);
  const ext = extOf(input.filename ?? input.name);
  const baseName = (input.name ?? input.filename ?? input.url ?? 'Untitled').trim();

  let profile: Record<string, unknown> = {};
  let content = '';
  const meta: Record<string, unknown> = {};

  if (category === 'website') {
    const url = normalizeUrl(input.url ?? '');
    meta.url = url ?? input.url;
    if (url) {
      try {
        const site = await fetchSiteText(url);
        profile = { url, title: site.title, excerpt: site.text.slice(0, 600) };
        content = site.text.slice(0, 8000);
        meta.title = site.title;
      } catch (e) {
        profile = { url, error: e instanceof Error ? e.message : 'fetch failed' };
      }
    }
  } else if (category === 'data') {
    const isBinary = ext === 'xlsx' || ext === 'xls' || ext === 'parquet';
    if (isBinary) {
      profile = { format: ext.toUpperCase(), binary: true, note: 'Export to CSV for full column profiling.' };
      if (input.dataBase64 && input.dataBase64.length < 4_000_000) meta.file = input.dataBase64;
    } else {
      const text = input.dataBase64 ? decodeBase64(input.dataBase64) : (input.text ?? '');
      const res = profileData(text, ext);
      profile = res.profile;
      content = res.content;
    }
    meta.format = (profile.format as string) ?? ext.toUpperCase();
  } else if (category === 'image') {
    meta.mediaType = input.mediaType ?? 'image/png';
    if (input.dataBase64) meta.file = input.dataBase64;
    profile = { mediaType: meta.mediaType, caption: null }; // vision caption added in Phase 2
  } else if (category === 'powerbi') {
    meta.source = 'pbix';
    const insp = input.dataBase64 ? inspectPowerBiBuffer(decodeBase64ToBuffer(input.dataBase64), baseName, { scanMode: 'deep' }) : null;
    const gotSomething = !!insp && (insp.connectors.length > 0 || insp.semanticModel.tables.length > 0 || insp.report.pages.length > 0 || insp.queries.length > 0);
    if (insp && gotSomething) {
      profile = {
        format: insp.file.fileType.toUpperCase(),
        pages: insp.report.pages,
        tableCount: insp.semanticModel.tables.length,
        measureCount: insp.summary.measureCount,
        // Legacy shape kept for the existing vault card.
        tables: insp.semanticModel.tables.slice(0, 30).map((t) => ({
          name: t.name, columns: t.columns.map((c) => c.name).slice(0, 40), measures: t.measures.map((m) => m.name),
        })),
        sources: insp.connectors.map((c) => ({ name: c.displayName, kind: PBI_KIND[c.type] })),
        // Full Phase-1 inspection (connectors, queries, KPIs, entities, lineage, risks).
        inspection: {
          summary: insp.summary,
          connectors: insp.connectors,
          queries: insp.queries.map((q) => ({
            name: q.name, connectors: q.connectors, sourceTables: q.sourceTables,
            selectedColumns: q.selectedColumns.slice(0, 30), steps: q.transformationSteps.length, outputEntityGuess: q.outputEntityGuess,
          })),
          kpis: insp.kpis,
          entities: insp.dataVault.entities,
          attributes: insp.dataVault.attributes.slice(0, 200),
          businessKeys: insp.dataVault.businessKeys,
          sourceSystems: insp.dataVault.sourceSystems,
          relationships: insp.semanticModel.relationships,
          lineageCount: insp.lineage.candidates.length,
          risks: insp.risks,
          limitations: insp.limitations,
        },
      };
      content = inspectionToMarkdown(insp).slice(0, 12000);
      // Detected connectors surface in the Connectors / Databases section via vault aggregation.
      meta.connectors = insp.connectors.map((c) => ({ name: c.displayName, kind: PBI_KIND[c.type] }));
    } else {
      profile = { format: 'PBIX', note: 'Could not parse this Power BI file.' };
      if (input.dataBase64 && input.dataBase64.length < 4_000_000) meta.file = input.dataBase64;
    }
  } else {
    // document / note
    content = input.dataBase64 ? decodeBase64(input.dataBase64).slice(0, 60000) : (input.text ?? '').slice(0, 60000);
    profile = { format: ext.toUpperCase() || 'TEXT', chars: content.length };
  }

  const tags = autoTags(baseName, content || JSON.stringify(profile), category);

  return {
    category,
    kind: CATEGORY_KIND[category],
    name: baseName,
    confidence,
    profile,
    tags,
    content,
    meta,
  };
}

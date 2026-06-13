// connectorMapper — derive Connector[] from a semantic model.
// Samples define their own connectors; uploads infer from table names.

import type { SemanticModel, Connector } from '../types.js';
import { idFrom } from './util.js';

/** Heuristic: guess a connector kind from a table name token. */
function inferKind(name: string): Connector['kind'] {
  const n = name.toLowerCase();
  if (n.includes('snowflake')) return 'snowflake';
  if (n.includes('salesforce') || n.includes('sfdc')) return 'salesforce';
  if (n.includes('hubspot')) return 'hubspot';
  if (n.includes('sql') || n.includes('dbo.')) return 'sqlserver';
  if (n.includes('sheet') || n.includes('gsheet')) return 'sheets';
  if (n.includes('sap')) return 'sap';
  if (n.includes('.xls') || n.includes('excel')) return 'excel';
  if (n.includes('http') || n.includes('api') || n.includes('rest')) return 'rest';
  return 'powerbi';
}

/**
 * Return the model's connectors. When a sample already declares them we pass
 * them through (the authoritative source); otherwise we synthesize a single
 * Power BI connector that owns every table the upload exposed.
 */
export function mapConnectors(model: SemanticModel): Connector[] {
  if (model.connectors && model.connectors.length > 0) {
    return model.connectors;
  }

  // Upload fallback: group inferred tables under one Power BI connector and,
  // if any table hints at another source, add a second connector for it.
  const allTables = Array.from(
    new Set(model.measures.map((m) => m.expression).flatMap((e) => extractTables(e)))
  );
  const tables = allTables.length > 0 ? allTables : ['Model'];

  const byKind = new Map<Connector['kind'], string[]>();
  for (const t of tables) {
    const kind = inferKind(t);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind)!.push(t);
  }
  if (byKind.size === 0) byKind.set('powerbi', tables);

  const connectors: Connector[] = [];
  for (const [kind, tabs] of byKind) {
    connectors.push({
      id: idFrom('c', kind),
      name: kindLabel(kind),
      kind,
      tables: tabs,
      status: 'connected',
    });
  }
  return connectors;
}

/** Pull bracketed/qualified table identifiers out of a DAX-ish expression. */
function extractTables(expr: string): string[] {
  const out: string[] = [];
  const re = /([A-Za-z_][A-Za-z0-9_.]*)\s*\[/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) out.push(m[1]);
  return out;
}

function kindLabel(kind: Connector['kind']): string {
  const labels: Record<Connector['kind'], string> = {
    powerbi: 'Power BI Service',
    snowflake: 'Snowflake Warehouse',
    salesforce: 'Salesforce',
    hubspot: 'HubSpot CRM',
    sqlserver: 'SQL Server',
    sheets: 'Google Sheets',
    sap: 'SAP',
    excel: 'Excel Workbook',
    rest: 'REST API',
  };
  return labels[kind];
}

// Database schema introspection — discover tables + columns from a Data Vault
// database connector, and flag KPI-worthy fields. Used by the Vault "Analyze"
// button with live streaming feedback.
//
//  - Supabase  → PostgREST OpenAPI spec (no DB password needed; uses the key)
//  - Postgres / Redshift → `pg` driver + information_schema
//  - MySQL / MariaDB → `mysql2` driver + information_schema
//  pg / mysql2 are optional deps imported dynamically.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface DbColumn { name: string; type: string; isNumeric: boolean; isTemporal: boolean }
export interface DbTable { name: string; columns: DbColumn[] }
export interface KpiCandidate { table: string; metric: string; type: string; timeSeries: boolean }
export interface DbSchema { engine: string; tables: DbTable[]; kpiCandidates: KpiCandidate[]; note?: string }

const NUMERIC = /(int|numeric|decimal|real|double|float|money|serial|number)/i;
const TEMPORAL = /(timestamp|date|time)/i;
const classify = (type: string) => ({ isNumeric: NUMERIC.test(type), isTemporal: TEMPORAL.test(type) });

function kpiCandidates(tables: DbTable[]): KpiCandidate[] {
  const out: KpiCandidate[] = [];
  for (const t of tables) {
    const timeSeries = t.columns.some((c) => c.isTemporal);
    for (const c of t.columns) {
      // Numeric columns that aren't keys make good metrics.
      if (c.isNumeric && !/^id$|_id$|^pk$/i.test(c.name)) out.push({ table: t.name, metric: c.name, type: c.type, timeSeries });
    }
  }
  return out;
}

async function introspectSupabase(url: string, apiKey: string, onP: (m: string) => void): Promise<DbSchema> {
  if (!url || !apiKey) throw new Error('Supabase URL and key are required.');
  onP('Connecting to Supabase (PostgREST)…');
  const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
    headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, Accept: 'application/openapi+json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Supabase returned ${r.status} — check the URL/key.`);
  const spec = await r.json() as any;
  const defs = spec.definitions ?? spec.components?.schemas ?? {};
  onP('Reading exposed schema…');
  const tables: DbTable[] = [];
  for (const [name, def] of Object.entries(defs)) {
    const props = (def as any).properties ?? {};
    const columns: DbColumn[] = Object.entries(props).map(([cn, p]: any) => {
      const type = String(p.format || p.type || 'text');
      return { name: cn, type, ...classify(type) };
    });
    if (!columns.length) continue;
    tables.push({ name, columns });
    onP(`• ${name} — ${columns.length} columns`);
  }
  return { engine: 'supabase', tables, kpiCandidates: kpiCandidates(tables) };
}

async function introspectPostgres(engine: string, m: any, onP: (m: string) => void): Promise<DbSchema> {
  let pg: any;
  try { pg = (await import('pg')).default ?? (await import('pg')); } catch { throw new Error('Postgres driver not installed on the server (run `npm install` in /server).'); }
  const client = new pg.Client({
    host: m.host, port: Number(m.port) || 5432, database: m.database, user: m.username, password: m.password,
    ssl: m.ssl ? { rejectUnauthorized: false } : undefined, connectionTimeoutMillis: 10_000,
  });
  onP('Connecting…'); await client.connect();
  onP('Reading information_schema…');
  const { rows } = await client.query(
    `select table_name, column_name, data_type from information_schema.columns
     where table_schema = 'public' order by table_name, ordinal_position`,
  );
  await client.end();
  const map = new Map<string, DbColumn[]>();
  for (const row of rows as any[]) {
    const arr = map.get(row.table_name) ?? [];
    arr.push({ name: row.column_name, type: row.data_type, ...classify(row.data_type) });
    map.set(row.table_name, arr);
  }
  const tables = [...map.entries()].map(([name, columns]) => { onP(`• ${name} — ${columns.length} columns`); return { name, columns }; });
  return { engine, tables, kpiCandidates: kpiCandidates(tables) };
}

async function introspectMysql(engine: string, m: any, onP: (m: string) => void): Promise<DbSchema> {
  let mysql: any;
  try { mysql = (await import('mysql2/promise')); } catch { throw new Error('MySQL driver not installed on the server (run `npm install` in /server).'); }
  onP('Connecting…');
  const conn = await mysql.createConnection({ host: m.host, port: Number(m.port) || 3306, database: m.database, user: m.username, password: m.password, connectTimeout: 10_000 });
  onP('Reading information_schema…');
  const [rows] = await conn.query(
    'select table_name as t, column_name as c, data_type as d from information_schema.columns where table_schema = ? order by table_name, ordinal_position',
    [m.database],
  );
  await conn.end();
  const map = new Map<string, DbColumn[]>();
  for (const row of rows as any[]) {
    const arr = map.get(row.t) ?? [];
    arr.push({ name: row.c, type: row.d, ...classify(row.d) });
    map.set(row.t, arr);
  }
  const tables = [...map.entries()].map(([name, columns]) => { onP(`• ${name} — ${columns.length} columns`); return { name, columns }; });
  return { engine, tables, kpiCandidates: kpiCandidates(tables) };
}

export async function introspectDatabase(type: string, meta: any, onP: (m: string) => void): Promise<DbSchema> {
  const m = meta ?? {};
  switch (type) {
    case 'supabase':
      return introspectSupabase(m.url, m.secretKey || m.publishableKey || m.apiKey, onP);
    case 'postgres':
    case 'postgresql':
    case 'redshift':
      return introspectPostgres(type, m, onP);
    case 'mysql':
    case 'mariadb':
      return introspectMysql(type, m, onP);
    default:
      return { engine: type, tables: [], kpiCandidates: [], note: `Live schema introspection for "${type}" isn't supported yet. Supported: Supabase, Postgres, Redshift, MySQL, MariaDB.` };
  }
}

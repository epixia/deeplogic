// DataForSEO — SERP, keyword, backlink and competitor SEO data.
// https://docs.dataforseo.com/v3/  Base: https://api.dataforseo.com
// Auth: HTTP Basic with your DataForSEO login (account email) + password.
//
// We talk to DataForSEO over plain REST (no SDK). All endpoints sit under /v3
// and return a JSON envelope with a top-level status_code (20000 == OK).

const DATAFORSEO_BASE = 'https://api.dataforseo.com';

export interface DataForSeoCreds {
  login: string;
  password: string;
}

function authHeader(login: string, password: string): string {
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
}

export async function dataforseoReq(
  creds: DataForSeoCreds,
  path: string,
  init?: RequestInit,
  timeoutMs = 30_000,
): Promise<Response> {
  return fetch(`${DATAFORSEO_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(creds.login, creds.password),
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

// Strip a URL / hostname down to a bare registrable domain DataForSEO accepts
// as a `target` (no protocol, no www, no path).
export function toDomain(input: string): string {
  let s = (input || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  return s.trim();
}

export interface DomainOverview {
  organicKeywords: number | null;   // ranked organic keywords
  organicTraffic: number | null;    // estimated monthly organic traffic (etv)
  organicTrafficCost: number | null; // estimated monthly traffic value (USD)
  pos1: number | null;              // keywords ranking #1
  pos2_3: number | null;            // keywords ranking #2–3
  raw: unknown;
}

// DataForSEO Labs "Domain Rank Overview" — organic keyword count & estimated
// traffic for a domain. Defaults to Google US / English.
export async function dataforseoDomainOverview(
  creds: DataForSeoCreds,
  domain: string,
  opts: { locationCode?: number; languageCode?: string } = {},
): Promise<DomainOverview> {
  const target = toDomain(domain);
  const body = [
    {
      target,
      location_code: opts.locationCode ?? 2840, // United States
      language_code: opts.languageCode ?? 'en',
    },
  ];
  const r = await dataforseoReq(
    creds,
    '/v3/dataforseo_labs/google/domain_rank_overview/live',
    { method: 'POST', body: JSON.stringify(body) },
    60_000,
  );
  if (!r.ok) throw new Error(`DataForSEO returned ${r.status}.`);
  const j = (await r.json()) as {
    status_code?: number;
    status_message?: string;
    tasks?: { result?: { items?: { metrics?: { organic?: Record<string, number> } }[] }[] }[];
  };
  if (j.status_code && j.status_code !== 20000) {
    throw new Error(j.status_message || `DataForSEO status ${j.status_code}`);
  }
  const organic = j.tasks?.[0]?.result?.[0]?.items?.[0]?.metrics?.organic ?? {};
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return {
    organicKeywords: num(organic.count),
    organicTraffic: num(organic.etv),
    organicTrafficCost: num(organic.estimated_paid_traffic_cost),
    pos1: num(organic.pos_1),
    pos2_3: num(organic.pos_2_3),
    raw: organic,
  };
}

// Validate credentials without spending balance: the account endpoint only
// needs auth and returns the user's plan / balance.
export async function dataforseoTestKey(
  login: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await dataforseoReq({ login, password }, '/v3/appendix/user_data', { method: 'GET' }, 20_000);
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'Invalid login or password.' };
    if (!r.ok) return { ok: false, error: `DataForSEO returned ${r.status}.` };
    const j = (await r.json()) as { status_code?: number; status_message?: string };
    if (j.status_code && j.status_code !== 20000) {
      return { ok: false, error: j.status_message || `status ${j.status_code}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'request failed' };
  }
}

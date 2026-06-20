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

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

// Shared caller for DataForSEO Labs "live" endpoints. Returns tasks[0].result[0]
// (or null), surfacing DataForSEO's real error message — including the common
// 403 when the Labs API isn't on the plan / the account has no funds.
async function labsCall(
  creds: DataForSeoCreds,
  path: string,
  payload: Record<string, unknown>[],
): Promise<Record<string, unknown> | null> {
  const r = await dataforseoReq(creds, path, { method: 'POST', body: JSON.stringify(payload) }, 60_000);
  const j = (await r.json().catch(() => null)) as {
    status_code?: number;
    status_message?: string;
    tasks?: { status_code?: number; status_message?: string; result?: Record<string, unknown>[] }[];
  } | null;
  if (!r.ok) {
    const detail = j?.status_message ? ` — ${j.status_message}` : '';
    if (r.status === 403) {
      throw new Error(
        `Access denied (403)${detail}. This needs the DataForSEO Labs API — check that it's enabled on your plan and your account has funds.`,
      );
    }
    throw new Error(`DataForSEO returned ${r.status}${detail}.`);
  }
  if (!j) throw new Error('DataForSEO returned an unreadable response.');
  if (j.status_code && j.status_code !== 20000) throw new Error(j.status_message || `DataForSEO status ${j.status_code}`);
  const task = j.tasks?.[0];
  if (task?.status_code && task.status_code !== 20000) {
    throw new Error(task.status_message || `DataForSEO task status ${task.status_code}`);
  }
  return task?.result?.[0] ?? null;
}

export interface DomainOverview {
  organicKeywords: number | null;   // ranked organic keywords
  organicTraffic: number | null;    // estimated monthly organic traffic (etv)
  organicTrafficCost: number | null; // estimated monthly traffic value (USD)
  pos1: number | null;              // keywords ranking #1
  pos2_3: number | null;            // keywords ranking #2–3
  pos4_10: number | null;           // keywords ranking #4–10
  raw: unknown;
}

// DataForSEO Labs "Domain Rank Overview" — organic keyword count & estimated
// traffic for a domain. Defaults to Google US / English.
export async function dataforseoDomainOverview(
  creds: DataForSeoCreds,
  domain: string,
  opts: { locationCode?: number; languageCode?: string } = {},
): Promise<DomainOverview> {
  const result = await labsCall(creds, '/v3/dataforseo_labs/google/domain_rank_overview/live', [
    { target: toDomain(domain), location_code: opts.locationCode ?? 2840, language_code: opts.languageCode ?? 'en' },
  ]);
  const items = (result?.items as { metrics?: { organic?: Record<string, number> } }[] | undefined) ?? [];
  const organic = items[0]?.metrics?.organic ?? {};
  return {
    organicKeywords: num(organic.count),
    organicTraffic: num(organic.etv),
    organicTrafficCost: num(organic.estimated_paid_traffic_cost),
    pos1: num(organic.pos_1),
    pos2_3: num(organic.pos_2_3),
    pos4_10: num(organic.pos_4_10),
    raw: organic,
  };
}

export interface RankedKeyword {
  keyword: string;
  position: number | null;
  searchVolume: number | null;
  etv: number | null;
  url: string | null;
}
export interface CompetingDomain {
  domain: string;
  organicKeywords: number | null;
  organicTraffic: number | null;
  avgPosition: number | null;
}
export interface TrafficPoint {
  date: string;             // 'YYYY-MM'
  organicTraffic: number | null;
  organicKeywords: number | null;
}
export interface PositionBucket {
  bucket: string;
  count: number;
}
export interface BacklinksSummary {
  backlinks: number | null;
  referringDomains: number | null;
  rank: number | null;      // DataForSEO domain rank (0–1000)
}
export interface DomainIntel {
  domain: string;
  locationCode: number;
  languageCode: string;
  overview: DomainOverview;
  topKeywords: RankedKeyword[];
  competitors: CompetingDomain[];
  history: TrafficPoint[];
  distribution: PositionBucket[];
  backlinks: BacklinksSummary | null;
  fetchedAt: string;
}

// Monthly organic traffic & keyword counts over time (DataForSEO Labs).
export async function dataforseoHistoricalOverview(
  creds: DataForSeoCreds,
  domain: string,
  opts: { locationCode?: number; languageCode?: string; months?: number } = {},
): Promise<TrafficPoint[]> {
  // Request an explicit window so we always get at least a year of history
  // (default ~14 months) rather than DataForSEO's shorter default range.
  const months = opts.months ?? 14;
  const from = new Date();
  from.setUTCMonth(from.getUTCMonth() - months);
  const dateFrom = from.toISOString().slice(0, 10);
  const result = await labsCall(creds, '/v3/dataforseo_labs/google/historical_rank_overview/live', [
    { target: toDomain(domain), location_code: opts.locationCode ?? 2840, language_code: opts.languageCode ?? 'en', date_from: dateFrom },
  ]);
  const items = (result?.items as { year?: number; month?: number; metrics?: { organic?: { etv?: number; count?: number } } }[] | undefined) ?? [];
  return items
    .map((it) => ({
      date: it.year && it.month ? `${it.year}-${String(it.month).padStart(2, '0')}` : '',
      organicTraffic: num(it.metrics?.organic?.etv),
      organicKeywords: num(it.metrics?.organic?.count),
    }))
    .filter((p) => p.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Backlink profile summary (DataForSEO Backlinks API).
export async function dataforseoBacklinksSummary(
  creds: DataForSeoCreds,
  domain: string,
): Promise<BacklinksSummary> {
  const result = await labsCall(creds, '/v3/backlinks/summary/live', [
    { target: toDomain(domain), internal_list_limit: 1, backlinks_status_type: 'live' },
  ]);
  return {
    backlinks: num(result?.backlinks),
    referringDomains: num(result?.referring_domains),
    rank: num(result?.rank),
  };
}

// Keyword position distribution from a domain's organic ranking buckets.
function positionDistribution(raw: unknown): PositionBucket[] {
  const o = (raw ?? {}) as Record<string, number>;
  const n = (k: string) => (typeof o[k] === 'number' ? o[k] : 0);
  return [
    { bucket: '#1', count: n('pos_1') },
    { bucket: '#2–3', count: n('pos_2_3') },
    { bucket: '#4–10', count: n('pos_4_10') },
    { bucket: '#11–20', count: n('pos_11_20') },
    { bucket: '#21–50', count: n('pos_21_30') + n('pos_31_40') + n('pos_41_50') },
    { bucket: '#51–100', count: n('pos_51_60') + n('pos_61_70') + n('pos_71_80') + n('pos_81_90') + n('pos_91_100') },
  ];
}

// Top organic keywords a domain ranks for, ordered by estimated traffic.
export async function dataforseoRankedKeywords(
  creds: DataForSeoCreds,
  domain: string,
  opts: { locationCode?: number; languageCode?: string; limit?: number } = {},
): Promise<RankedKeyword[]> {
  const result = await labsCall(creds, '/v3/dataforseo_labs/google/ranked_keywords/live', [
    {
      target: toDomain(domain),
      location_code: opts.locationCode ?? 2840,
      language_code: opts.languageCode ?? 'en',
      limit: opts.limit ?? 25,
      order_by: ['ranked_serp_element.serp_item.etv,desc'],
    },
  ]);
  return ((result?.items as Record<string, unknown>[] | undefined) ?? []).map((it) => {
    const row = it as {
      keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number } };
      ranked_serp_element?: { serp_item?: { rank_absolute?: number; etv?: number; url?: string } };
    };
    const serp = row.ranked_serp_element?.serp_item;
    return {
      keyword: row.keyword_data?.keyword ?? '',
      position: num(serp?.rank_absolute),
      searchVolume: num(row.keyword_data?.keyword_info?.search_volume),
      etv: num(serp?.etv),
      url: typeof serp?.url === 'string' ? serp.url : null,
    };
  }).filter((k) => k.keyword);
}

// Domains competing for the same organic keywords.
export async function dataforseoCompetitors(
  creds: DataForSeoCreds,
  domain: string,
  opts: { locationCode?: number; languageCode?: string; limit?: number } = {},
): Promise<CompetingDomain[]> {
  const result = await labsCall(creds, '/v3/dataforseo_labs/google/competitors_domain/live', [
    {
      target: toDomain(domain),
      location_code: opts.locationCode ?? 2840,
      language_code: opts.languageCode ?? 'en',
      limit: opts.limit ?? 10,
    },
  ]);
  return ((result?.items as Record<string, unknown>[] | undefined) ?? []).map((it) => {
    const row = it as {
      domain?: string;
      avg_position?: number;
      metrics?: { organic?: { count?: number; etv?: number } };
      full_domain_metrics?: { organic?: { count?: number; etv?: number } };
    };
    const organic = row.metrics?.organic ?? row.full_domain_metrics?.organic ?? {};
    return {
      domain: row.domain ?? '',
      organicKeywords: num(organic.count),
      organicTraffic: num(organic.etv),
      avgPosition: num(row.avg_position),
    };
  }).filter((c) => c.domain);
}

// Gather a full intel bundle for a domain. The overview is required (if it
// throws — e.g. 403 — the whole fetch fails with that message); keywords and
// competitors are best-effort so a partial result still returns.
export async function dataforseoDomainIntel(
  creds: DataForSeoCreds,
  domain: string,
  opts: { locationCode?: number; languageCode?: string } = {},
): Promise<DomainIntel> {
  const target = toDomain(domain);
  const locationCode = opts.locationCode ?? 2840;
  const languageCode = opts.languageCode ?? 'en';
  const overview = await dataforseoDomainOverview(creds, target, { locationCode, languageCode });
  const [topKeywords, competitors, history, backlinks] = await Promise.all([
    dataforseoRankedKeywords(creds, target, { locationCode, languageCode, limit: 25 }).catch(() => [] as RankedKeyword[]),
    dataforseoCompetitors(creds, target, { locationCode, languageCode, limit: 10 }).catch(() => [] as CompetingDomain[]),
    dataforseoHistoricalOverview(creds, target, { locationCode, languageCode }).catch(() => [] as TrafficPoint[]),
    dataforseoBacklinksSummary(creds, target).catch(() => null),
  ]);
  return {
    domain: target, locationCode, languageCode, overview, topKeywords, competitors,
    history, distribution: positionDistribution(overview.raw), backlinks,
    fetchedAt: new Date().toISOString(),
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

// Windy Webcams API v3 — validate a key and search webcams near a location.
// The key is stored server-side (Settings → APIs) and never reaches the client.

const BASE = 'https://api.windy.com/webcams/api/v3/webcams';

export async function windyTestKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${BASE}?limit=1`, { headers: { 'x-windy-api-key': apiKey }, signal: AbortSignal.timeout(10_000) });
    if (r.ok) return { ok: true };
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'Invalid Windy API key.' };
    return { ok: false, error: `Windy API returned ${r.status}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Request failed.' };
  }
}

export interface WindyWebcam {
  id: string;
  title: string;
  image?: string;
  embedUrl?: string;
  city?: string;
  country?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// The official player embed URL ALWAYS comes from the API (never hand-built).
function playerEmbed(w: any): string | undefined {
  const p = w.player ?? {};
  const pick = (x: any) => (typeof x === 'string' ? x : x?.embed);
  return pick(p.day) ?? pick(p.lifetime) ?? pick(p.month) ?? pick(p.live) ?? undefined;
}
function mapWebcam(w: any): WindyWebcam {
  return {
    id: String(w.webcamId),
    title: typeof w.title === 'string' ? w.title : 'Webcam',
    image: w.images?.current?.preview ?? w.images?.daylight?.preview ?? undefined,
    embedUrl: playerEmbed(w),
    city: w.location?.city,
    country: w.location?.country,
  };
}

export async function windySearchWebcams(
  apiKey: string,
  opts: { lat: number; lon: number; radius?: number; limit?: number },
): Promise<WindyWebcam[]> {
  const radius = Math.min(Math.max(opts.radius ?? 50, 1), 250);
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 50);
  const url = `${BASE}?nearby=${opts.lat},${opts.lon},${radius}&limit=${limit}&include=images,player,location`;
  const r = await fetch(url, { headers: { 'x-windy-api-key': apiKey }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`Windy API returned ${r.status}.`);
  const j = (await r.json()) as { webcams?: any[] };
  return (j.webcams ?? []).map(mapWebcam);
}

// Fetch one webcam by id — used to resolve its official player embed URL.
export async function windyGetWebcam(apiKey: string, id: string): Promise<WindyWebcam | null> {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}?include=images,player,location`, {
    headers: { 'x-windy-api-key': apiKey }, signal: AbortSignal.timeout(12_000),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Windy API returned ${r.status}.`);
  return mapWebcam(await r.json());
}
/* eslint-enable @typescript-eslint/no-explicit-any */

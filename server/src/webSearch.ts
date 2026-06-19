// Web search — keyless by default. Uses DuckDuckGo's server-rendered HTML
// endpoint (no API key, plain fetch + parse). If BRAVE_SEARCH_API_KEY is set we
// prefer Brave for higher-quality results, falling back to DuckDuckGo.
//
// This avoids any paid key requirement and any headless-browser dependency:
// the HTML endpoint returns parseable markup with a normal fetch.

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

// DuckDuckGo wraps result links as /l/?uddg=<encoded-target>. Unwrap to the real URL.
function unwrapDdgUrl(href: string): string {
  try {
    const abs = href.startsWith('http') ? href : `https:${href.startsWith('//') ? '' : '//'}${href.replace(/^\/+/, '')}`;
    const u = new URL(abs);
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return abs;
  } catch {
    return href;
  }
}

async function braveSearch(query: string, count: number, apiKey: string): Promise<WebSearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&search_lang=en&text_decorations=false`;
  const r = await fetch(url, {
    headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Brave ${r.status}`);
  const data = (await r.json()) as { web?: { results?: { title: string; url: string; description?: string; extra_snippets?: string[] }[] } };
  return (data.web?.results ?? []).slice(0, count).map((it) => ({
    title: it.title, url: it.url, snippet: it.description ?? it.extra_snippets?.[0] ?? '',
  }));
}

async function duckDuckGoSearch(query: string, count: number): Promise<WebSearchResult[]> {
  const r = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // A browser-like UA materially improves the odds of a parseable response.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'text/html',
    },
    body: `q=${encodeURIComponent(query)}&kl=us-en`,
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`DuckDuckGo ${r.status}`);
  const html = await r.text();

  const results: WebSearchResult[] = [];
  // Each result row: an anchor with class result__a (title + href), and a
  // sibling anchor/snippet with class result__snippet.
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html)) !== null) snippets.push(stripTags(sm[1]));

  let lm: RegExpExecArray | null;
  let i = 0;
  while ((lm = linkRe.exec(html)) !== null && results.length < count) {
    const url = unwrapDdgUrl(lm[1]);
    const title = stripTags(lm[2]);
    if (!title || !/^https?:\/\//.test(url)) { i++; continue; }
    results.push({ title, url, snippet: snippets[i] ?? '' });
    i++;
  }
  return results;
}

// DuckDuckGo Instant Answer JSON API — free, no key, reliable when it has an
// answer (company abstracts, disambiguation topics). A good fallback when the
// HTML endpoint is rate-limited.
async function ddgInstantAnswer(query: string, count: number): Promise<WebSearchResult[]> {
  const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&t=deeplogic`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!r.ok) throw new Error(`DDG IA ${r.status}`);
  const d = (await r.json()) as {
    Heading?: string; AbstractText?: string; AbstractURL?: string;
    RelatedTopics?: { FirstURL?: string; Text?: string; Topics?: { FirstURL?: string; Text?: string }[] }[];
  };
  const out: WebSearchResult[] = [];
  if (d.AbstractText && d.AbstractURL) out.push({ title: d.Heading || query, url: d.AbstractURL, snippet: d.AbstractText });
  for (const t of d.RelatedTopics ?? []) {
    if (out.length >= count) break;
    if (t.FirstURL && t.Text) out.push({ title: t.Text.slice(0, 90), url: t.FirstURL, snippet: t.Text });
    else if (t.Topics) {
      for (const s of t.Topics) {
        if (out.length >= count) break;
        if (s.FirstURL && s.Text) out.push({ title: s.Text.slice(0, 90), url: s.FirstURL, snippet: s.Text });
      }
    }
  }
  return out;
}

/** Search the web. Keyless via DuckDuckGo (HTML → Instant Answer); Brave when a key is configured. */
export async function webSearch(query: string, count = 5): Promise<WebSearchResult[]> {
  const q = (query || '').trim();
  if (!q) return [];
  const n = Math.min(Math.max(count, 1), 10);

  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (braveKey) {
    try {
      const r = await braveSearch(q, n, braveKey);
      if (r.length) return r;
    } catch (e) {
      console.warn('Brave search failed, falling back to DuckDuckGo:', e instanceof Error ? e.message : e);
    }
  }
  try {
    const r = await duckDuckGoSearch(q, n);
    if (r.length) return r;
  } catch (e) {
    console.warn('DuckDuckGo HTML search failed:', e instanceof Error ? e.message : e);
  }
  try {
    return await ddgInstantAnswer(q, n);
  } catch (e) {
    console.warn('DuckDuckGo Instant Answer failed:', e instanceof Error ? e.message : e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Wikipedia — free, keyed-by-nothing, great for company facts: whether a firm
// is publicly traded, ticker, founding, HQ, revenue, employee count.
// ---------------------------------------------------------------------------

export interface WikiResult {
  title: string;
  description: string;
  extract: string;
  url: string;
}

export async function wikipediaSummary(query: string): Promise<WikiResult | null> {
  const q = (query || '').trim();
  if (!q) return null;
  const ua = { 'User-Agent': 'DeepLogic/1.0 (business intelligence assistant)' };
  try {
    // 1) Resolve the best matching article title.
    const sr = await fetch(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=1&namespace=0&format=json`,
      { headers: ua, signal: AbortSignal.timeout(8_000) },
    );
    if (!sr.ok) return null;
    const arr = (await sr.json()) as [string, string[], string[], string[]];
    const title = arr?.[1]?.[0];
    if (!title) return null;
    // 2) Fetch the page summary (extract usually states public/private + ticker).
    const su = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: ua, signal: AbortSignal.timeout(8_000) },
    );
    if (!su.ok) return null;
    const d = (await su.json()) as {
      title?: string; description?: string; extract?: string;
      content_urls?: { desktop?: { page?: string } };
    };
    return {
      title: d.title ?? title,
      description: d.description ?? '',
      extract: d.extract ?? '',
      url: d.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
  } catch (e) {
    console.warn('Wikipedia lookup failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

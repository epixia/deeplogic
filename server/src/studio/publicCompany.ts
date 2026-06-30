// Public-company market data — reliable, current figures for a listed company,
// from Yahoo Finance (keyless). Used to replace stale AI-guessed facts (price,
// market cap, revenue, employees) on the company / competitor detail pages.

export interface PublicCompany {
  symbol: string              // as provided, e.g. 'TSXV:LOVE'
  yahooSymbol: string         // resolved Yahoo symbol, e.g. 'LOVE.TO'
  tradingViewSymbol: string   // resolved TradingView symbol, e.g. 'TSX:LOVE'
  name?: string
  exchange?: string
  currency?: string
  price?: number
  changePct?: number
  marketCap?: number
  revenue?: number       // trailing total revenue
  employees?: number
  industry?: string
  sector?: string
  website?: string
  hq?: string
  fetchedAt: string
}

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'application/json' }
const num = (v: unknown): number | undefined => (typeof v === 'number' && !Number.isNaN(v) ? v : undefined)

// Map an EXCHANGE:TICKER (or bare ticker / Yahoo symbol) to a Yahoo symbol.
const SUFFIX: Record<string, string> = {
  TSXV: '.V', 'TSX-V': '.V', TSX: '.TO', CSE: '.CN', NEO: '.NE',
  LSE: '.L', ASX: '.AX', FRA: '.F', ETR: '.DE', EPA: '.PA',
  NASDAQ: '', NYSE: '', AMEX: '', OTC: '', OTCQB: '', OTCQX: '', OTCMKTS: '', NYSEAMERICAN: '',
}
export function toYahooSymbol(symbol: string): string {
  const s = symbol.trim()
  if (s.includes(':')) {
    const [exRaw, tRaw] = s.split(':')
    const ex = exRaw.trim().toUpperCase()
    const t = tRaw.trim().toUpperCase()
    return `${t}${SUFFIX[ex] ?? ''}`
  }
  return s.toUpperCase()
}

// Derive a TradingView "EXCHANGE:TICKER" from a resolved Yahoo symbol/exchange.
const TV_BY_SUFFIX: Record<string, string> = {
  '.TO': 'TSX', '.V': 'TSXV', '.CN': 'CSE', '.NE': 'NEO',
  '.L': 'LSE', '.AX': 'ASX', '.F': 'FRA', '.DE': 'XETR', '.PA': 'EURONEXT', '.HK': 'HKEX',
}
const TV_BY_EXCH: Record<string, string> = {
  NMS: 'NASDAQ', NGM: 'NASDAQ', NCM: 'NASDAQ', NAS: 'NASDAQ',
  NYQ: 'NYSE', NYS: 'NYSE', ASE: 'AMEX', PCX: 'AMEX',
  TOR: 'TSX', VAN: 'TSXV', CNQ: 'CSE',
}
function tradingViewSymbol(yahooSymbol: string, exchange?: string, exchDisp?: string): string {
  const dot = yahooSymbol.indexOf('.')
  if (dot >= 0) {
    const tvEx = TV_BY_SUFFIX[yahooSymbol.slice(dot)]
    return tvEx ? `${tvEx}:${yahooSymbol.slice(0, dot)}` : yahooSymbol
  }
  const tvEx = exchDisp && /nasdaq/i.test(exchDisp) ? 'NASDAQ'
    : exchDisp && /nyse/i.test(exchDisp) ? 'NYSE'
    : exchDisp && /amex/i.test(exchDisp) ? 'AMEX'
    : TV_BY_EXCH[(exchange ?? '').toUpperCase()]
  return tvEx ? `${tvEx}:${yahooSymbol}` : yahooSymbol
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function yf(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

// Yahoo's quoteSummary now requires a crumb + matching cookie. Fetch & cache them.
let _cookie = ''
let _crumb = ''
async function ensureCrumb(): Promise<void> {
  if (_crumb) return
  try {
    const r = await fetch('https://fc.yahoo.com/', { headers: UA, signal: AbortSignal.timeout(8000) })
    const sc: string[] = (r.headers as any).getSetCookie?.() ?? [r.headers.get('set-cookie')].filter(Boolean)
    _cookie = sc.map((c) => c.split(';')[0]).join('; ')
    const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { ...UA, Cookie: _cookie }, signal: AbortSignal.timeout(8000) })
    _crumb = (await cr.text()).trim()
    if (!_crumb || _crumb.length > 40) _crumb = '' // a valid crumb is short; HTML page → invalid
  } catch { _crumb = ''; _cookie = '' }
}
// Authenticated GET (crumb + cookie) for endpoints that need it.
async function yfAuthed(url: string): Promise<any | null> {
  await ensureCrumb()
  const full = _crumb ? `${url}${url.includes('?') ? '&' : '?'}crumb=${encodeURIComponent(_crumb)}` : url
  try {
    const r = await fetch(full, { headers: { ...UA, Cookie: _cookie }, signal: AbortSignal.timeout(10_000) })
    if (!r.ok) { if (r.status === 401) _crumb = ''; return null }
    return await r.json()
  } catch {
    return null
  }
}

// Find the canonical listing by company name (disambiguates ticker collisions
// like NASDAQ:LOVE (Lovesac) vs TSX:LOVE (Cannara), and finds the CURRENT
// exchange even when the provided facts are stale).
interface YfMatch { symbol: string; exchange?: string; exchDisp?: string }
async function searchSymbols(query: string): Promise<YfMatch[]> {
  const j = await yf(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`)
  return ((j?.quotes ?? []) as any[])
    .filter((q) => q.quoteType === 'EQUITY' && typeof q.symbol === 'string')
    .map((q) => ({ symbol: q.symbol, exchange: q.exchange, exchDisp: q.exchDisp }))
}

// Pick the right listing from search results: prefer one whose bare ticker
// matches the wanted ticker, and among those a primary exchange (home market /
// US) over foreign cross-listings (Stuttgart, Frankfurt, OTC…).
// Quality of the exchange the listing trades on — prefer real primary venues
// over OTC pink sheets and foreign cross-listings (Stuttgart/Frankfurt/Munich).
const EXCH_RANK: Record<string, number> = {
  NMS: 0, NGM: 0, NCM: 0, NAS: 0, NYQ: 0, NYS: 0, TOR: 0, // top equity venues
  ASE: 1, PCX: 1, VAN: 1, LSE: 1, ASX: 1, NEO: 1, CNQ: 2,
  PNK: 8, OQX: 8, OQB: 8, OTC: 8, OBB: 8, // OTC / pink
  STU: 9, FRA: 9, MUN: 9, BER: 9, GER: 9, DUS: 9, HAM: 9, // foreign secondary
}
function pickListing(cands: YfMatch[], wantTicker: string): YfMatch | null {
  if (!cands.length) return null
  const exchScore = (c: YfMatch): number => EXCH_RANK[(c.exchange ?? '').toUpperCase()] ?? 5
  const suffixRank = (sym: string): number => {
    const dot = sym.indexOf('.')
    const suf = dot >= 0 ? sym.slice(dot) : ''
    const order = ['', '.TO', '.V', '.CN', '.NE', '.L', '.AX']
    const i = order.indexOf(suf)
    return i >= 0 ? i : 50
  }
  const exact = wantTicker ? cands.filter((c) => c.symbol.split('.')[0].toUpperCase() === wantTicker) : []
  const pool = exact.length ? exact : cands
  return [...pool].sort((a, b) => exchScore(a) - exchScore(b) || suffixRank(a.symbol) - suffixRank(b.symbol))[0]
}

export async function fetchPublicCompany(symbol: string, name?: string): Promise<PublicCompany | null> {
  const wantTicker = (symbol.includes(':') ? symbol.split(':')[1] : symbol.split('.')[0]).trim().toUpperCase()

  // Prefer a name-based search (reliable + current); fall back to mapping the
  // provided EXCHANGE:TICKER if the search doesn't confirm the same ticker.
  let yahooSymbol = ''
  let tvSym = ''
  if (name && name.trim()) {
    const m = pickListing(await searchSymbols(name.trim()), wantTicker)
    if (m && (!wantTicker || m.symbol.split('.')[0].toUpperCase() === wantTicker)) {
      yahooSymbol = m.symbol
      tvSym = tradingViewSymbol(m.symbol, m.exchange, m.exchDisp)
    }
  }
  if (!yahooSymbol) {
    yahooSymbol = toYahooSymbol(symbol)
    tvSym = tradingViewSymbol(yahooSymbol)
    if (!tvSym.includes(':') && symbol.includes(':')) tvSym = `${symbol.split(':')[0].trim().toUpperCase()}:${wantTicker}`
  }
  if (!yahooSymbol) return null
  const out: PublicCompany = { symbol, yahooSymbol, tradingViewSymbol: tvSym, fetchedAt: new Date().toISOString() }

  // Price/currency/exchange via the chart endpoint (reliable, no crumb needed).
  const chart = await yf(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1d`)
  const meta = chart?.chart?.result?.[0]?.meta
  if (meta) {
    out.price = num(meta.regularMarketPrice)
    out.currency = typeof meta.currency === 'string' ? meta.currency : undefined
    out.exchange = typeof meta.fullExchangeName === 'string' ? meta.fullExchangeName : (typeof meta.exchangeName === 'string' ? meta.exchangeName : undefined)
    const prev = num(meta.chartPreviousClose) ?? num(meta.previousClose)
    if (out.price != null && prev) out.changePct = ((out.price - prev) / prev) * 100
  }

  // Fundamentals via quoteSummary (best-effort — may be unavailable).
  const qs = await yfAuthed(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}?modules=assetProfile,price,financialData,summaryDetail`)
  const r = qs?.quoteSummary?.result?.[0]
  if (r) {
    const ap = r.assetProfile ?? {}
    const pr = r.price ?? {}
    const fd = r.financialData ?? {}
    const sd = r.summaryDetail ?? {}
    out.name = (typeof pr.longName === 'string' && pr.longName) || (typeof pr.shortName === 'string' ? pr.shortName : undefined)
    out.employees = num(ap.fullTimeEmployees)
    out.industry = typeof ap.industry === 'string' ? ap.industry : undefined
    out.sector = typeof ap.sector === 'string' ? ap.sector : undefined
    out.website = typeof ap.website === 'string' ? ap.website : undefined
    out.hq = [ap.city, ap.state, ap.country].filter((x) => typeof x === 'string' && x).join(', ') || undefined
    out.revenue = num(fd.totalRevenue?.raw)
    out.marketCap = num(pr.marketCap?.raw) ?? num(sd.marketCap?.raw)
    if (out.price == null) out.price = num(pr.regularMarketPrice?.raw)
    if (!out.currency && typeof pr.currency === 'string') out.currency = pr.currency
  }

  // Nothing usable came back.
  if (out.price == null && out.marketCap == null && out.revenue == null) return null
  return out
}
/* eslint-enable @typescript-eslint/no-explicit-any */

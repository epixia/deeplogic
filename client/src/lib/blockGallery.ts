// Block Gallery — predefined, purpose-built Blocks you configure and drop in,
// the way the Connector Library offers ready-made connector cards. Unlike
// AI-generated Blocks (vibe-coded HTML), these are deterministic "Smart Blocks":
// a small config form produces self-contained HTML that renders live data
// (TradingView markets, embeds, clocks) inside the standard widget iframe — no
// AI, no backend, reliable every time.

import type { WidgetType, DbGalleryBlock } from './api'

export type GalleryCategory = 'markets' | 'news' | 'data' | 'web' | 'utility'

export interface GalleryField {
  key: string
  label: string
  type: 'text' | 'number' | 'select'
  placeholder?: string
  default?: string
  help?: string
  helpUrl?: string   // link to the provider (e.g. where to get an API key)
  helpLabel?: string // link text (defaults to "Get a key →")
  options?: { value: string; label: string }[]
}

export interface GalleryBlock {
  id: string
  name: string
  icon: string
  category: GalleryCategory
  tagline: string
  description: string
  /** Suggested grid size (in dashboard cells). */
  size?: { w: number; h: number }
  fields: GalleryField[]
  /** Build the self-contained widget from the user's config. */
  build: (cfg: Record<string, string>) => { name: string; type: WidgetType; html: string }
}

export const GALLERY_CATEGORIES: { key: GalleryCategory; label: string }[] = [
  { key: 'markets', label: 'Markets & finance' },
  { key: 'news', label: 'News' },
  { key: 'data', label: 'Open Data' },
  { key: 'web', label: 'Web & embeds' },
  { key: 'utility', label: 'Utilities' },
]

// ---- builders -------------------------------------------------------------

const js = (v: unknown) => JSON.stringify(v)

// ---- gallery-block identity (stored on the widget so the editor edits SETTINGS
// only, never vibe-codes a predefined Block) ----------------------------------

const GALLERY_MARK = '@@gallery@@'

// Admin-built Blocks + built-in overrides (from the DB), merged in at runtime.
let DB_ROWS: DbGalleryBlock[] = []
function renderTemplate(tpl: string, cfg: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*(\|url)?\s*\}\}/g, (_m, key: string, url?: string) => {
    const v = cfg[key] ?? ''
    return url ? encodeURIComponent(v) : v.replace(/[<>"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
  })
}
function dbToGalleryBlock(r: DbGalleryBlock): GalleryBlock {
  const category = (['markets', 'news', 'data', 'web', 'utility'].includes(r.category) ? r.category : 'data') as GalleryCategory
  return {
    id: r.slug,
    name: r.name,
    icon: r.icon || '📦',
    category,
    tagline: r.tagline || '',
    description: r.description || '',
    size: { w: r.size_w || 3, h: r.size_h || 3 },
    fields: (r.fields ?? []) as GalleryField[],
    build: (cfg) => ({ name: cfg.name?.trim() || r.name, type: 'embed' as WidgetType, html: renderTemplate(r.html_template, cfg) }),
  }
}
// Override a built-in's metadata from a DB row while keeping its build() logic.
function overrideBuiltin(b: GalleryBlock, r: DbGalleryBlock): GalleryBlock {
  const cat = (['markets', 'news', 'data', 'web', 'utility'].includes(r.category) ? r.category : b.category) as GalleryCategory
  return {
    ...b,
    name: r.name || b.name,
    icon: r.icon || b.icon,
    category: cat,
    tagline: r.tagline ?? b.tagline,
    description: r.description ?? b.description,
    size: { w: r.size_w || b.size?.w || 2, h: r.size_h || b.size?.h || 2 },
  }
}
/** Load admin-built Blocks + built-in overrides (call with the fetched rows). */
export function setDynamicGalleryBlocks(rows: DbGalleryBlock[]): void {
  DB_ROWS = rows
}
/** Built-in Blocks (with admin overrides applied) plus admin-built ones. */
export function allGalleryBlocks(): GalleryBlock[] {
  const bySlug = new Map(DB_ROWS.map((r) => [r.slug, r]))
  const out: GalleryBlock[] = []
  for (const b of BLOCK_GALLERY) {
    const ov = bySlug.get(b.id)
    if (!ov) { out.push(b); continue }
    bySlug.delete(b.id)
    if (!ov.enabled) continue // built-in hidden by admin
    out.push(ov.html_template ? dbToGalleryBlock(ov) : overrideBuiltin(b, ov))
  }
  for (const r of bySlug.values()) {
    if (r.enabled) out.push(dbToGalleryBlock(r)) // pure admin-built blocks
  }
  return out
}

export function galleryBlockById(id: string): GalleryBlock | undefined {
  return allGalleryBlocks().find((b) => b.id === id)
}
export function encodeBlockConfig(blockId: string, config: Record<string, string>): string {
  return GALLERY_MARK + JSON.stringify({ blockId, config })
}
export function decodeBlockConfig(prompt: string | null | undefined): { block: GalleryBlock; config: Record<string, string> } | null {
  if (!prompt || !prompt.startsWith(GALLERY_MARK)) return null
  try {
    const data = JSON.parse(prompt.slice(GALLERY_MARK.length)) as { blockId: string; config?: Record<string, string> }
    const block = galleryBlockById(data.blockId)
    return block ? { block, config: data.config ?? {} } : null
  } catch { return null }
}

// Recover the gallery block + config from a Block's generated HTML — so Blocks
// created before the marker existed still open in settings mode (and self-heal
// the marker on save). Best-effort, signature-based.
export function inferBlockConfig(html: string | null | undefined): { block: GalleryBlock; config: Record<string, string> } | null {
  if (!html) return null
  const b = (id: string) => galleryBlockById(id)
  const grab = (re: RegExp) => re.exec(html)?.[1]
  let block: GalleryBlock | undefined
  let config: Record<string, string> = {}
  if (html.includes('embed-widget-advanced-chart.js')) {
    block = b('stock-chart')
    config = { symbol: grab(/symbol:\s*"([^"]+)"/) ?? '', interval: grab(/interval:\s*"([^"]+)"/) ?? 'D', style: grab(/style:\s*"([^"]+)"/) ?? '1' }
  } else if (html.includes('embed-widget-ticker-tape.js') || html.includes('tv-ticker-tape')) {
    block = b('ticker-tape')
    // symbols may be an attribute (symbols="…") or a setAttribute('symbols',"…") call.
    const attr = /symbols["'\s=,]+["']([^"']+)["']/.exec(html)?.[1]
    const syms = attr ? attr.split(',') : [...html.matchAll(/"proName":"([^"]+)"/g)].map((m) => m[1])
    config = { symbols: syms.map((s) => s.trim()).filter(Boolean).join(', ') }
  } else if (html.includes('embed-widget-single-quote.js')) {
    block = b('single-quote'); config = { symbol: grab(/symbol:\s*"([^"]+)"/) ?? '' }
  } else if (html.includes('embed-widget-market-overview.js')) {
    block = b('market-overview'); config = {}
  } else if (html.includes('/open-data/ckan')) {
    block = b('open-canada')
    config = { resourceId: grab(/RID=\s*"([^"]+)"/) ?? '', q: grab(/Q=\s*"([^"]*)"/) ?? '', limit: grab(/LIMIT=\s*(\d+)/) ?? '25' }
  } else if (/getElementById\("clk"\)/.test(html)) {
    block = b('world-clock'); config = { timezone: grab(/var tz=\s*"([^"]+)"/) ?? '', label: '' }
  } else if (/youtube\.com\/embed/i.test(html)) {
    block = b('youtube')
    const src = /<iframe[^>]*\ssrc="([^"]+)"/i.exec(html)?.[1] ?? ''
    const ch = /channel=([\w-]+)/.exec(src)?.[1]
    const vid = /embed\/([\w-]{11})/.exec(src)?.[1]
    config = { source: ch || vid || '' }
  } else if (/windy\.com/i.test(html) && /<iframe/i.test(html)) {
    block = b('windy-webcam')
    const src = /<iframe[^>]*src="([^"]+)"/i.exec(html)?.[1] ?? ''
    config = { embedUrl: src, webcamId: /player\/(\d+)/.exec(src)?.[1] ?? '' }
  } else if (/<iframe/i.test(html)) {
    block = b('website-embed'); config = { url: grab(/<iframe[^>]*\ssrc="([^"]+)"/i) ?? '' }
  }
  return block ? { block, config } : null
}

// A TradingView embed that reads the iframe's data-theme at runtime, so the
// chart follows the app's light/dark theme automatically. `configExpr` is a JS
// object-literal string that may reference the runtime `THEME` variable.
function tvBlock(scriptFile: string, configExpr: string): string {
  return [
    // Flex column so TradingView's injected copyright bar sits below and the chart
    // (flex:1) fills the rest — avoids the chart overflowing/being cut off.
    '<div class="tradingview-widget-container" style="height:100%;width:100%;display:flex;flex-direction:column;overflow:hidden">',
    '<div class="tradingview-widget-container__widget" style="flex:1 1 auto;min-height:0;width:100%"></div>',
    '</div>',
    '<script type="text/javascript">',
    '(function(){',
    "var THEME=document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';",
    'var cfg=' + configExpr + ';',
    'var s=document.createElement("script");',
    's.src="https://s3.tradingview.com/external-embedding/' + scriptFile + '";',
    's.async=true;s.type="text/javascript";s.innerHTML=JSON.stringify(cfg);',
    'document.querySelector(".tradingview-widget-container").appendChild(s);',
    '})();',
    '</script>',
  ].join('\n')
}

// A news-list block: fetches `urlJs` (a JS expression producing the request URL,
// or null to show emptyMsg), maps the response to {title,url,source,date,desc}
// via `mapJs` (a JS function expression), and renders a themed, linked list.
function newsFrame(urlJs: string, mapJs: string, emptyMsg: string): string {
  return [
    '<div style="height:100%;display:flex;flex-direction:column;font-family:inherit;color:var(--ink)">',
    '<div id="nb-head" style="font-size:11px;color:var(--mut);margin-bottom:6px;flex:none">Loading…</div>',
    '<div id="nb-body" style="flex:1;overflow:auto"></div>',
    '</div>',
    '<script>(function(){',
    'var head=document.getElementById("nb-head"),body=document.getElementById("nb-body");',
    'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"})[c]})}',
    'function fmt(d){var t=new Date(d);return isNaN(t.getTime())?"":t.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}',
    'function render(items){',
    'if(!items||!items.length){head.textContent="No articles found.";return}',
    'head.textContent=items.length+" articles";',
    'body.innerHTML=items.map(function(a){',
    'return "<a href=\\""+esc(a.url)+"\\" target=\\"_blank\\" rel=\\"noopener noreferrer\\" style=\\"display:block;text-decoration:none;color:inherit;padding:8px 2px;border-bottom:1px solid var(--line)\\">"',
    '+"<div style=\\"font-size:13px;font-weight:600;line-height:1.35\\">"+esc(a.title)+"</div>"',
    '+"<div style=\\"font-size:11px;color:var(--mut2);margin-top:2px\\">"+esc(a.source||"")+(a.date?(" \\u00b7 "+fmt(a.date)):"")+"</div>"',
    '+(a.desc?("<div style=\\"font-size:12px;color:var(--mut);margin-top:3px;line-height:1.4\\">"+esc(a.desc)+"</div>"):"")',
    '+"</a>";',
    '}).join("");}',
    'try{',
    'var url=' + urlJs + ';',
    'if(!url){head.textContent=' + js(emptyMsg) + ';return;}',
    'fetch(url).then(function(r){return r.json()}).then(function(j){render((' + mapJs + ')(j));}).catch(function(e){head.textContent="Could not load: "+e.message});',
    '}catch(e){head.textContent="Error: "+e.message}',
    '})();</script>',
  ].join('\n')
}

// ---- catalog --------------------------------------------------------------

export const BLOCK_GALLERY: GalleryBlock[] = [
  {
    id: 'stock-chart',
    name: 'Stock Chart',
    icon: '📈',
    category: 'markets',
    tagline: 'Live interactive price chart',
    description: 'A full TradingView candlestick/line chart for any listed symbol — stocks, FX, crypto, indices. Interactive, theme-aware, always current.',
    size: { w: 6, h: 5 },
    fields: [
      { key: 'symbol', label: 'Symbol', type: 'text', default: 'NASDAQ:AAPL', placeholder: 'NASDAQ:AAPL', help: 'EXCHANGE:TICKER — e.g. TSX:LOVE, NASDAQ:AAPL, BITSTAMP:BTCUSD' },
      { key: 'range', label: 'Date range', type: 'select', default: '12M', options: [
        { value: '1D', label: '1 day' }, { value: '5D', label: '5 days' }, { value: '1M', label: '1 month' }, { value: '3M', label: '3 months' },
        { value: '6M', label: '6 months' }, { value: 'YTD', label: 'Year to date' }, { value: '12M', label: '1 year' }, { value: '60M', label: '5 years' }, { value: 'ALL', label: 'All time' },
      ] },
      { key: 'interval', label: 'Candle interval', type: 'select', default: 'D', options: [
        { value: '15', label: '15 min' }, { value: '60', label: 'Hourly' }, { value: '240', label: '4 hour' }, { value: 'D', label: 'Daily' }, { value: 'W', label: 'Weekly' }, { value: 'M', label: 'Monthly' },
      ] },
      { key: 'style', label: 'Style', type: 'select', default: '1', options: [
        { value: '1', label: 'Candles' }, { value: '2', label: 'Line' }, { value: '3', label: 'Area' }, { value: '0', label: 'Bars' }, { value: '8', label: 'Heikin Ashi' },
      ] },
      { key: 'toolbar', label: 'Top toolbar', type: 'select', default: 'show', options: [{ value: 'show', label: 'Show' }, { value: 'hide', label: 'Hide' }] },
      { key: 'drawingTools', label: 'Drawing tools', type: 'select', default: 'hide', options: [{ value: 'hide', label: 'Hide' }, { value: 'show', label: 'Show' }] },
      { key: 'details', label: 'Details panel', type: 'select', default: 'hide', options: [{ value: 'hide', label: 'Hide' }, { value: 'show', label: 'Show' }] },
    ],
    build: (cfg) => {
      const symbol = (cfg.symbol || 'NASDAQ:AAPL').trim()
      const interval = cfg.interval || 'D'
      const style = cfg.style || '1'
      const range = cfg.range || '12M'
      const hideTop = cfg.toolbar === 'hide'
      const hideSide = (cfg.drawingTools || 'hide') !== 'show'
      const details = cfg.details === 'show'
      const expr = `{autosize:true,symbol:${js(symbol)},interval:${js(interval)},range:${js(range)},timezone:"Etc/UTC",theme:THEME,style:${js(style)},locale:"en",enable_publishing:false,allow_symbol_change:true,hide_top_toolbar:${hideTop},hide_side_toolbar:${hideSide},details:${details},support_host:"https://www.tradingview.com"}`
      return { name: cfg.name?.trim() || `${symbol} chart`, type: 'chart', html: tvBlock('embed-widget-advanced-chart.js', expr) }
    },
  },
  {
    id: 'ticker-tape',
    name: 'Ticker Tape',
    icon: '🎯',
    category: 'markets',
    tagline: 'Scrolling multi-symbol prices',
    description: 'A scrolling tape of live quotes for the symbols you care about — a watchlist in a single strip.',
    size: { w: 4, h: 1 },
    fields: [
      { key: 'symbols', label: 'Symbols', type: 'text', default: 'NASDAQ:AAPL, TSX:LOVE, FX:EURUSD, BITSTAMP:BTCUSD', help: 'Comma-separated EXCHANGE:TICKER list' },
      { key: 'displayMode', label: 'Display', type: 'select', default: 'adaptive', options: [
        { value: 'adaptive', label: 'Adaptive' }, { value: 'regular', label: 'Regular' }, { value: 'compact', label: 'Compact' },
      ] },
      { key: 'logos', label: 'Symbol logos', type: 'select', default: 'show', options: [{ value: 'show', label: 'Show' }, { value: 'hide', label: 'Hide' }] },
      { key: 'background', label: 'Background', type: 'select', default: 'transparent', options: [{ value: 'transparent', label: 'Transparent' }, { value: 'solid', label: 'Solid' }] },
    ],
    build: (cfg) => {
      const list = (cfg.symbols || '').split(',').map((s) => s.trim()).filter(Boolean)
      const symbols = (list.length ? list : ['NASDAQ:AAPL']).join(',')
      const displayMode = cfg.displayMode || 'adaptive'
      const logos = (cfg.logos || 'show') === 'show'
      const transparent = (cfg.background || 'transparent') === 'transparent'
      // TradingView's web-component embed (handles dark + transparent properly).
      // Create the element with theme ALREADY set (from the app's data-theme)
      // BEFORE loading their module, so the dark theme applies on first render.
      const html = [
        '<div id="tt-host" style="width:100%;height:100%"></div>',
        '<script>(function(){',
        "var d=document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';",
        "var el=document.createElement('tv-ticker-tape');",
        `el.setAttribute('symbols',${js(symbols)});`,
        "el.setAttribute('theme',d);",
        `el.setAttribute('display-mode',${js(displayMode)});`,
        `el.setAttribute('show-symbol-logo',${js(String(logos))});`,
        transparent ? "el.setAttribute('transparent','');" : '',
        "document.getElementById('tt-host').appendChild(el);",
        "var s=document.createElement('script');s.type='module';s.src='https://widgets.tradingview-widget.com/w/en/tv-ticker-tape.js';document.body.appendChild(s);",
        '})();</script>',
      ].join('\n')
      return { name: cfg.name?.trim() || 'Ticker tape', type: 'embed', html }
    },
  },
  {
    id: 'single-quote',
    name: 'Live Quote',
    icon: '💹',
    category: 'markets',
    tagline: 'One symbol, price + change',
    description: 'A compact live quote tile: current price and daily change for a single symbol.',
    size: { w: 2, h: 1 },
    fields: [
      { key: 'symbol', label: 'Symbol', type: 'text', default: 'TSX:LOVE', placeholder: 'TSX:LOVE', help: 'EXCHANGE:TICKER' },
    ],
    build: (cfg) => {
      const symbol = (cfg.symbol || 'TSX:LOVE').trim()
      const expr = `{symbol:${js(symbol)},width:"100%",colorTheme:THEME,isTransparent:false,locale:"en"}`
      return { name: cfg.name?.trim() || `${symbol} quote`, type: 'kpi', html: tvBlock('embed-widget-single-quote.js', expr) }
    },
  },
  {
    id: 'market-overview',
    name: 'Market Overview',
    icon: '🌐',
    category: 'markets',
    tagline: 'Indices, FX & crypto at a glance',
    description: 'A multi-tab market snapshot — major indices, crypto and forex with mini charts.',
    size: { w: 2, h: 3 },
    fields: [],
    build: (cfg) => {
      const expr = `{colorTheme:THEME,dateRange:"12M",showChart:true,locale:"en",isTransparent:false,width:"100%",height:"100%",showSymbolLogo:true,tabs:[{title:"Indices",symbols:[{s:"FOREXCOM:SPXUSD",d:"S&P 500"},{s:"FOREXCOM:NSXUSD",d:"Nasdaq 100"},{s:"INDEX:DJI",d:"Dow 30"},{s:"FOREXCOM:UKXGBP",d:"FTSE 100"}]},{title:"Crypto",symbols:[{s:"BITSTAMP:BTCUSD",d:"Bitcoin"},{s:"BITSTAMP:ETHUSD",d:"Ethereum"}]},{title:"Forex",symbols:[{s:"FX:EURUSD",d:"EUR/USD"},{s:"FX:USDCAD",d:"USD/CAD"}]}]}`
      return { name: cfg.name?.trim() || 'Market overview', type: 'chart', html: tvBlock('embed-widget-market-overview.js', expr) }
    },
  },
  {
    id: 'open-canada',
    name: 'Open Canada Dataset',
    icon: '🇨🇦',
    category: 'data',
    tagline: 'Live Government of Canada open data',
    description: 'Render any Government of Canada open dataset as a live table — pass a CKAN resource id and an optional keyword filter, and the latest records appear right on your dashboard. Defaults to Health Canada cannabis market data.',
    size: { w: 4, h: 3 },
    fields: [
      { key: 'resourceId', label: 'Resource ID', type: 'text', default: '2f960711-2447-472d-81b0-731fdfbf59a1', help: 'CKAN resource_id from open.canada.ca (the default is Health Canada cannabis market data).' },
      { key: 'q', label: 'Keyword filter (optional)', type: 'text', placeholder: 'e.g. dried' },
      { key: 'limit', label: 'Rows', type: 'number', default: '25' },
    ],
    build: (cfg) => {
      const rid = (cfg.resourceId || '2f960711-2447-472d-81b0-731fdfbf59a1').trim()
      const qv = (cfg.q || '').trim()
      const limit = Math.min(Math.max(parseInt(cfg.limit || '25', 10) || 25, 1), 100)
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const api = `${origin}/api/open-data/ckan`
      const html = [
        '<div style="height:100%;display:flex;flex-direction:column;font-family:inherit;color:var(--ink)">',
        '<div id="oc-head" style="font-size:12px;color:var(--mut);margin-bottom:8px">Loading Open Canada data…</div>',
        '<div id="oc-body" style="flex:1;overflow:auto"></div>',
        '<div style="font-size:10px;color:var(--mut2);margin-top:6px">Source: Open Government Canada · datastore_search</div>',
        '</div>',
        '<script>(function(){',
        `var API=${js(api)},RID=${js(rid)},Q=${js(qv)},LIMIT=${limit};`,
        'function esc(s){return String(s).replace(/[&<>]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[c]})}',
        'var u=API+"?resource_id="+encodeURIComponent(RID)+"&limit="+LIMIT+(Q?("&q="+encodeURIComponent(Q)):"");',
        'fetch(u).then(function(r){return r.json()}).then(function(j){',
        'if(!j||!j.success||!j.result){throw new Error((j&&j.error)||"No data")}',
        'var res=j.result,recs=res.records||[];',
        'var cols=(res.fields||[]).map(function(f){return f.id}).filter(function(id){return id!=="_id"});',
        'if(!cols.length&&recs[0]){cols=Object.keys(recs[0]).filter(function(k){return k!=="_id"})}',
        'document.getElementById("oc-head").textContent=(res.total!=null?Number(res.total).toLocaleString()+" records":recs.length+" records")+(Q?(" · \\""+Q+"\\""):"");',
        'if(!recs.length){document.getElementById("oc-body").textContent="No records.";return}',
        'var h="<table style=\\"width:100%;border-collapse:collapse;font-size:12px\\"><thead><tr>"+cols.map(function(c){return "<th style=\\"text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--card);font-size:10px;letter-spacing:.03em;text-transform:uppercase;color:var(--mut);white-space:nowrap\\">"+esc(c.replace(/_/g," "))+"</th>"}).join("")+"</tr></thead><tbody>";',
        'recs.forEach(function(row){h+="<tr>"+cols.map(function(c){return "<td style=\\"padding:5px 8px;border-bottom:1px solid var(--line);white-space:nowrap\\">"+esc(row[c]==null?"":row[c])+"</td>"}).join("")+"</tr>"});',
        'h+="</tbody></table>";document.getElementById("oc-body").innerHTML=h;',
        '}).catch(function(e){document.getElementById("oc-head").textContent="Could not load Open Canada data: "+e.message});',
        '})();</script>',
      ].join('\n')
      return { name: cfg.name?.trim() || 'Open Canada dataset', type: 'table', html }
    },
  },
  {
    id: 'gdelt-news',
    name: 'GDELT News',
    icon: '🌍',
    category: 'news',
    tagline: 'Global news monitor (keyless)',
    description: 'Live global news from the GDELT Project — searches worldwide coverage for any keyword. No API key required.',
    size: { w: 4, h: 4 },
    fields: [
      { key: 'query', label: 'Search', type: 'text', default: 'cannabis', placeholder: 'e.g. cannabis Canada' },
      { key: 'limit', label: 'Articles', type: 'number', default: '25' },
    ],
    build: (cfg) => {
      const q = (cfg.query || 'cannabis').trim()
      const n = Math.min(Math.max(parseInt(cfg.limit || '25', 10) || 25, 1), 75)
      const urlJs = `"https://api.gdeltproject.org/api/v2/doc/doc?mode=ArtList&format=json&sort=DateDesc&maxrecords=${n}&query="+encodeURIComponent(${js(q)})`
      const mapJs = 'function(j){return (j.articles||[]).map(function(a){return {title:a.title,url:a.url,source:a.domain,date:a.seendate,desc:""}})}'
      return { name: cfg.name?.trim() || `GDELT — ${q}`, type: 'table', html: newsFrame(urlJs, mapJs, 'Enter a search term.') }
    },
  },
  {
    id: 'currents-news',
    name: 'Currents News',
    icon: '🗞️',
    category: 'news',
    tagline: 'Latest news via Currents API',
    description: 'Search the latest world news with the Currents API. Add your free API key from currentsapi.services in this block\'s settings.',
    size: { w: 4, h: 4 },
    fields: [
      { key: 'apiKey', label: 'Currents API key', type: 'text', placeholder: 'your apiKey', help: 'Free key from currentsapi.services.', helpUrl: 'https://currentsapi.services/en/register', helpLabel: 'Get a free key →' },
      { key: 'query', label: 'Keywords', type: 'text', default: 'cannabis', placeholder: 'e.g. cannabis' },
      { key: 'language', label: 'Language', type: 'text', default: 'en' },
    ],
    build: (cfg) => {
      const key = (cfg.apiKey || '').trim()
      const q = (cfg.query || 'cannabis').trim()
      const lang = (cfg.language || 'en').trim()
      const urlJs = key
        ? `"https://api.currentsapi.services/v1/search?language=${encodeURIComponent(lang)}&keywords="+encodeURIComponent(${js(q)})+"&apiKey="+encodeURIComponent(${js(key)})`
        : 'null'
      const mapJs = 'function(j){return (j.news||[]).map(function(a){return {title:a.title,url:a.url,source:a.author,date:a.published,desc:a.description}})}'
      return { name: cfg.name?.trim() || `Currents — ${q}`, type: 'table', html: newsFrame(urlJs, mapJs, 'Add your Currents API key in settings.') }
    },
  },
  {
    id: 'gnews-news',
    name: 'GNews',
    icon: '📰',
    category: 'news',
    tagline: 'Headlines via GNews API',
    description: 'Search world headlines with the GNews API. Add your free API key from gnews.io in this block\'s settings.',
    size: { w: 4, h: 4 },
    fields: [
      { key: 'apiKey', label: 'GNews API key', type: 'text', placeholder: 'your apikey', help: 'Free key from gnews.io.', helpUrl: 'https://gnews.io/register', helpLabel: 'Get a free key →' },
      { key: 'query', label: 'Search', type: 'text', default: 'cannabis', placeholder: 'e.g. cannabis' },
      { key: 'lang', label: 'Language', type: 'text', default: 'en' },
      { key: 'limit', label: 'Articles', type: 'number', default: '10' },
    ],
    build: (cfg) => {
      const key = (cfg.apiKey || '').trim()
      const q = (cfg.query || 'cannabis').trim()
      const lang = (cfg.lang || 'en').trim()
      const n = Math.min(Math.max(parseInt(cfg.limit || '10', 10) || 10, 1), 50)
      const urlJs = key
        ? `"https://gnews.io/api/v4/search?lang=${encodeURIComponent(lang)}&max=${n}&q="+encodeURIComponent(${js(q)})+"&apikey="+encodeURIComponent(${js(key)})`
        : 'null'
      const mapJs = 'function(j){return (j.articles||[]).map(function(a){return {title:a.title,url:a.url,source:a.source&&a.source.name,date:a.publishedAt,desc:a.description}})}'
      return { name: cfg.name?.trim() || `GNews — ${q}`, type: 'table', html: newsFrame(urlJs, mapJs, 'Add your GNews API key in settings.') }
    },
  },
  {
    id: 'guardian-news',
    name: 'The Guardian',
    icon: '📙',
    category: 'news',
    tagline: 'Articles from The Guardian',
    description: 'Search The Guardian\'s Open Platform. Add your free API key from open-platform.theguardian.com in this block\'s settings.',
    size: { w: 4, h: 4 },
    fields: [
      { key: 'apiKey', label: 'Guardian API key', type: 'text', placeholder: 'your api-key', help: 'Free key from open-platform.theguardian.com.', helpUrl: 'https://open-platform.theguardian.com/access/', helpLabel: 'Get a free key →' },
      { key: 'query', label: 'Search', type: 'text', default: 'cannabis', placeholder: 'e.g. cannabis' },
      { key: 'limit', label: 'Articles', type: 'number', default: '20' },
    ],
    build: (cfg) => {
      const key = (cfg.apiKey || '').trim()
      const q = (cfg.query || 'cannabis').trim()
      const n = Math.min(Math.max(parseInt(cfg.limit || '20', 10) || 20, 1), 50)
      const urlJs = key
        ? `"https://content.guardianapis.com/search?show-fields=trailText&order-by=newest&page-size=${n}&q="+encodeURIComponent(${js(q)})+"&api-key="+encodeURIComponent(${js(key)})`
        : 'null'
      const mapJs = 'function(j){return ((j.response&&j.response.results)||[]).map(function(a){return {title:a.webTitle,url:a.webUrl,source:a.sectionName,date:a.webPublicationDate,desc:a.fields&&a.fields.trailText}})}'
      return { name: cfg.name?.trim() || `Guardian — ${q}`, type: 'table', html: newsFrame(urlJs, mapJs, 'Add your Guardian API key in settings.') }
    },
  },
  {
    id: 'newsapi-news',
    name: 'NewsAPI.org',
    icon: '🗒️',
    category: 'news',
    tagline: 'Headlines via NewsAPI.org',
    description: 'Search articles with NewsAPI.org. Add your free API key from newsapi.org in this block\'s settings. Note: NewsAPI\'s free plan only allows browser requests from localhost.',
    size: { w: 4, h: 4 },
    fields: [
      { key: 'apiKey', label: 'NewsAPI key', type: 'text', placeholder: 'your apiKey', help: 'Free key from newsapi.org. Free plan blocks production browser requests (localhost only).', helpUrl: 'https://newsapi.org/register', helpLabel: 'Get a free key →' },
      { key: 'query', label: 'Search', type: 'text', default: 'cannabis', placeholder: 'e.g. cannabis' },
      { key: 'limit', label: 'Articles', type: 'number', default: '20' },
    ],
    build: (cfg) => {
      const key = (cfg.apiKey || '').trim()
      const q = (cfg.query || 'cannabis').trim()
      const n = Math.min(Math.max(parseInt(cfg.limit || '20', 10) || 20, 1), 50)
      const urlJs = key
        ? `"https://newsapi.org/v2/everything?language=en&sortBy=publishedAt&pageSize=${n}&q="+encodeURIComponent(${js(q)})+"&apiKey="+encodeURIComponent(${js(key)})`
        : 'null'
      const mapJs = 'function(j){return (j.articles||[]).map(function(a){return {title:a.title,url:a.url,source:a.source&&a.source.name,date:a.publishedAt,desc:a.description}})}'
      return { name: cfg.name?.trim() || `NewsAPI — ${q}`, type: 'table', html: newsFrame(urlJs, mapJs, 'Add your NewsAPI key in settings.') }
    },
  },
  {
    id: 'windy-webcam',
    name: 'Windy Webcam',
    icon: '📷',
    category: 'web',
    tagline: 'Live webcam from Windy',
    description: 'Embed a live Windy.com webcam. Open settings to find one by location (uses your Windy API key from Settings → APIs) or paste a webcam ID and Load it — the official player URL comes from the Windy API.',
    size: { w: 3, h: 3 },
    fields: [
      { key: 'autoplay', label: 'Autoplay', type: 'select', default: 'yes', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    ],
    build: (cfg) => {
      // The embed URL is resolved from the Windy API (cfg.embedUrl) — never built
      // by hand (hand-built player paths 404 / resolve as app routes).
      const embed = (cfg.embedUrl || '').trim()
      if (!embed) {
        const html = '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-family:inherit;color:var(--mut);text-align:center;padding:16px;line-height:1.5">📷 Open this block\'s settings to find a Windy webcam (by location or ID).</div>'
        return { name: cfg.name?.trim() || 'Windy webcam', type: 'embed', html }
      }
      const auto = (cfg.autoplay || 'yes') === 'yes'
      const src = auto ? `${embed}${embed.includes('?') ? '&' : '?'}autoplay=1` : embed
      const html = `<iframe src="${src.replace(/"/g, '&quot;')}" style="width:100%;height:100%;border:0;display:block;background:transparent" allow="autoplay; fullscreen" referrerpolicy="no-referrer" loading="lazy"></iframe>`
      return { name: cfg.name?.trim() || 'Windy webcam', type: 'embed', html }
    },
  },
  {
    id: 'website-embed',
    name: 'Website Embed',
    icon: '🔗',
    category: 'web',
    tagline: 'Embed any page or dashboard',
    description: 'Pin any external page, doc, or BI dashboard inside a Block via iframe.',
    size: { w: 6, h: 5 },
    fields: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com', help: 'Some sites block embedding (X-Frame-Options).' },
      { key: 'zoom', label: 'Zoom', type: 'select', default: '100', options: [
        { value: '50', label: '50%' }, { value: '67', label: '67%' }, { value: '75', label: '75%' }, { value: '90', label: '90%' },
        { value: '100', label: '100%' }, { value: '110', label: '110%' }, { value: '125', label: '125%' }, { value: '150', label: '150%' },
        { value: '175', label: '175%' }, { value: '200', label: '200%' },
      ], help: 'Zoom the embedded page in or out (it still fills the block).' },
    ],
    build: (cfg) => {
      const raw = (cfg.url || '').trim()
      // Ensure an absolute URL — a protocol-less src is treated as relative and
      // would load the app itself instead of the external site.
      const url = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw
      const safe = url.replace(/"/g, '&quot;')
      // Zoom via transform:scale — inverse-size the iframe so the scaled page
      // still fills the block (scale 0.75 → 133% box, scale 1.5 → 66.7% box).
      const z = (parseFloat(cfg.zoom || '100') || 100) / 100
      const dim = z !== 1
        ? `width:${(100 / z).toFixed(3)}%;height:${(100 / z).toFixed(3)}%;transform:scale(${z});transform-origin:0 0;`
        : 'width:100%;height:100%;'
      // Render the external site exactly as-is (no forced dark / color-scheme).
      const html = url
        ? `<iframe id="we" src="${safe}" style="${dim}border:0;display:block;background:transparent" loading="lazy" referrerpolicy="no-referrer"></iframe>`
        : '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-family:inherit;color:var(--mut);padding:16px;text-align:center">🔗 Add a URL in this block\'s settings.</div>'
      let host = url
      try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* keep raw */ }
      return { name: cfg.name?.trim() || host || 'Website', type: 'embed', html }
    },
  },
  {
    id: 'youtube',
    name: 'YouTube',
    icon: '▶️',
    category: 'web',
    tagline: 'Video or live stream',
    description: 'Embed a YouTube video or a live stream. Paste a video/live URL, a video ID, or a channel ID (UC…) to show that channel\'s current live stream.',
    size: { w: 4, h: 3 },
    fields: [
      { key: 'source', label: 'YouTube URL / video ID / channel ID', type: 'text', placeholder: 'https://youtube.com/watch?v=… or UC…', help: 'A watch/live/youtu.be URL, an 11-char video ID, or a channel ID (UC…) for its live stream.' },
      { key: 'autoplay', label: 'Autoplay', type: 'select', default: 'no', options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes (muted)' }] },
      { key: 'mute', label: 'Start muted', type: 'select', default: 'no', options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }] },
    ],
    build: (cfg) => {
      const raw = (cfg.source || '').trim()
      const autoplay = (cfg.autoplay || 'no') === 'yes'
      const mute = autoplay || (cfg.mute || 'no') === 'yes' // autoplay requires mute
      // Resolve to an /embed URL: video (by URL or 11-char id) or channel live stream.
      const v = raw.match(/(?:[?&]v=|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/)
      const ch = raw.match(/(?:channel\/|[?&]channel=)(UC[\w-]{20,})/)
      let src = ''
      if (v) src = `https://www.youtube.com/embed/${v[1]}`
      else if (ch) src = `https://www.youtube.com/embed/live_stream?channel=${ch[1]}`
      else if (/^UC[\w-]{20,}$/.test(raw)) src = `https://www.youtube.com/embed/live_stream?channel=${raw}`
      else if (/^[\w-]{11}$/.test(raw)) src = `https://www.youtube.com/embed/${raw}`
      if (!src) {
        const html = '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-family:inherit;color:var(--mut);padding:16px;text-align:center">▶️ Add a YouTube URL, video ID, or channel ID in this block\'s settings.</div>'
        return { name: cfg.name?.trim() || 'YouTube', type: 'embed', html }
      }
      const params = [autoplay ? 'autoplay=1' : '', mute ? 'mute=1' : '', 'rel=0'].filter(Boolean).join('&')
      const full = `${src}${src.includes('?') ? '&' : '?'}${params}`
      const html = `<iframe src="${full.replace(/"/g, '&quot;')}" style="width:100%;height:100%;border:0;display:block" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
      return { name: cfg.name?.trim() || 'YouTube', type: 'embed', html }
    },
  },
  {
    id: 'world-clock',
    name: 'World Clock',
    icon: '🕐',
    category: 'utility',
    tagline: 'Live time for any timezone',
    description: 'A live clock for any IANA timezone — handy for distributed teams and market hours.',
    size: { w: 2, h: 2 },
    fields: [
      { key: 'timezone', label: 'Timezone', type: 'text', default: 'America/New_York', help: 'IANA name, e.g. Europe/London, Asia/Tokyo' },
      { key: 'label', label: 'Label (optional)', type: 'text', placeholder: 'New York' },
    ],
    build: (cfg) => {
      const tz = (cfg.timezone || 'America/New_York').trim()
      const label = (cfg.label || '').trim() || tz.split('/').pop()!.replace(/_/g, ' ')
      const html = [
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:4px;font-family:inherit">',
        '<div id="clk" style="font-size:40px;font-weight:800;letter-spacing:-.02em;color:var(--ink);font-variant-numeric:tabular-nums"></div>',
        '<div id="dt" style="font-size:13px;color:var(--mut)"></div>',
        `<div style="font-size:12px;color:var(--cyan);font-weight:700">${label.replace(/</g, '&lt;')}</div>`,
        '</div>',
        '<script>(function(){var tz=' + js(tz) + ';function t(){try{var n=new Date();document.getElementById("clk").textContent=n.toLocaleTimeString("en-US",{timeZone:tz,hour:"2-digit",minute:"2-digit",second:"2-digit"});document.getElementById("dt").textContent=n.toLocaleDateString("en-US",{timeZone:tz,weekday:"long",month:"short",day:"numeric"})}catch(e){document.getElementById("clk").textContent="Bad timezone"}}t();setInterval(t,1000)})();</script>',
      ].join('\n')
      return { name: cfg.name?.trim() || `${label} clock`, type: 'embed', html }
    },
  },
]

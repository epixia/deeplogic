// Product scraping — pull a company's actual retail products from its own site.
// Structured data (JSON-LD Product, common on retail/e-commerce sites) gives
// real names, images, prices, descriptions & links; the stripped page text is
// returned too for AI fallback extraction on sites without structured data.

export interface ScrapedProduct {
  name: string
  category?: string
  description?: string
  price?: string
  imageUrl?: string
  url?: string
}

// A real browser UA + common age-gate / consent cookies — many cannabis &
// alcohol sites gate their catalogue behind a cookie check; sending these often
// returns the real page without needing a headless browser.
const UA: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cookie': 'age_gate=true; ageGate=true; age_verified=true; ageVerified=true; isOldEnough=true; over21=true; over19=true; ageConfirmed=yes',
}

async function fetchHtml(url: string, timeoutMs = 12_000): Promise<string> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const ct = r.headers.get('content-type') ?? ''
  if (!ct.includes('html') && !ct.includes('text')) throw new Error('not html')
  return (await r.text()).slice(0, 800_000)
}

// Fetch any text resource (used for XML sitemaps).
async function fetchText(url: string, timeoutMs = 12_000): Promise<string> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.text()).slice(0, 1_200_000)
}

// Discover product page URLs from a site's sitemap(s). Product pages usually
// carry SSR'd JSON-LD / og:image even when the storefront listing is JS-rendered,
// so this gets past client-side rendering without a browser.
async function sitemapProductUrls(origin: string): Promise<string[]> {
  const entries = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap_products_1.xml', '/product-sitemap.xml']
  const isProduct = (u: string) => /\/(products?|shop|store|item)\//i.test(u)
  const locs = (xml: string) => Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => m[1])
  const products = new Set<string>()
  const subMaps = new Set<string>()
  for (const e of entries) {
    if (products.size >= 30) break
    try {
      for (const loc of locs(await fetchText(origin + e))) {
        if (/sitemap[^/]*\.xml/i.test(loc)) subMaps.add(loc)
        else if (isProduct(loc)) products.add(loc.split('#')[0])
      }
    } catch { /* try next entry */ }
  }
  for (const sm of [...subMaps].filter((s) => /product/i.test(s)).slice(0, 3)) {
    if (products.size >= 40) break
    try {
      for (const loc of locs(await fetchText(sm))) if (isProduct(loc)) products.add(loc.split('#')[0])
    } catch { /* skip */ }
  }
  return [...products]
}

function abs(base: string, href: string): string | undefined {
  try { return new URL(href, base).toString() } catch { return undefined }
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function priceStr(offer: any): string | undefined {
  const o = Array.isArray(offer) ? offer[0] : offer
  if (!o || typeof o !== 'object') return undefined
  const p = o.price ?? o.lowPrice ?? o.priceSpecification?.price
  if (p == null || p === '') return undefined
  const cur = o.priceCurrency ?? o.priceSpecification?.priceCurrency ?? ''
  return `${cur ? cur + ' ' : ''}${p}`
}

function firstImage(image: any): string | undefined {
  if (!image) return undefined
  if (typeof image === 'string') return image
  if (Array.isArray(image)) return typeof image[0] === 'string' ? image[0] : image[0]?.url
  if (typeof image === 'object') return image.url
  return undefined
}

function collectProducts(node: any, baseUrl: string, out: ScrapedProduct[]): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) collectProducts(n, baseUrl, out); return }
  const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']]
  if (types.includes('Product')) {
    const name = String(node.name ?? '').trim()
    if (name) {
      const img = firstImage(node.image)
      out.push({
        name: name.slice(0, 160),
        category: typeof node.category === 'string' ? node.category.slice(0, 80) : undefined,
        description: typeof node.description === 'string' ? stripTags(node.description).slice(0, 300) : undefined,
        price: priceStr(node.offers),
        imageUrl: img ? abs(baseUrl, img) : undefined,
        url: node.url ? abs(baseUrl, String(node.url)) : undefined,
      })
    }
  }
  // Recurse into common JSON-LD containers.
  if (node['@graph']) collectProducts(node['@graph'], baseUrl, out)
  if (node.itemListElement) collectProducts(node.itemListElement, baseUrl, out)
  if (node.item) collectProducts(node.item, baseUrl, out)
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function parseJsonLd(html: string, baseUrl: string): ScrapedProduct[] {
  const out: ScrapedProduct[] = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    try { collectProducts(JSON.parse(m[1].trim()), baseUrl, out) } catch { /* skip bad json */ }
  }
  return out
}

// Links that likely lead to product / shop / collection / brand pages.
function productLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>()
  const re = /href=["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const href = m[1]
    if (/(products?|shop|store|collections?|menu|strains?|catalog|brands?|our-products|portfolio|product-category)/i.test(href)) {
      const u = abs(baseUrl, href)
      if (u && u.startsWith('http')) links.add(u.split('#')[0].split('?')[0])
    }
  }
  return [...links]
}

// OpenGraph image — the main product photo on a single-product page.
function parseOgImage(html: string, baseUrl: string): string | undefined {
  const m =
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html)
  return m ? abs(baseUrl, m[1]) : undefined
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Shopify exposes a public products.json on most storefronts — the richest,
// most reliable source of names, images, prices & descriptions.
async function tryShopifyJson(origin: string): Promise<ScrapedProduct[]> {
  try {
    const r = await fetch(`${origin}/products.json?limit=100`, { headers: UA, signal: AbortSignal.timeout(12_000) })
    if (!r.ok) return []
    if (!(r.headers.get('content-type') ?? '').includes('json')) return []
    const j = (await r.json()) as { products?: any[] }
    if (!Array.isArray(j.products)) return []
    return j.products
      .map((p) => {
        const variant = Array.isArray(p.variants) ? p.variants[0] : null
        const img = (Array.isArray(p.images) && p.images[0]?.src) || p.image?.src
        return {
          name: String(p.title ?? '').trim().slice(0, 160),
          category: typeof p.product_type === 'string' && p.product_type ? p.product_type.slice(0, 80) : undefined,
          description: typeof p.body_html === 'string' ? stripTags(p.body_html).slice(0, 300) : undefined,
          price: variant?.price ? `$${variant.price}` : undefined,
          imageUrl: typeof img === 'string' ? img : undefined,
          url: p.handle ? `${origin}/products/${p.handle}` : undefined,
        } as ScrapedProduct
      })
      .filter((x) => x.name)
  } catch {
    return []
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function dedupe(products: ScrapedProduct[]): ScrapedProduct[] {
  const byName = new Map<string, ScrapedProduct>()
  for (const p of products) {
    const k = p.name.toLowerCase()
    if (!byName.has(k)) byName.set(k, p)
  }
  return [...byName.values()]
}

// Fetch a set of pages, parse JSON-LD products from each, and collect text.
export async function scrapeUrls(urls: string[], cap = 6): Promise<{ products: ScrapedProduct[]; text: string }> {
  const products: ScrapedProduct[] = []
  const texts: string[] = []
  const seen = new Set<string>()
  const origins = new Set<string>()
  let n = 0
  for (const url of urls) {
    if (n >= cap) break
    const key = url.split('#')[0]
    if (seen.has(key)) continue
    seen.add(key)
    n++
    try {
      const h = await fetchHtml(url)
      const pageProducts = parseJsonLd(h, url)
      // On a single-product page, fill a missing image from og:image.
      if (pageProducts.length === 1 && !pageProducts[0].imageUrl) {
        const og = parseOgImage(h, url)
        if (og) pageProducts[0].imageUrl = og
      }
      products.push(...pageProducts)
      texts.push(stripTags(h).slice(0, 5000))
      try { origins.add(new URL(url).origin) } catch { /* ignore */ }
    } catch { /* skip unreachable page */ }
  }
  // Probe each unique storefront's Shopify products.json (rich images + prices).
  let shops = 0
  for (const origin of origins) {
    if (shops >= 3) break
    shops++
    const sp = await tryShopifyJson(origin)
    if (sp.length) products.push(...sp)
  }
  return { products: dedupe(products).slice(0, 40), text: texts.join('\n\n').slice(0, 16000) }
}

// Best-effort image for a single page — OpenGraph first, then any JSON-LD
// product image. Used to enrich AI-extracted products that lack a thumbnail.
export async function fetchPageImage(url: string): Promise<string | undefined> {
  try {
    const h = await fetchHtml(url, 8000)
    return parseOgImage(h, url) ?? parseJsonLd(h, url).find((p) => p.imageUrl)?.imageUrl
  } catch {
    return undefined
  }
}

// Scrape the homepage + product pages from links AND the sitemap. The sitemap
// is key for JS-rendered storefronts where the listing has no products in HTML
// but individual product pages are server-rendered.
export async function scrapeProducts(website: string): Promise<{ products: ScrapedProduct[]; text: string }> {
  let base = website.trim()
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`
  let origin = base
  try { origin = new URL(base).origin } catch { /* keep base */ }

  let home = ''
  try { home = await fetchHtml(base) } catch { /* may still have a sitemap */ }

  const linked = home ? productLinks(home, base).slice(0, 5) : []
  const fromSitemap = await sitemapProductUrls(origin).catch(() => [] as string[])
  // Prefer linked collection pages first, then sitemap product pages.
  const candidates = [base, ...linked, ...fromSitemap.slice(0, 12)]
  return scrapeUrls(candidates, 14)
}

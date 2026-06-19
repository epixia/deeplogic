// SiteInsights — a details page for any tracked website (competitor or your own).
// Shows what's freely available: site metadata, domain age (WHOIS/RDAP), an AI
// company overview + facts, and web sources. Traffic/keyword rankings need a
// paid data provider — surfaced honestly with an upgrade note.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { getSiteInsights, persistSiteInsights, type SiteInsights as SI } from '../lib/api'
import './site-insights.css'

// Reference matrix of the data providers that fill in the metrics this page can't
// get for free. Costs are approximate published list prices (entry tier) — kept
// as a static table so users can compare before connecting one.
type Provider = {
  name: string
  coverage: string[]
  price: string
  free: string
  bestFor: string
}
const PROVIDERS: Provider[] = [
  {
    name: 'SimilarWeb',
    coverage: ['Unique visitors', 'Traffic trends', 'Traffic sources', 'Audience'],
    price: '~$125/mo (Starter), Enterprise for API',
    free: 'Limited free web view; API is paid only',
    bestFor: 'Competitor traffic & visitor estimates',
  },
  {
    name: 'Semrush',
    coverage: ['Keyword rankings', 'Traffic est.', 'Keywords', 'Ads', 'Backlinks'],
    price: '~$140/mo (Pro)',
    free: '~10 free UI lookups/day; API is paid (Business ~$500/mo + API units)',
    bestFor: 'All-in-one SEO + traffic in one tool',
  },
  {
    name: 'Ahrefs',
    coverage: ['Keyword rankings', 'Backlinks', 'Organic traffic est.', 'Keywords'],
    price: '~$129/mo (Lite)',
    free: 'Free Webmaster Tools (own site only); paid API',
    bestFor: 'Deepest backlinks & ranking data',
  },
  {
    name: 'Moz Pro',
    coverage: ['Domain Authority', 'Keyword rankings', 'Backlinks'],
    price: '~$99/mo (Standard)',
    free: 'Free MozBar + limited queries; paid API',
    bestFor: 'Domain Authority & lighter SEO budgets',
  },
  {
    name: 'Google Analytics',
    coverage: ['Unique visitors', 'Traffic sources', 'Conversions'],
    price: 'Free (GA4)',
    free: 'Fully free + free API — your own sites only',
    bestFor: 'Your own site’s real traffic',
  },
  {
    name: 'RDAP / WHOIS',
    coverage: ['Age of site', 'Registrar', 'Domain status'],
    price: 'Free',
    free: 'Fully free, no key — already used here',
    bestFor: 'Domain age & registration (built in)',
  },
]

export default function SiteInsights() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  const [params] = useSearchParams()
  const url = params.get('url') ?? ''
  const compName = params.get('name') ?? ''
  const { getAccessToken } = useAuth()

  const [data, setData] = useState<SI | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ dashboardId: string | null; itemId: string | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const savedFor = useRef<string>('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      setData(await getSiteInsights(t, orgId, url))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load insights.')
    } finally { setLoading(false) }
  }, [getAccessToken, orgId, url])

  // Persist the insights to the DB + Data Vault (.md) and, by default, add a card
  // to this competitor's dashboard.
  const save = useCallback(async (toDashboard: boolean) => {
    if (saving || !url) return
    setSaving(true)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const res = await persistSiteInsights(t, orgId, { url, name: compName || undefined, toDashboard })
      setSaved({ dashboardId: res.dashboardId, itemId: res.itemId })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save insights.')
    } finally { setSaving(false) }
  }, [getAccessToken, orgId, url, compName, saving])

  useEffect(() => { if (url) void load() }, [load, url])

  // By default, once insights load, store them and add to the competitor's
  // dashboard — one auto-save per url per visit (idempotent server-side).
  useEffect(() => {
    if (!data || !url || savedFor.current === url) return
    savedFor.current = url
    void save(true)
  }, [data, url, save])

  const domain = data?.domain ?? (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } })()
  const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`

  return (
    <main className="wrap si">
      <Link to={`/app/${orgId}/vault`} className="si-back">← Data Vault</Link>

      <header className="si-head">
        <img className="si-favicon" src={favicon} alt="" width={40} height={40} />
        <div className="si-head-text">
          <h1>{data?.title || domain}</h1>
          {url && <a className="si-domain" href={url} target="_blank" rel="noreferrer">{domain} ↗</a>}
        </div>
        <button className="btn btn-ghost btn-xs" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : '↻ Refresh'}</button>
      </header>

      {error && <div className="studio-error">{error}</div>}
      {!url && <div className="si-empty">No website specified.</div>}

      {url && (
        <div className="si-saved">
          {saving ? (
            <span>💾 Saving to Data Vault &amp; dashboard…</span>
          ) : saved ? (
            <>
              <span>✓ Saved to Data Vault{saved.dashboardId ? ' & added to this competitor’s dashboard' : ''}.</span>
              {saved.dashboardId && <Link className="si-saved-link" to={`/app/${orgId}/dashboards/${saved.dashboardId}`}>Open dashboard ↗</Link>}
              <button className="si-saved-link as-btn" onClick={() => void save(true)} disabled={saving}>↻ Re-save</button>
            </>
          ) : (
            <button className="si-saved-link as-btn" onClick={() => void save(true)} disabled={saving}>💾 Save to Vault &amp; dashboard</button>
          )}
        </div>
      )}

      {loading && !data ? (
        <div className="si-empty">Gathering insights…</div>
      ) : data && (
        <>
          {data.overview && (
            <section className="si-card">
              <h2>Overview</h2>
              <p className="si-overview">{data.overview}</p>
              {!data.usedAI && <p className="si-note">AI is not configured — overview is limited. Add a provider in Settings → AI providers.</p>}
            </section>
          )}

          <div className="si-grid">
            {/* Domain age */}
            <section className="si-card si-metric">
              <span className="si-metric-label">Age of site</span>
              {data.age ? (
                <>
                  <span className="si-metric-value">{data.age.ageYears} yrs</span>
                  <span className="si-metric-sub">Registered {new Date(data.age.createdAt).toLocaleDateString()}</span>
                </>
              ) : (
                <span className="si-metric-sub">Registration date not available</span>
              )}
            </section>

            {/* Traffic — honest about provider need */}
            <section className="si-card si-metric">
              <span className="si-metric-label">Unique visitors / month</span>
              {(() => {
                const t = data.facts.find((f) => /traffic|visitor/i.test(f.label))
                return t
                  ? <span className="si-metric-value si-est">{t.value}</span>
                  : <span className="si-metric-sub">Needs a traffic provider (SimilarWeb / Semrush)</span>
              })()}
              <span className="si-metric-sub">Live numbers require a connected analytics provider.</span>
            </section>

            {/* Search rankings */}
            <section className="si-card si-metric">
              <span className="si-metric-label">Search keyword rankings</span>
              <span className="si-metric-sub">Needs an SEO provider (Semrush / Ahrefs) to show ranked terms.</span>
            </section>
          </div>

          {data.facts.length > 0 && (
            <section className="si-card">
              <h2>Company facts</h2>
              <dl className="si-facts">
                {data.facts.map((f, i) => (
                  <div className="si-fact" key={i}><dt>{f.label}</dt><dd>{f.value}</dd></div>
                ))}
              </dl>
            </section>
          )}

          {data.sources.length > 0 && (
            <section className="si-card">
              <h2>Around the web</h2>
              <ul className="si-sources">
                {data.sources.map((s, i) => (
                  <li key={i}>
                    <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                    {s.snippet && <span className="si-source-snip">{s.snippet}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="si-card">
            <h2>Connect a data provider</h2>
            <p className="si-note">
              Live <strong>unique visitors</strong>, <strong>traffic trends</strong> and <strong>keyword rankings</strong> aren’t
              free data — they come from a paid provider. Compare the options below, then connect one in Settings → Data providers.
            </p>
            <div className="si-matrix-scroll">
              <table className="si-matrix">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Data coverage</th>
                    <th>Price / month</th>
                    <th>Free tier / API</th>
                    <th>Best for</th>
                  </tr>
                </thead>
                <tbody>
                  {PROVIDERS.map((p) => (
                    <tr key={p.name}>
                      <th scope="row">{p.name}</th>
                      <td>
                        <div className="si-chips">
                          {p.coverage.map((c) => <span className="si-chip" key={c}>{c}</span>)}
                        </div>
                      </td>
                      <td className="si-price">{p.price}</td>
                      <td className="si-free">{p.free}</td>
                      <td>{p.bestFor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="si-note">Prices are approximate published entry-tier list prices and may change — check each provider for current rates.</p>
          </section>
        </>
      )}
    </main>
  )
}

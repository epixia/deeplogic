// SiteInsights — a details page for any tracked website (competitor or your own).
// Shows what's freely available: site metadata, domain age (WHOIS/RDAP), an AI
// company overview + facts, and web sources. Traffic/keyword rankings need a
// paid data provider — surfaced honestly with an upgrade note.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  getSiteInsights,
  persistSiteInsights,
  getDomainIntel,
  fetchDomainIntel,
  type SiteInsights as SI,
  type DomainIntel,
} from '../lib/api'
import IntelTrafficChart from '../components/vault/IntelTrafficChart'
import './site-insights.css'

// Compact number formatting for SEO metrics (12345 → 12.3K).
function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${Math.round(n)}`
}

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

  // DataForSEO "online intel" — cached per domain in the DB. We read the cache on
  // load (no cost) and only hit DataForSEO when the user clicks Fetch / Re-fetch.
  const [intel, setIntel] = useState<DomainIntel | null>(null)
  const [intelFetchedAt, setIntelFetchedAt] = useState<string | null>(null)
  const [intelFetching, setIntelFetching] = useState(false)
  const [intelError, setIntelError] = useState<string | null>(null)

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      setData(await getSiteInsights(t, orgId, url, refresh))
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

  // Read cached intel from the DB whenever the target changes (no external call).
  useEffect(() => {
    if (!url) return
    let cancelled = false
    void (async () => {
      try {
        const t = await getAccessToken()
        if (!t) return
        const r = await getDomainIntel(t, orgId, url)
        if (!cancelled) { setIntel(r.intel); setIntelFetchedAt(r.fetchedAt) }
      } catch { /* cache miss is fine */ }
    })()
    return () => { cancelled = true }
  }, [getAccessToken, orgId, url])

  // Fetch fresh intel from DataForSEO and cache it (the only path with cost).
  const fetchIntel = useCallback(async () => {
    if (intelFetching || !url) return
    setIntelFetching(true); setIntelError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('Session expired')
      const r = await fetchDomainIntel(t, orgId, url)
      setIntel(r.intel); setIntelFetchedAt(r.fetchedAt)
    } catch (e) {
      setIntelError(e instanceof Error ? e.message : 'Failed to fetch intel.')
    } finally { setIntelFetching(false) }
  }, [getAccessToken, orgId, url, intelFetching])

  // On the FIRST gather of a url (cache miss), store the insights and add a card
  // to the competitor's dashboard. Cached revisits skip this — nothing to re-do.
  useEffect(() => {
    if (!data || !url || savedFor.current === url) return
    savedFor.current = url
    if (data.cached) return // already persisted when first gathered
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
        {data?.cachedAt && <span className="si-cached-stamp">Updated {new Date(data.cachedAt).toLocaleDateString()}</span>}
        <button className="btn btn-ghost btn-xs" onClick={() => void load(true)} disabled={loading}>{loading ? 'Loading…' : '↻ Refresh'}</button>
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

            {/* Estimated organic traffic — from DataForSEO when fetched */}
            <section className="si-card si-metric">
              <span className="si-metric-label">Est. organic traffic / mo</span>
              {intel?.overview.organicTraffic != null ? (
                <>
                  <span className="si-metric-value si-est">{fmtNum(intel.overview.organicTraffic)}</span>
                  <span className="si-metric-sub">DataForSEO · organic search estimate</span>
                </>
              ) : (
                <span className="si-metric-sub">Fetch SEO intel below to populate</span>
              )}
            </section>

            {/* Organic keywords — from DataForSEO when fetched */}
            <section className="si-card si-metric">
              <span className="si-metric-label">Organic keywords ranked</span>
              {intel?.overview.organicKeywords != null ? (
                <>
                  <span className="si-metric-value">{fmtNum(intel.overview.organicKeywords)}</span>
                  <span className="si-metric-sub">
                    #1: {fmtNum(intel.overview.pos1)} · #2–3: {fmtNum(intel.overview.pos2_3)} · #4–10: {fmtNum(intel.overview.pos4_10)}
                  </span>
                </>
              ) : (
                <span className="si-metric-sub">Fetch SEO intel below to populate</span>
              )}
            </section>
          </div>

          {/* Online intel — DataForSEO, cached in the DB */}
          <section className="si-card">
            <div className="si-intel-head">
              <h2>Online intel <span className="si-intel-src">· DataForSEO</span></h2>
              <div className="si-intel-actions">
                {intelFetchedAt && <span className="si-intel-stamp">Updated {new Date(intelFetchedAt).toLocaleString()}</span>}
                <button className="btn btn-primary btn-xs" onClick={() => void fetchIntel()} disabled={intelFetching}>
                  {intelFetching ? 'Fetching…' : intel ? '↻ Re-fetch' : '🔍 Fetch SEO intel'}
                </button>
              </div>
            </div>
            {intelError && <div className="studio-error">{intelError}</div>}
            {!intel && !intelFetching && !intelError && (
              <p className="si-note">
                No SEO intel yet. Click <strong>Fetch SEO intel</strong> to pull keywords, traffic &amp; competing
                domains from DataForSEO. Results are stored, so coming back here is instant and free — re-fetch only
                when you want fresh numbers.
              </p>
            )}
            {intel?.backlinks && (intel.backlinks.referringDomains != null || intel.backlinks.backlinks != null || intel.backlinks.rank != null) && (
              <div className="si-intel-metrics">
                <div className="si-intel-metric">
                  <span className="si-im-val">{fmtNum(intel.backlinks.referringDomains)}</span>
                  <span className="si-im-lbl">Referring domains</span>
                </div>
                <div className="si-intel-metric">
                  <span className="si-im-val">{fmtNum(intel.backlinks.backlinks)}</span>
                  <span className="si-im-lbl">Backlinks</span>
                </div>
                <div className="si-intel-metric">
                  <span className="si-im-val">{fmtNum(intel.backlinks.rank)}</span>
                  <span className="si-im-lbl">Domain rank</span>
                </div>
              </div>
            )}

            {intel && intel.history.length > 1 && (
              <div className="si-intel-block">
                <h3>Estimated organic traffic over time</h3>
                <IntelTrafficChart points={intel.history} />
              </div>
            )}

            {intel && intel.distribution.some((d) => d.count > 0) && (() => {
              const distMax = Math.max(1, ...intel.distribution.map((d) => d.count))
              return (
                <div className="si-intel-block">
                  <h3>Keyword position distribution</h3>
                  <div className="si-dist">
                    {intel.distribution.map((d) => (
                      <div className="si-dist-row" key={d.bucket}>
                        <span className="si-dist-label">{d.bucket}</span>
                        <span className="si-dist-bar"><span className="si-dist-fill" style={{ width: `${(d.count / distMax) * 100}%` }} /></span>
                        <span className="si-dist-val">{fmtNum(d.count)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {intel && intel.topKeywords.length > 0 && (
              <div className="si-intel-block">
                <h3>Top organic keywords</h3>
                <div className="si-matrix-scroll">
                  <table className="si-kw-table">
                    <thead>
                      <tr><th>Keyword</th><th>Pos.</th><th>Volume</th><th>Est. traffic</th></tr>
                    </thead>
                    <tbody>
                      {intel.topKeywords.slice(0, 20).map((k, i) => (
                        <tr key={i}>
                          <td>{k.keyword}</td>
                          <td>{k.position ?? '—'}</td>
                          <td>{fmtNum(k.searchVolume)}</td>
                          <td>{fmtNum(k.etv)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {intel && intel.competitors.length > 0 && (
              <div className="si-intel-block">
                <h3>Competing domains</h3>
                <div className="si-chips">
                  {intel.competitors.slice(0, 12).map((c, i) => (
                    <span className="si-chip" key={i} title={`${fmtNum(c.organicKeywords)} keywords · ${fmtNum(c.organicTraffic)} est. traffic`}>
                      {c.domain}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

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

        </>
      )}
    </main>
  )
}

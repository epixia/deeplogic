// Onboarding — value-first, AI-driven setup. A visitor enters their website and
// watches a LIVE MONITOR as DeepLogic learns the business (anonymously — nothing
// is saved yet). Only at the end do we ask for name + email to claim the
// workspace; the account is created instantly (set-password link emailed) and
// the gathered data is persisted. An optional Power BI step follows.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  createOrg,
  onboardingAnalyzeStream,
  onboardingPersist,
  ingestToVault,
  scanPowerBI,
  type OnboardingEvent,
  type ProposedAgentLite,
  type PowerBIScan,
} from '../lib/api'
import Logo from '../components/Logo'
import './onboarding.css'

type Phase = 'intro' | 'running' | 'review' | 'powerbi' | 'claim' | 'done'
interface FeedItem { kind: 'step' | 'detail'; icon?: string; text: string }
interface Company { name: string; summary: string; facts: { label: string; value: string }[] }
interface Stats { domain: string; age: { createdAt: string; ageYears: number } | null; sources: { title: string; url: string }[] }
interface Competitor { name: string; website: string; reason: string }
type Summary = Extract<OnboardingEvent, { type: 'done' }>['summary']

function guessOrgName(website: string, company?: Company | null): string {
  if (company?.name) return company.name.split('|')[0].split('—')[0].trim().slice(0, 60)
  try {
    const h = new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace(/^www\./, '')
    const base = h.split('.')[0] || h
    return base.charAt(0).toUpperCase() + base.slice(1)
  } catch { return 'My Workspace' }
}

function randomPassword(): string {
  const rnd = (globalThis.crypto?.randomUUID?.() ?? `${Math.random()}${Math.random()}`).replace(/-/g, '')
  return `Dl!${rnd.slice(0, 16)}` // satisfies length + a little complexity
}

function firstSentence(s: string): string {
  const m = (s || '').trim().match(/^.*?[.!?](\s|$)/)
  return (m ? m[0] : (s || '')).trim()
}
// Pull an industry/sector value out of the gathered company facts, if present.
function industryFact(company: Company | null): string | null {
  const f = company?.facts?.find((x) => /industry|sector|category|market|vertical/i.test(x.label))
  return f?.value?.trim() || null
}
const isPbi = (n: string) => /\.(pbit|pbix)$/i.test(n)

export default function Onboarding() {
  const { orgs, session, getAccessToken, signUp, resetPassword, refreshOrgs, loading } = useAuth()
  const navigate = useNavigate()

  const [phase, setPhase] = useState<Phase>('intro')
  const [website, setWebsite] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [feed, setFeed] = useState<FeedItem[]>([])
  const [company, setCompany] = useState<Company | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [products, setProducts] = useState<{ name: string; description: string }[]>([])
  const [agents, setAgents] = useState<ProposedAgentLite[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)

  // claim (end) form
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [orgId, setOrgId] = useState<string | null>(null)
  const [pwNote, setPwNote] = useState(false)

  // Power BI step — files chosen here are held in memory and uploaded once the
  // workspace exists (during claim), so name+email stays the final step.
  const [pbiFiles, setPbiFiles] = useState<File[]>([])
  const [pbiIntro, setPbiIntro] = useState(true)
  const [dragActive, setDragActive] = useState(false)
  const [pbiScans, setPbiScans] = useState<Record<string, { status: 'scanning' | 'done' | 'failed'; scan?: PowerBIScan }>>({})
  const [pbiResults, setPbiResults] = useState<{ name: string; category: string }[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const feedEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { feedEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [feed])

  // A warm "we understand your business" reflection from the Power BI scans —
  // references the user's REAL detected KPIs, tables and connectors.
  const pbiInsight = useMemo(() => {
    const done = Object.values(pbiScans).filter((s) => s.status === 'done' && s.scan)
    if (!done.length) return null
    const measures = new Set<string>(), tables = new Set<string>(), conns = new Set<string>()
    for (const d of done) {
      for (const t of d.scan!.tables) { tables.add(t.name); for (const m of t.measures) measures.add(m) }
      for (const c of d.scan!.connectors) conns.add(c.name)
    }
    return { measures: [...measures], tables: [...tables], conns: [...conns], reports: done.length }
  }, [pbiScans])
  const otherDocs = useMemo(() => pbiFiles.filter((f) => !isPbi(f.name)), [pbiFiles])

  // Existing user who already has a workspace → straight in.
  if (!loading && !busy && phase === 'intro' && orgs.length > 0) {
    return <Navigate to={`/app/${orgs[0].id}/dashboards`} replace />
  }

  async function startAnalyze(e: FormEvent) {
    e.preventDefault()
    const site = website.trim()
    if (!site) { setError('Enter your website to get started.'); return }
    setError(null); setBusy(true); setPhase('running')
    setFeed([{ kind: 'step', icon: '✨', text: 'Starting up…' }])
    try {
      for await (const ev of onboardingAnalyzeStream(site)) {
        if (ev.type === 'step') setFeed((f) => [...f, { kind: 'step', icon: ev.icon, text: ev.text }])
        else if (ev.type === 'detail') setFeed((f) => [...f, { kind: 'detail', text: ev.text }])
        else if (ev.type === 'company') setCompany({ name: ev.name, summary: ev.summary, facts: ev.facts })
        else if (ev.type === 'stats') setStats({ domain: ev.domain, age: ev.age, sources: ev.sources })
        else if (ev.type === 'competitor') setCompetitors((c) => [...c, { name: ev.name, website: ev.website, reason: ev.reason }])
        else if (ev.type === 'product') setProducts((p) => [...p, { name: ev.name, description: ev.description }])
        else if (ev.type === 'agent') setAgents((a) => [...a, { name: ev.name, description: ev.description, model: ev.model, systemPrompt: ev.systemPrompt, schedule: ev.schedule }])
        else if (ev.type === 'done') { setSummary(ev.summary); setPhase('powerbi') }
        else if (ev.type === 'error') setError(ev.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed.')
    } finally { setBusy(false) }
  }

  // Claim the workspace: create the account (instant), persist what we gathered.
  async function claim(e: FormEvent) {
    e.preventDefault()
    const nm = name.trim(), em = email.trim()
    if (!nm || !em) { setError('Enter your name and email to save your workspace.'); return }
    setError(null); setBusy(true)
    try {
      // 1) Create the account unless already signed in.
      if (!session) {
        const { error: suErr } = await signUp(em, randomPassword(), nm)
        if (suErr) throw new Error(suErr)
        void resetPassword(em).catch(() => undefined) // "set your password" email (best-effort)
        setPwNote(true)
      }
      const token = await getAccessToken()
      if (!token) throw new Error('Could not start your session — please try signing in.')

      // 2) Create the workspace + persist the gathered data.
      const org = await createOrg(token, guessOrgName(website, company))
      await onboardingPersist(token, org.id, {
        website,
        company: company ? { name: company.name, summary: company.summary, facts: company.facts } : null,
        competitors,
        products,
        agents,
      })
      await refreshOrgs()
      setOrgId(org.id)

      // 3) Upload any Power BI files chosen on the previous step (workspace now exists).
      for (const file of pbiFiles.slice(0, 20)) {
        try {
          const dataBase64 = await fileToBase64(file)
          const res = await ingestToVault(token, org.id, { dataBase64, filename: file.name, mediaType: file.type || 'application/octet-stream', name: file.name })
          setPbiResults((p) => [...p, { name: res.item.name, category: res.category }])
        } catch { setPbiResults((p) => [...p, { name: file.name, category: 'failed' }]) }
      }
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your workspace.')
    } finally { setBusy(false) }
  }

  function addPbiFiles(files: FileList | null) {
    if (!files) return
    const incoming = Array.from(files)
    setPbiFiles((prev) => {
      const merged = [...prev]
      for (const f of incoming) {
        if (!merged.some((e) => e.name === f.name && e.size === f.size)) merged.push(f) // dedupe
      }
      return merged.slice(0, 20)
    })
    // Live feedback: parse Power BI files now and surface detected connectors.
    for (const f of incoming) {
      const key = `${f.name}-${f.size}`
      if (!/\.(pbit|pbix)$/i.test(f.name) || pbiScans[key]) continue
      setPbiScans((s) => ({ ...s, [key]: { status: 'scanning' } }))
      void (async () => {
        try {
          const scan = await scanPowerBI(await fileToBase64(f), f.name)
          setPbiScans((s) => ({ ...s, [key]: { status: scan.ok ? 'done' : 'failed', scan } }))
        } catch {
          setPbiScans((s) => ({ ...s, [key]: { status: 'failed' } }))
        }
      })()
    }
  }
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
      r.onerror = () => reject(new Error('read failed'))
      r.readAsDataURL(file)
    })
  }

  function finish() { if (orgId) navigate(`/app/${orgId}/dashboards`, { replace: true }) }

  // ---- intro ----
  if (phase === 'intro') {
    return (
      <main className="ob">
        <div className="ob-intro">
          <Logo size={46} title="DeepLogic" />
          <h1>Let's get to know your business</h1>
          <p className="ob-lead">
            Drop in your website and watch DeepLogic read it, learn what you do, and find your
            competitors — live. No sign-up needed to see it work.
          </p>
          {error && <div className="ob-error">{error}</div>}
          <form className="ob-form" onSubmit={startAnalyze}>
            <input className="ob-input" type="text" autoFocus placeholder="yourcompany.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
            <button className="btn btn-primary ob-go" type="submit" disabled={busy}>
              {busy ? 'Starting…' : 'Get Started →'}
            </button>
            <span className="ob-micro">We'll only ask for your name &amp; email at the end, once you've seen the results.</span>
          </form>
        </div>
      </main>
    )
  }

  // ---- running / done / claimed: the live monitor + claim ----
  return (
    <main className="ob ob-monitor">
      <header className="ob-mon-head">
        <Logo size={32} title="DeepLogic" />
        <div>
          <h1>
            {phase === 'running' ? 'Analysing your business…'
              : phase === 'review' ? 'Your intelligence is ready'
              : phase === 'powerbi' ? 'Show us how you run'
              : phase === 'claim' ? 'Activate your workspace'
              : 'Your workspace is ready'}
          </h1>
          <p>
            {phase === 'running' ? 'Watch the AI reason through your business, live — this is where it gets good.'
              : phase === 'review' ? 'We’ve built your picture. Activate your workspace to see it all.'
              : phase === 'powerbi' ? 'Optional — a Power BI report, a financials PDF, a strategy deck… the more you share, the sharper we get.'
              : phase === 'claim' ? 'Last step — just your name and email.'
              : (summary ? `${summary.company} · ${summary.competitors} competitor${summary.competitors === 1 ? '' : 's'} — open your dashboard to dive in` : 'All set up for you.')}
          </p>
        </div>
        {phase === 'done' && <button className="btn btn-primary ob-enter" onClick={finish}>Enter DeepLogic →</button>}
      </header>

      {error && <div className="ob-error">{error}</div>}

      {/* the AI's live reasoning — the focus. We intentionally do NOT show the
          gathered data here; the payoff lives in the dashboard after signup. */}
      {company && (phase === 'running' || phase === 'review') && (
        <div className="ob-welcome">
          <span className="ob-welcome-emoji" aria-hidden>👋</span>
          <div className="ob-welcome-body">
            <div className="ob-welcome-title">So great to meet you, {company.name} 🎉</div>
            <p className="ob-welcome-text">
              {industryFact(company) && <><strong>{industryFact(company)}</strong> — honestly one of the more exciting spaces to build for right now. </>}
              {firstSentence(company.summary)} We're genuinely getting into it — and the more we read, the more we think you're going to love what comes next.
            </p>
          </div>
        </div>
      )}

      {(phase === 'running' || phase === 'review') && (
        <div className="ob-think">
          <section className="ob-feed ob-feed--center">
            <div className="ob-feed-title">⚡ Live AI reasoning</div>
            <ul className="ob-feed-list">
              {feed.map((f, i) => {
                const isLastStep = f.kind === 'step' && phase === 'running' && i === feed.length - 1
                return (
                  <li key={i} className={`ob-feed-item ob-feed-${f.kind}${isLastStep ? ' is-active' : ''}`}>
                    {f.kind === 'step'
                      ? <><span className="ob-feed-ic">{isLastStep ? <span className="ob-spin" /> : f.icon}</span>{f.text}</>
                      : <span className="ob-feed-detailtext">{f.text}</span>}
                  </li>
                )
              })}
              <div ref={feedEndRef} />
            </ul>
          </section>
        </div>
      )}

      {/* review → mystery reveal: a glassmorphism modal over the blurred feed */}
      {phase === 'review' && (
        <div className="ob-reveal-backdrop">
          <section className="ob-reveal ob-glass" role="dialog" aria-modal="true" aria-label="Analysis complete">
            <div className="ob-reveal-ic">🔒</div>
            <h2>{company?.name ? `We're all in on ${company.name}.` : "We've built your intelligence picture"}</h2>
            <p className="ob-reveal-lead">
              This is the part that gets really fun. Everything you just watched us learn is built and
              waiting for you — agents drafted, competitors mapped, your numbers understood. It's already
              yours; claim it in 20 seconds and let's see what it can really do together.
            </p>
            <ul className="ob-reveal-list">
              {company && <li>✓ Company profile &amp; positioning</li>}
              {products.length > 0 && <li>✓ {products.length} product{products.length === 1 ? '' : 's'} catalogued</li>}
              {stats && <li>✓ Website &amp; domain intelligence</li>}
              {summary && summary.competitors > 0 && <li>✓ {summary.competitors} competitors mapped</li>}
              {agents.length > 0 && <li>✓ {agents.length} AI agent{agents.length === 1 ? '' : 's'} drafted &amp; ready to deploy</li>}
              {(pbiFiles.length - otherDocs.length) > 0 && <li>✓ {pbiFiles.length - otherDocs.length} Power BI report{(pbiFiles.length - otherDocs.length) === 1 ? '' : 's'} — connectors &amp; KPIs detected</li>}
              {otherDocs.length > 0 && <li>✓ {otherDocs.length} document{otherDocs.length === 1 ? '' : 's'} queued for deep reading</li>}
              <li>✓ Memory graph + a starter dashboard, built for you</li>
            </ul>
            <p className="ob-reveal-nudge">No credit card. No setup. Just open the door and it's all here waiting.</p>
            <button className="btn btn-primary ob-reveal-cta" onClick={() => setPhase('claim')}>Let's do this — claim my workspace →</button>
          </section>
        </div>
      )}

      {/* Power BI upload step — intro modal first, then the upload area */}
      {phase === 'powerbi' && pbiIntro && (
        <div className="ob-reveal-backdrop">
          <section className="ob-reveal ob-glass" role="dialog" aria-modal="true" aria-label="Why connect Power BI">
            <div className="ob-reveal-ic">📈</div>
            <h2>Show DeepLogic how your business runs</h2>
            <p className="ob-reveal-lead">
              Your reports and documents are where your business already lives. Hand us one and
              DeepLogic learns it from the inside — far beyond what your website shows.
            </p>
            <ul className="ob-reveal-list">
              <li>📈 <strong>Power BI</strong> — we detect your connectors, tables &amp; the KPIs you already track</li>
              <li>📄 <strong>A financials PDF, strategy deck, or any doc</strong> — we read it to understand your goals</li>
              <li>📐 We reflect back <strong>what we learned</strong> so you can see we get your business</li>
              <li>⚡ Pre-fills your workspace so agents &amp; reports use <strong>real data</strong> — no setup</li>
            </ul>
            <div className="ob-step-actions">
              <button className="btn btn-ghost" onClick={() => { setPbiFiles([]); setPbiIntro(false); setPhase('review') }}>Not now</button>
              <button className="btn btn-primary ob-reveal-cta" onClick={() => setPbiIntro(false)}>Add a file →</button>
            </div>
          </section>
        </div>
      )}
      {phase === 'powerbi' && !pbiIntro && (
        <section className="ob-step">
          <p className="ob-step-lead">Add a Power BI export (<code>.pbit</code> parses best) — or any business doc (PDF, deck, spreadsheet). We'll reflect back what we learn. Totally optional — you can do this later.</p>
          <input
            ref={fileRef} type="file" hidden multiple accept=".pbit,.pbix,.xlsx,.csv,.json,.pdf,.docx,.doc,.txt,.md,.pptx,.ppt"
            onChange={(e) => { addPbiFiles(e.target.files); e.target.value = '' }}
          />
          <div
            className={`ob-drop${dragActive ? ' is-drag' : ''}`}
            role="button" tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
            onDragEnter={(e) => { e.preventDefault(); setDragActive(true) }}
            onDragOver={(e) => { e.preventDefault(); if (!dragActive) setDragActive(true) }}
            onDragLeave={(e) => { e.preventDefault(); setDragActive(false) }}
            onDrop={(e) => { e.preventDefault(); setDragActive(false); addPbiFiles(e.dataTransfer.files) }}
          >
            <div className="ob-drop-ic">📈</div>
            <div className="ob-drop-title">
              <strong>Drag &amp; drop</strong> reports or documents here, or <span className="ob-drop-link">browse</span>
            </div>
            <div className="ob-drop-hint">Power BI (<code>.pbit</code> best), or PDF · deck · spreadsheet · text</div>
          </div>

          {pbiInsight && (
            <div className="ob-reflect">
              <div className="ob-reflect-title">✨ Here's what we already understand</div>
              <p className="ob-reflect-text">
                You track{' '}
                <strong>{pbiInsight.measures.length ? pbiInsight.measures.slice(0, 4).join(', ') : `${pbiInsight.tables.length} areas of your business`}</strong>
                {' '}across {pbiInsight.tables.length} table{pbiInsight.tables.length === 1 ? '' : 's'}
                {pbiInsight.conns.length ? <>, pulling from <strong>{pbiInsight.conns.slice(0, 3).join(', ')}</strong></> : null}.
                {' '}We'll make sure every report, agent and answer speaks your numbers.
              </p>
            </div>
          )}
          {pbiFiles.length > 0 && (
            <>
              <div className="ob-filecount">{pbiFiles.length} file{pbiFiles.length === 1 ? '' : 's'} selected{pbiFiles.length >= 20 ? ' (max)' : ''}</div>
              <ul className="ob-filelist">
                {pbiFiles.map((f, i) => {
                  const sc = pbiScans[`${f.name}-${f.size}`]
                  return (
                    <li key={`${f.name}-${f.size}`} className="ob-fileitem">
                      <div className="ob-filerow">
                        <span className="ob-filename">📄 {f.name}</span>
                        <button className="ob-file-x" onClick={() => setPbiFiles((p) => p.filter((_, j) => j !== i))}>✕</button>
                      </div>
                      {sc?.status === 'scanning' && <span className="ob-filescan"><span className="ob-spin" /> Scanning for connectors…</span>}
                      {sc?.status === 'done' && sc.scan && (
                        <div className="ob-fileconn">
                          <span className="ob-fileconn-head">
                            ✓ {sc.scan.connectors.length} connector{sc.scan.connectors.length === 1 ? '' : 's'} · {sc.scan.tableCount} table{sc.scan.tableCount === 1 ? '' : 's'} · {sc.scan.measureCount} measure{sc.scan.measureCount === 1 ? '' : 's'}
                          </span>
                          {sc.scan.connectors.length > 0 && (
                            <div className="ob-conn-block">
                              <span className="ob-conn-label">Connectors</span>
                              <div className="ob-connchips">
                                {sc.scan.connectors.map((c, j) => (
                                  <span key={j} className="ob-connchip">{c.name}<span className="ob-connchip-kind">{c.kind}</span></span>
                                ))}
                              </div>
                            </div>
                          )}
                          {sc.scan.tables.length > 0 && (
                            <details className="ob-tabledetails" open>
                              <summary>Tables &amp; fields ({sc.scan.tables.length})</summary>
                              <ul className="ob-tablelist">
                                {sc.scan.tables.map((t, j) => (
                                  <li key={j}>
                                    <div className="ob-table-row">
                                      <span className="ob-table-name">🗂 {t.name}</span>
                                      <span className="ob-table-meta">{t.columns.length} col{t.columns.length === 1 ? '' : 's'}{t.measures.length ? ` · ${t.measures.length} measure${t.measures.length === 1 ? '' : 's'}` : ''}</span>
                                    </div>
                                    {t.columns.length > 0 && (
                                      <div className="ob-table-cols">{t.columns.slice(0, 14).join(', ')}{t.columns.length > 14 ? ` +${t.columns.length - 14} more` : ''}</div>
                                    )}
                                    {t.measures.length > 0 && (
                                      <div className="ob-table-measures">ƒ {t.measures.slice(0, 8).join(', ')}{t.measures.length > 8 ? '…' : ''}</div>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      )}
                      {sc?.status === 'failed' && <span className="ob-filescan ob-filescan--fail">Couldn't read connectors from this file.</span>}
                      {!isPbi(f.name) && <span className="ob-filescan">📄 We'll study this once your workspace is live — it sharpens everything.</span>}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          <div className="ob-step-actions">
            <button className="btn btn-ghost" onClick={() => { setPbiFiles([]); setPhase('review') }}>Skip for now</button>
            <button className="btn btn-primary" onClick={() => setPhase('review')}>Continue →</button>
          </div>
        </section>
      )}

      {/* claim step — name + email (the final step) */}
      {phase === 'claim' && (
        <section className="ob-step">
          <p className="ob-step-lead">
            Just your name and email — set a password later. We'll save everything we found
            {pbiFiles.length ? ` and import your ${pbiFiles.length} Power BI file${pbiFiles.length === 1 ? '' : 's'}` : ''}.
          </p>
          <form className="ob-claim-form" onSubmit={claim}>
            <input className="ob-input" type="text" placeholder="Your name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            <input className="ob-input" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Setting up…' : 'Create my workspace →'}</button>
          </form>
          <button type="button" className="ob-skiplink" onClick={() => setPhase('review')}>← Back</button>
        </section>
      )}

      {/* done — workspace ready */}
      {phase === 'done' && (
        <section className="ob-step ob-done">
          {pwNote && <p className="ob-pwnote">✓ Check your inbox for a link to set your password.</p>}
          <ul className="ob-done-summary">
            {summary && <li>🏢 {summary.company}</li>}
            {summary && <li>🔭 {summary.competitors} competitor{summary.competitors === 1 ? '' : 's'} tracked</li>}
            {pbiResults.map((r, i) => <li key={i}>📈 {r.name} <span className="ob-pbi-cat">{r.category}</span></li>)}
          </ul>
          <button className="btn btn-primary ob-enter" onClick={finish}>Enter DeepLogic →</button>
        </section>
      )}
    </main>
  )
}

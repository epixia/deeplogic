// CompanyProfile — the "My Company" panel at the top of the Data Vault.
// Captures the org's own identity as a single, always-enabled context note
// (marked meta.companyProfile=true). Because it's an enabled note, it is
// automatically compiled into grounding context for every report, widget,
// agent, and the global assistant.
//
// "✨ Auto-fill from website" reuses the analyzeUrl company/competitive lenses
// to populate the fields from the company's own site.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listContext,
  createContext,
  updateContext,
  analyzeUrl,
  type ContextItem,
} from '../../lib/api'
import './company-profile.css'

export const COMPANY_PROFILE_NAME = 'Company Profile'

interface Fields {
  name: string
  website: string
  tagline: string
  industry: string
  description: string
  products: string
  audience: string
  competitors: string
  differentiators: string
}

const EMPTY: Fields = {
  name: '', website: '', tagline: '', industry: '',
  description: '', products: '', audience: '', competitors: '', differentiators: '',
}

const SECTIONS: { key: keyof Fields; label: string }[] = [
  { key: 'description', label: 'What we do' },
  { key: 'products', label: 'Products & services' },
  { key: 'audience', label: 'Target audience' },
  { key: 'competitors', label: 'Competitors' },
  { key: 'differentiators', label: 'Differentiators' },
]

function fieldsFromMeta(meta: Record<string, unknown> | undefined): Fields {
  const m = (meta ?? {}) as Record<string, unknown>
  const s = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : '')
  return {
    name: s('name'), website: s('website'), tagline: s('tagline'), industry: s('industry'),
    description: s('description'), products: s('products'), audience: s('audience'),
    competitors: s('competitors'), differentiators: s('differentiators'),
  }
}

// Render the grounding text the AI reads for every generation.
function renderContent(f: Fields): string {
  const lines: string[] = [
    `# Company Profile — ${f.name || 'Our company'}`,
    'This is the company that owns this workspace. Treat it as primary context for who "we"/"us"/"our" refers to.',
  ]
  if (f.website) lines.push(`Website: ${f.website}`)
  if (f.industry) lines.push(`Industry: ${f.industry}`)
  if (f.tagline) lines.push(`Tagline: ${f.tagline}`)
  const block = (label: string, val: string) => { if (val.trim()) lines.push('', `## ${label}`, val.trim()) }
  block('What we do', f.description)
  block('Products & services', f.products)
  block('Target audience', f.audience)
  block('Competitors', f.competitors)
  block('Differentiators', f.differentiators)
  return lines.join('\n')
}

export default function CompanyProfile({
  orgId,
  getToken,
  onSaved,
}: {
  orgId: string
  getToken: () => Promise<string>
  onSaved?: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [itemId, setItemId] = useState<string | null>(null)
  const [fields, setFields] = useState<Fields>(EMPTY)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [autofilling, setAutofilling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const t = await getToken()
      const items = await listContext(t, orgId)
      const found = items.find((i: ContextItem) => (i.meta as Record<string, unknown> | undefined)?.companyProfile === true)
      if (found) {
        setItemId(found.id)
        setFields(fieldsFromMeta(found.meta as Record<string, unknown>))
        setEditing(false)
      } else {
        setEditing(true) // no profile yet → start in edit mode
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load company profile.')
    } finally {
      setLoading(false)
    }
  }, [getToken, orgId])

  useEffect(() => { void load() }, [load])

  function set<K extends keyof Fields>(k: K, v: string) {
    setFields((f) => ({ ...f, [k]: v }))
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const t = await getToken()
      const meta = { companyProfile: true, ...fields }
      const content = renderContent(fields)
      if (itemId) {
        await updateContext(t, orgId, itemId, { name: COMPANY_PROFILE_NAME, content, meta, scope: 'org', enabled: true })
      } else {
        const item = await createContext(t, orgId, { kind: 'note', name: COMPANY_PROFILE_NAME, content, meta, scope: 'org' })
        setItemId(item.id)
      }
      setEditing(false)
      setNote('Saved — this now grounds every report, widget & agent.')
      setTimeout(() => setNote(null), 3500)
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function autofill() {
    const url = fields.website.trim()
    if (!url) { setError('Enter your company website first, then Auto-fill.'); return }
    setAutofilling(true)
    setError(null)
    try {
      const t = await getToken()
      const res = await analyzeUrl(t, orgId, { url, lenses: ['company', 'competitive'] })
      setFields((f) => {
        const next = { ...f }
        if (res.company?.summary) next.description = res.company.summary
        if (res.sourceTitle && !next.name) next.name = res.sourceTitle
        for (const fact of res.company?.facts ?? []) {
          const l = fact.label.toLowerCase()
          if (l.includes('industry') && !next.industry) next.industry = fact.value
          else if (l.includes('product') && !next.products) next.products = fact.value
          else if ((l.includes('customer') || l.includes('audience')) && !next.audience) next.audience = fact.value
          else if ((l.includes('tagline') || l.includes('slogan')) && !next.tagline) next.tagline = fact.value
        }
        if (res.competitive?.competitors?.length) {
          next.competitors = res.competitive.competitors.map((c) => c.note ? `${c.name} — ${c.note}` : c.name).join('\n')
        }
        if (res.competitive?.strengths?.length) next.differentiators = res.competitive.strengths.join('\n')
        return next
      })
      setEditing(true)
      if (!res.usedAI) setNote('AI not configured — limited auto-fill. Add a provider in Settings → AI providers.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Auto-fill failed.')
    } finally {
      setAutofilling(false)
    }
  }

  if (loading) {
    return <section className="cp-card"><div className="cp-head"><h2>🏢 My Company</h2></div><div className="cp-empty">Loading…</div></section>
  }

  const hasProfile = !!itemId
  const filledSections = SECTIONS.filter((s) => fields[s.key].trim())

  return (
    <section className="cp-card">
      <div className="cp-head">
        <h2>🏢 My Company</h2>
        <span className="cp-sub">Always-on context for every report, widget, agent &amp; the assistant.</span>
        <div className="cp-head-actions">
          {!editing && (
            <button className="btn btn-ghost btn-xs" onClick={() => setEditing(true)}>✎ Edit</button>
          )}
        </div>
      </div>

      {error && <div className="cp-error">{error}</div>}
      {note && <div className="cp-note">{note}</div>}

      {!editing && hasProfile ? (
        // ---- read view ----
        <div className="cp-read">
          <div className="cp-identity">
            <div className="cp-name">{fields.name || 'Unnamed company'}</div>
            {fields.industry && <span className="cp-tag">{fields.industry}</span>}
            {fields.website && (
              <Link className="cp-web" to={`/app/${orgId}/site?url=${encodeURIComponent(fields.website)}`}>
                {fields.website.replace(/^https?:\/\//, '')} → insights
              </Link>
            )}
          </div>
          {fields.tagline && <div className="cp-tagline">{fields.tagline}</div>}
          <div className="cp-sections">
            {filledSections.map((s) => (
              <div className="cp-section" key={s.key}>
                <div className="cp-section-label">{s.label}</div>
                <div className="cp-section-val">{fields[s.key]}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        // ---- edit view ----
        <div className="cp-form">
          {!hasProfile && (
            <p className="cp-intro">
              Tell DeepLogic who you are — it grounds every AI answer. Enter your website and
              <strong> Auto-fill</strong>, or fill it in manually.
            </p>
          )}
          <div className="cp-row">
            <label className="cp-field cp-field--grow">
              <span>Company name</span>
              <input className="cp-input" value={fields.name} onChange={(e) => set('name', e.target.value)} placeholder="Acme Inc." />
            </label>
            <label className="cp-field cp-field--grow">
              <span>Website</span>
              <div className="cp-website-row">
                <input className="cp-input" value={fields.website} onChange={(e) => set('website', e.target.value)} placeholder="https://acme.com" />
                <button type="button" className="btn btn-primary btn-xs cp-autofill" onClick={() => void autofill()} disabled={autofilling}>
                  {autofilling ? 'Reading…' : '✨ Auto-fill'}
                </button>
              </div>
            </label>
          </div>
          <div className="cp-row">
            <label className="cp-field cp-field--grow">
              <span>Industry</span>
              <input className="cp-input" value={fields.industry} onChange={(e) => set('industry', e.target.value)} placeholder="e.g. Cannabis / CPG" />
            </label>
            <label className="cp-field cp-field--grow">
              <span>Tagline</span>
              <input className="cp-input" value={fields.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="One line on what you do" />
            </label>
          </div>
          {SECTIONS.map((s) => (
            <label className="cp-field" key={s.key}>
              <span>{s.label}</span>
              <textarea
                className="cp-input cp-textarea"
                rows={s.key === 'description' ? 3 : 2}
                value={fields[s.key]}
                onChange={(e) => set(s.key, e.target.value)}
              />
            </label>
          ))}
          <div className="cp-actions">
            {hasProfile && (
              <button className="btn btn-ghost" onClick={() => { void load(); setEditing(false) }} disabled={saving}>Cancel</button>
            )}
            <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

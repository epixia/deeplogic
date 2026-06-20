// Products — the company's own product/service catalogue. Mirrors Competitors:
// each product is stored as an enabled context note (name "Product: <X>",
// meta.product=true) so it grounds every report, Block, agent and the assistant.
// "⚡ Generate" proposes products from the company profile (same flow as
// competitor discovery); users review and one-click add.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStickyTab } from '../../lib/useStickyTab'
import {
  listContext,
  createContext,
  updateContext,
  deleteContext,
  suggestProductsStream,
  hostImage,
  type ContextItem,
  type ProductSuggestion,
} from '../../lib/api'
import './company-profile.css'

export const PRODUCT_PREFIX = 'Product: '

type ProdView = 'cards' | 'list'
const PROD_VIEWS: readonly ProdView[] = ['cards', 'list']
type SortKey = 'name' | 'category'

interface Entry {
  id: string | null
  name: string
  category: string
  description: string
  price: string
  imageUrl: string
  url: string
}

const EMPTY: Entry = { id: null, name: '', category: '', description: '', price: '', imageUrl: '', url: '' }

function entryFromItem(it: ContextItem): Entry {
  const m = (it.meta ?? {}) as Record<string, unknown>
  const s = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : '')
  return {
    id: it.id,
    name: s('name') || it.name.replace(PRODUCT_PREFIX, ''),
    category: s('category'),
    description: s('description'),
    price: s('price'),
    imageUrl: s('imageUrl'),
    url: s('url'),
  }
}

function metaFromEntry(e: Entry, name: string): Record<string, unknown> {
  return {
    product: true, name,
    category: e.category.trim(), description: e.description,
    price: e.price.trim(), imageUrl: e.imageUrl.trim(), url: e.url.trim(),
  }
}

// Hide a thumbnail that fails to load (broken/hotlink-blocked image url).
function hideBrokenImg(ev: { currentTarget: HTMLImageElement }) {
  const card = ev.currentTarget.closest('.pr-thumb--card') as HTMLElement | null
  if (card) card.style.display = 'none'
  else ev.currentTarget.style.display = 'none'
}

function renderContent(e: Entry): string {
  const lines = [`# Product — ${e.name || 'Unnamed'}`]
  if (e.category) lines.push(`Category: ${e.category}`)
  if (e.price) lines.push(`Price: ${e.price}`)
  if (e.url) lines.push(`URL: ${e.url}`)
  if (e.description.trim()) lines.push('', e.description.trim())
  return lines.join('\n')
}

export default function Products({
  orgId,
  getToken,
  onChange,
}: {
  orgId: string
  getToken: () => Promise<string>
  onChange?: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState<Entry | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<ProductSuggestion[] | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genStep, setGenStep] = useState<string | null>(null)
  const [addingIdx, setAddingIdx] = useState<number | null>(null)
  const [view, setView] = useStickyTab<ProdView>(`vault.products.view.${orgId}`, 'cards', PROD_VIEWS)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const load = useCallback(async () => {
    try {
      const t = await getToken()
      const items = await listContext(t, orgId)
      const found = items
        .filter(
          (i: ContextItem) =>
            (i.meta as Record<string, unknown> | undefined)?.product === true &&
            i.name.startsWith(PRODUCT_PREFIX),
        )
        .map(entryFromItem)
      setEntries(found)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load products.')
    } finally {
      setLoading(false)
    }
  }, [getToken, orgId])

  useEffect(() => { void load() }, [load])

  function set<K extends keyof Entry>(k: K, v: Entry[K]) {
    setDraft((d) => (d ? { ...d, [k]: v } : d))
  }

  // Download an external image into our own storage so we never hotlink. Falls
  // back to the original URL if re-hosting fails.
  async function resolveImage(t: string, url: string): Promise<string> {
    if (!url || !/^https?:\/\//i.test(url)) return url
    try {
      const r = await hostImage(t, orgId, url)
      return r.url || url
    } catch {
      return url
    }
  }

  function sortBy(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('asc') }
  }

  const sortedEntries = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...entries].sort((a, b) => (a[sortKey] || '').toLowerCase().localeCompare((b[sortKey] || '').toLowerCase()) * dir)
  }, [entries, sortKey, sortDir])

  async function save() {
    if (!draft || saving) return
    if (!draft.name.trim()) { setError('Give the product a name.'); return }
    setSaving(true)
    setError(null)
    try {
      const t = await getToken()
      const name = draft.name.trim()
      const imageUrl = await resolveImage(t, draft.imageUrl)
      const withImg = { ...draft, name, imageUrl }
      const meta = metaFromEntry(withImg, name)
      const content = renderContent(withImg)
      if (draft.id) {
        await updateContext(t, orgId, draft.id, { name: `${PRODUCT_PREFIX}${name}`, content, meta, scope: 'org', enabled: true })
      } else {
        await createContext(t, orgId, { kind: 'note', name: `${PRODUCT_PREFIX}${name}`, content, meta, scope: 'org' })
      }
      setDraft(null)
      await load()
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Remove product "${name}"?`)) return
    setRemoving(id)
    try {
      const t = await getToken()
      await deleteContext(t, orgId, id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.')
    } finally {
      setRemoving(null)
    }
  }

  async function generate() {
    if (generating) return
    setGenerating(true)
    setError(null)
    setNote(null)
    setSuggestions(null)
    setGenStep(null)
    try {
      const t = await getToken()
      for await (const ev of suggestProductsStream(t, orgId, entries.map((e) => e.name))) {
        if (ev.type === 'step') {
          setGenStep(`${ev.icon} ${ev.text}`)
        } else if (ev.type === 'done') {
          const res = ev.result
          setSuggestions(res.products)
          if (res.note) setNote(res.note)
          else if (res.aiError) setError(`AI error: ${res.aiError}`)
          else if (res.products.length === 0) setNote('No new products found — try fleshing out your company profile (add your website).')
        } else if (ev.type === 'error') {
          setError(ev.error)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generate failed.')
    } finally {
      setGenerating(false)
      setGenStep(null)
    }
  }

  async function addSuggestion(s: ProductSuggestion, i: number) {
    if (addingIdx !== null) return
    setAddingIdx(i)
    setError(null)
    try {
      const t = await getToken()
      const imageUrl = await resolveImage(t, s.imageUrl ?? '')
      const entry: Entry = { id: null, name: s.name, category: s.category, description: s.description, price: s.price ?? '', imageUrl, url: s.url ?? '' }
      const meta = metaFromEntry(entry, s.name)
      await createContext(t, orgId, { kind: 'note', name: `${PRODUCT_PREFIX}${s.name}`, content: renderContent(entry), meta, scope: 'org' })
      setSuggestions((prev) => (prev ? prev.filter((_, idx) => idx !== i) : prev))
      await load()
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed.')
    } finally {
      setAddingIdx(null)
    }
  }

  async function addAll() {
    if (!suggestions || addingIdx !== null) return
    const list = [...suggestions]
    for (const s of list) {
      try {
        const t = await getToken()
        const imageUrl = await resolveImage(t, s.imageUrl ?? '')
        const entry: Entry = { id: null, name: s.name, category: s.category, description: s.description, price: s.price ?? '', imageUrl, url: s.url ?? '' }
        const meta = metaFromEntry(entry, s.name)
        await createContext(t, orgId, { kind: 'note', name: `${PRODUCT_PREFIX}${s.name}`, content: renderContent(entry), meta, scope: 'org' })
      } catch { /* skip failures */ }
    }
    setSuggestions(null)
    await load()
    onChange?.()
  }

  function renderTh(k: SortKey, label: string) {
    const active = sortKey === k
    return (
      <th
        className={`cp-th${active ? ' cp-th--active' : ''}`}
        onClick={() => sortBy(k)}
        role="button"
        tabIndex={0}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); sortBy(k) } }}
      >
        {label}<span className="cp-sort-arrow">{active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
      </th>
    )
  }

  return (
    <section className={`cp-card${view === 'list' ? ' cp-card--list' : ''}`}>
      <div className="cp-head">
        <h2>📦 Products</h2>
        <span className="cp-sub">Your company&apos;s products &amp; services — grounding context for research, reports &amp; the assistant.</span>
        <div className="cp-head-actions">
          {!draft && (
            <>
              <button className="btn btn-primary btn-xs" onClick={() => void generate()} disabled={generating}>
                {generating ? 'Generating…' : '⚡ Generate'}
              </button>
              <button className="btn btn-ghost btn-xs" onClick={() => { setDraft({ ...EMPTY }); setError(null) }}>
                ➕ Add manually
              </button>
              {entries.length > 0 && (
                <div className="cp-view-toggle" role="group" aria-label="View mode">
                  <button type="button" className={`cp-view-btn${view === 'cards' ? ' active' : ''}`} aria-pressed={view === 'cards'} title="Card view" onClick={() => setView('cards')}>▦</button>
                  <button type="button" className={`cp-view-btn${view === 'list' ? ' active' : ''}`} aria-pressed={view === 'list'} title="List view" onClick={() => setView('list')}>☰</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {error && <div className="cp-error">{error}</div>}
      {note && <div className="cp-note">{note}</div>}
      {generating && genStep && (
        <div className="cp-note cp-genstep">
          <span className="cp-genstep-pulse" aria-hidden />
          {genStep}
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <div className="cp-suggest">
          <div className="cp-suggest-head">
            <span>Suggested products — review &amp; add</span>
            <div className="cp-suggest-head-actions">
              <button className="btn btn-primary btn-xs" onClick={() => void addAll()}>Add all</button>
              <button className="btn btn-ghost btn-xs" onClick={() => setSuggestions(null)}>Dismiss</button>
            </div>
          </div>
          {suggestions.map((s, i) => (
            <div className="cp-suggest-row" key={i}>
              {s.imageUrl && <img className="pr-thumb pr-thumb--sm" src={s.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={hideBrokenImg} />}
              <div className="cp-suggest-main">
                <div className="cp-suggest-name">
                  {s.name}
                  {s.category && <span className="cp-cat-pill" style={{ marginLeft: 8 }}>{s.category}</span>}
                  {s.price && <span className="pr-price" style={{ marginLeft: 8 }}>{s.price}</span>}
                </div>
                {s.description && <div className="cp-suggest-reason">{s.description}</div>}
              </div>
              <button className="btn btn-primary btn-xs" onClick={() => void addSuggestion(s, i)} disabled={addingIdx === i}>
                {addingIdx === i ? 'Adding…' : '+ Add'}
              </button>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <div className="cp-form cp-comp-form">
          <div className="cp-row">
            <label className="cp-field cp-field--grow">
              <span>Product name</span>
              <input className="cp-input" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Flagship Widget" autoFocus />
            </label>
            <label className="cp-field cp-field--grow">
              <span>Category</span>
              <input className="cp-input" value={draft.category} onChange={(e) => set('category', e.target.value)} placeholder="Hardware / SaaS / Service" />
            </label>
          </div>
          <div className="cp-row">
            <label className="cp-field cp-field--grow">
              <span>Price</span>
              <input className="cp-input" value={draft.price} onChange={(e) => set('price', e.target.value)} placeholder="$19.99" />
            </label>
            <label className="cp-field cp-field--grow">
              <span>Image URL</span>
              <input className="cp-input" value={draft.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…/photo.jpg" />
            </label>
          </div>
          <label className="cp-field">
            <span>Product URL</span>
            <input className="cp-input" value={draft.url} onChange={(e) => set('url', e.target.value)} placeholder="https://…/products/…" />
          </label>
          <label className="cp-field">
            <span>Description</span>
            <textarea className="cp-input cp-textarea" rows={3} value={draft.description} onChange={(e) => set('description', e.target.value)} />
          </label>
          <div className="cp-actions">
            <button className="btn btn-ghost" onClick={() => { setDraft(null); setError(null) }} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : (draft.id ? 'Save product' : 'Add product')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="cp-empty">Loading…</div>
      ) : entries.length === 0 && !draft ? (
        <div className="cp-empty">
          No products yet — click <strong>⚡ Generate</strong> to discover them from your company profile, or <strong>➕ Add manually</strong>.
        </div>
      ) : view === 'list' ? (
        <div className="cp-table-scroll">
          <table className="cp-table">
            <thead>
              <tr>
                <th className="cp-th-thumb" aria-label="image" />
                {renderTh('name', 'Product')}
                {renderTh('category', 'Category')}
                <th className="cp-th cp-th--num">Price</th>
                <th className="cp-th">Description</th>
                <th className="cp-th-actions" aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((e) => (
                <tr key={e.id}>
                  <td className="cp-td-thumb">
                    {e.imageUrl
                      ? <img className="pr-thumb pr-thumb--sm" src={e.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={hideBrokenImg} />
                      : <span className="pr-thumb pr-thumb--sm pr-thumb--empty">📦</span>}
                  </td>
                  <td className="cp-td-name">
                    {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.name}</a> : e.name}
                  </td>
                  <td>{e.category || <span className="cp-muted">—</span>}</td>
                  <td className="cp-num">{e.price || <span className="cp-muted">—</span>}</td>
                  <td className="cp-td-desc">{e.description || <span className="cp-muted">—</span>}</td>
                  <td className="cp-td-actions">
                    <button className="cp-comp-iconbtn" title="Edit" onClick={() => { setDraft(e); setError(null) }}>✎</button>
                    <button className="cp-comp-iconbtn" title="Remove" disabled={removing === e.id} onClick={() => e.id && void remove(e.id, e.name)}>
                      {removing === e.id ? '…' : '✕'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cp-sections">
          {sortedEntries.map((e) => (
            <div className="cp-section cp-comp-card pr-card" key={e.id}>
              {e.imageUrl && (
                <div className="pr-thumb pr-thumb--card">
                  <img src={e.imageUrl} alt={e.name} loading="lazy" referrerPolicy="no-referrer" onError={hideBrokenImg} />
                </div>
              )}
              <div className="cp-comp-card-head">
                <div className="cp-comp-name">
                  {e.url ? <a className="cp-web" href={e.url} target="_blank" rel="noreferrer">{e.name}</a> : e.name}
                </div>
                <div className="cp-comp-card-actions">
                  <button className="cp-comp-iconbtn" title="Edit" onClick={() => { setDraft(e); setError(null) }}>✎</button>
                  <button className="cp-comp-iconbtn" title="Remove" disabled={removing === e.id} onClick={() => e.id && void remove(e.id, e.name)}>
                    {removing === e.id ? '…' : '✕'}
                  </button>
                </div>
              </div>
              <div className="pr-meta-row">
                {e.category && <span className="cp-cat-pill">{e.category}</span>}
                {e.price && <span className="pr-price">{e.price}</span>}
              </div>
              {e.description && <div className="cp-section-val cp-comp-summary">{e.description}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

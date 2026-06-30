// Admin Block Builder — generate a Block Gallery entry from a documentation URL
// (AI reads the docs and produces a configurable Block), review/edit it, publish
// it platform-wide, and manage every existing gallery Block.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import {
  adminListGalleryBlocks,
  adminGenerateGalleryBlock,
  adminSaveGalleryBlock,
  adminDeleteGalleryBlock,
  type DbGalleryBlock,
  type GalleryBlockDraft,
  type GalleryFieldDef,
} from '../../lib/api'
import { BLOCK_GALLERY } from '../../lib/blockGallery'
import AdminLayout from './AdminLayout'
import './admin.css'

const CATEGORIES = ['markets', 'news', 'data', 'web', 'utility']
const BUILTIN_IDS = new Set(BLOCK_GALLERY.map((b) => b.id))
const BLANK: GalleryBlockDraft = {
  slug: '', name: '', icon: '📦', category: 'data', tagline: '', description: '',
  sizeW: 3, sizeH: 3, fields: [], htmlTemplate: '', enabled: true,
}

export default function AdminBlockBuilder() {
  const { getAccessToken } = useAuth()
  const [blocks, setBlocks] = useState<DbGalleryBlock[]>([])
  const [draft, setDraft] = useState<GalleryBlockDraft>(BLANK)
  const [fieldsText, setFieldsText] = useState('[]')
  const [docsUrl, setDocsUrl] = useState('')
  const [hint, setHint] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [isBuiltin, setIsBuiltin] = useState(false)

  const token = useCallback(async () => (await getAccessToken()) ?? '', [getAccessToken])
  const load = useCallback(async () => {
    try { const r = await adminListGalleryBlocks(await token()); setBlocks(r.blocks) } catch { /* ignore */ } finally { setLoaded(true) }
  }, [token])
  useEffect(() => { void load() }, [load])

  // Deep-link from the Blocks page: /admin/block-builder?edit=<slug> loads it once.
  const [params] = useSearchParams()
  const editSlug = params.get('edit')
  const applied = useRef(false)
  useEffect(() => {
    if (!editSlug || applied.current || !loaded) return
    const b = blocks.find((x) => x.slug === editSlug)
    if (b) {
      setDraft({ slug: b.slug, name: b.name, icon: b.icon, category: b.category, tagline: b.tagline, description: b.description, sizeW: b.size_w, sizeH: b.size_h, fields: b.fields, htmlTemplate: b.html_template, docsUrl: b.docs_url ?? undefined, enabled: b.enabled })
      setFieldsText(JSON.stringify(b.fields ?? [], null, 2))
      setIsBuiltin(BUILTIN_IDS.has(b.slug))
      applied.current = true
      return
    }
    // Built-in without an override yet — prefill metadata from code (HTML is in code).
    const bi = BLOCK_GALLERY.find((x) => x.id === editSlug)
    if (bi) {
      setDraft({ slug: bi.id, name: bi.name, icon: bi.icon, category: bi.category, tagline: bi.tagline, description: bi.description, sizeW: bi.size?.w ?? 3, sizeH: bi.size?.h ?? 3, fields: [], htmlTemplate: '', enabled: true })
      setFieldsText('[]')
      setIsBuiltin(true)
      applied.current = true
    }
  }, [editSlug, blocks, loaded])

  const set = <K extends keyof GalleryBlockDraft>(k: K, v: GalleryBlockDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  async function generate() {
    if (!docsUrl.trim() || generating) return
    setGenerating(true); setError(null); setNote(null)
    try {
      const r = await adminGenerateGalleryBlock(await token(), { docsUrl: docsUrl.trim(), hint: hint.trim() || undefined })
      setDraft({ ...r.draft, docsUrl: docsUrl.trim(), enabled: true })
      setFieldsText(JSON.stringify(r.draft.fields ?? [], null, 2))
      setIsBuiltin(false)
      setNote('Draft generated — review the fields & HTML, then Publish.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed.')
    } finally { setGenerating(false) }
  }

  async function save() {
    if (saving) return
    if (!draft.name.trim()) { setError('Name is required.'); return }
    if (!isBuiltin && !draft.htmlTemplate.trim()) { setError('An HTML template is required.'); return }
    let fields: GalleryFieldDef[]
    try { fields = JSON.parse(fieldsText || '[]') } catch { setError('Fields JSON is invalid.'); return }
    setSaving(true); setError(null); setNote(null)
    try {
      await adminSaveGalleryBlock(await token(), { ...draft, fields })
      setNote(`Published "${draft.name}".`)
      setDraft(BLANK); setFieldsText('[]'); setDocsUrl(''); setHint(''); setIsBuiltin(false)
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally { setSaving(false) }
  }

  function edit(b: DbGalleryBlock) {
    setDraft({ slug: b.slug, name: b.name, icon: b.icon, category: b.category, tagline: b.tagline, description: b.description, sizeW: b.size_w, sizeH: b.size_h, fields: b.fields, htmlTemplate: b.html_template, docsUrl: b.docs_url ?? undefined, enabled: b.enabled })
    setFieldsText(JSON.stringify(b.fields ?? [], null, 2))
    setNote(null); setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function toggle(b: DbGalleryBlock) {
    try { await adminSaveGalleryBlock(await token(), { slug: b.slug, name: b.name, icon: b.icon, category: b.category, tagline: b.tagline, description: b.description, sizeW: b.size_w, sizeH: b.size_h, fields: b.fields, htmlTemplate: b.html_template, enabled: !b.enabled }); void load() } catch { /* ignore */ }
  }
  async function del(b: DbGalleryBlock) {
    if (!confirm(`Delete "${b.name}" from the gallery? This cannot be undone.`)) return
    try { await adminDeleteGalleryBlock(await token(), b.id); void load() } catch { /* ignore */ }
  }

  return (
    <AdminLayout>
      <div className="bb">
        <h1 className="bb-h1">🧱 Block Builder</h1>
        <p className="bb-lead">Generate a Block from any widget/API documentation URL, review it, then publish it to everyone's Block Gallery.</p>

        <section className="bb-card">
          <h2>1 · Generate from docs</h2>
          <label className="studio-field"><span>Documentation URL</span>
            <input className="studio-input" value={docsUrl} onChange={(e) => setDocsUrl(e.target.value)} placeholder="https://docs.example.com/embed-widget" />
          </label>
          <label className="studio-field"><span>What should it do? (optional)</span>
            <input className="studio-input" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. embed the live price ticker with a symbol field" />
          </label>
          <button className="btn btn-primary" onClick={() => void generate()} disabled={generating || !docsUrl.trim()}>
            {generating ? 'Reading docs & generating…' : '✨ Generate draft'}
          </button>
        </section>

        {error && <div className="bb-error">{error}</div>}
        {note && <div className="bb-note">{note}</div>}

        <section className="bb-card">
          <h2>2 · Block definition</h2>
          <div className="bb-grid">
            <label className="studio-field"><span>Name</span><input className="studio-input" value={draft.name} onChange={(e) => set('name', e.target.value)} /></label>
            <label className="studio-field"><span>Icon (emoji)</span><input className="studio-input" value={draft.icon} onChange={(e) => set('icon', e.target.value)} /></label>
            <label className="studio-field"><span>Category</span>
              <select className="studio-select" value={draft.category} onChange={(e) => set('category', e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="studio-field"><span>Tagline</span><input className="studio-input" value={draft.tagline} onChange={(e) => set('tagline', e.target.value)} /></label>
            <label className="studio-field"><span>Width (1–6)</span><input className="studio-input" type="number" value={draft.sizeW} onChange={(e) => set('sizeW', Number(e.target.value))} /></label>
            <label className="studio-field"><span>Height (1–6)</span><input className="studio-input" type="number" value={draft.sizeH} onChange={(e) => set('sizeH', Number(e.target.value))} /></label>
          </div>
          <label className="studio-field"><span>Description</span><textarea className="studio-input" rows={2} value={draft.description} onChange={(e) => set('description', e.target.value)} /></label>
          {isBuiltin ? (
            <p className="bb-note">Built-in block — its fields &amp; HTML logic are defined in code. Only the name, icon, category, tagline and size are customizable here.</p>
          ) : (
            <>
              <label className="studio-field"><span>Fields (JSON)</span><textarea className="studio-input bb-code" rows={6} value={fieldsText} onChange={(e) => setFieldsText(e.target.value)} placeholder='[{"key":"symbol","label":"Symbol","type":"text","default":"AAPL"}]' /></label>
              <label className="studio-field"><span>HTML template <small>(use {'{{fieldKey}}'} placeholders; {'{{key|url}}'} for URLs)</small></span>
                <textarea className="studio-input bb-code" rows={12} value={draft.htmlTemplate} onChange={(e) => set('htmlTemplate', e.target.value)} />
              </label>
            </>
          )}
          <div className="bb-actions">
            <button className="btn btn-ghost" onClick={() => { setDraft(BLANK); setFieldsText('[]'); setIsBuiltin(false) }}>Clear</button>
            <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? 'Publishing…' : 'Publish to gallery'}</button>
          </div>
        </section>

        <section className="bb-card">
          <h2>Gallery Blocks <span className="bb-count">{blocks.length}</span></h2>
          {blocks.length === 0 ? (
            <p className="bb-lead">No admin-built blocks yet. Generate one above.</p>
          ) : (
            <div className="bb-list">
              {blocks.map((b) => (
                <div className="bb-row" key={b.id}>
                  <span className="bb-row-ic">{b.icon}</span>
                  <div className="bb-row-main">
                    <div className="bb-row-name">{b.name} {!b.enabled && <span className="bb-disabled">disabled</span>}</div>
                    <div className="bb-row-sub">{b.category} · {b.tagline}</div>
                  </div>
                  <button className="btn btn-ghost btn-xs" onClick={() => edit(b)}>Edit</button>
                  <button className="btn btn-ghost btn-xs" onClick={() => void toggle(b)}>{b.enabled ? 'Disable' : 'Enable'}</button>
                  <button className="btn btn-ghost btn-xs bb-del" onClick={() => void del(b)}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  )
}
